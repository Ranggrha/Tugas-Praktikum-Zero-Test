import express from 'express';
import { db, initializeDatabase, seedDatabase } from '../../../database/db';
import { config } from '../../../packages/shared/src/config';
import { safeCompare, verifyJwt } from '../../../packages/shared/src/helpers';

initializeDatabase();
seedDatabase();

export const app = express();
app.use(express.json());

function requireGatewayAndJwt(req: any, res: any, next: any) {
  const providedSecret = req.headers['x-gateway-secret'];
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
  if (!providedSecret || typeof providedSecret !== 'string' || !safeCompare(providedSecret, config.gatewaySecret)) {
    return res.status(403).json({ error: 'INVALID_GATEWAY_SECRET', reason: 'INVALID_GATEWAY_SECRET' });
  }
  if (!token) {
    return res.status(401).json({ error: 'MISSING_TOKEN', reason: 'MISSING_TOKEN' });
  }

  try {
    const payload = verifyJwt(token);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'INVALID_TOKEN', reason: 'INVALID_TOKEN' });
  }
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/transcripts', requireGatewayAndJwt, (req, res) => {
  const user = req.user as any;
  if (user.role !== 'admin' && user.role !== 'mahasiswa') {
    return res.status(403).json({ error: 'ROLE_NOT_ALLOWED', reason: 'ROLE_NOT_ALLOWED' });
  }
  const studentId = req.query.studentId ? Number(req.query.studentId) : null;
  if (user.role === 'mahasiswa') {
    if (studentId !== null && studentId !== Number(user.sub)) {
      return res.status(403).json({ error: 'STUDENT_OWNERSHIP_MISMATCH', reason: 'STUDENT_OWNERSHIP_MISMATCH' });
    }
    const rows = db.prepare(`SELECT t.id, t.student_id, t.class_id, t.score, t.synchronized_at, c.course_code, c.course_name, u.full_name as student_name FROM transcripts t JOIN classes c ON c.id = t.class_id JOIN users u ON u.id = t.student_id WHERE t.student_id = @studentId ORDER BY c.course_code`).all({ studentId: Number(user.sub) });
    return res.json(rows);
  }
  if (studentId !== null) {
    const rows = db.prepare(`SELECT t.id, t.student_id, t.class_id, t.score, t.synchronized_at, c.course_code, c.course_name, u.full_name as student_name FROM transcripts t JOIN classes c ON c.id = t.class_id JOIN users u ON u.id = t.student_id WHERE t.student_id = @studentId ORDER BY c.course_code`).all({ studentId });
    return res.json(rows);
  }
  const rows = db.prepare(`SELECT t.*, c.course_code, c.course_name, u.full_name as student_name FROM transcripts t JOIN classes c ON c.id = t.class_id JOIN users u ON u.id = t.student_id ORDER BY c.course_code`).all();
  return res.json(rows);
});

app.post('/transcript/sync', requireGatewayAndJwt, (req, res) => {
  const user = req.user as any;
  if (user.sub !== config.serviceClientId || user.role !== 'service' || user.scope !== 'transcript-sync') {
    return res.status(401).json({ error: 'INVALID_SERVICE_TOKEN', reason: 'INVALID_SERVICE_TOKEN' });
  }
  const body = req.body as { classId?: number; studentIds?: number[] };
  if (!body.classId || !Array.isArray(body.studentIds)) {
    return res.status(400).json({ error: 'VALIDATION_FAILED', reason: 'VALIDATION_FAILED' });
  }

  const isExisting = db.prepare('SELECT * FROM classes WHERE id = @id').get({ id: body.classId });
  if (!isExisting) {
    return res.status(404).json({ error: 'RESOURCE_NOT_FOUND', reason: 'RESOURCE_NOT_FOUND' });
  }

  const insertOrUpdate = db.prepare(`INSERT INTO transcripts (student_id, class_id, score, synchronized_at)
    VALUES (@studentId, @classId, @score, @now)
    ON CONFLICT(student_id, class_id) DO UPDATE SET score = excluded.score, synchronized_at = excluded.synchronized_at`);

  for (const studentId of body.studentIds) {
    const grade = db.prepare('SELECT score FROM grades WHERE class_id = @classId AND student_id = @studentId').get({ classId: body.classId, studentId }) as { score: number } | undefined;
    if (grade) {
      insertOrUpdate.run({ studentId, classId: body.classId, score: grade.score, now: new Date().toISOString() });
    }
  }

  return res.json({ success: true, synced: body.studentIds.length, classId: body.classId });
});

export default app;
