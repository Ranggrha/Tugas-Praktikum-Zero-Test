import express from 'express';
import { db, initializeDatabase, seedDatabase } from '../../../database/db';
import { config } from '../../../packages/shared/src/config';
import { safeCompare, verifyJwt } from '../../../packages/shared/src/helpers';

initializeDatabase();
seedDatabase();

export const app = express();
app.use(express.json());

function requireGatewayAndServiceJwt(req: any, res: any, next: any) {
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
    if (payload.role !== 'service') {
      return res.status(401).json({ error: 'INVALID_SERVICE_TOKEN', reason: 'INVALID_SERVICE_TOKEN' });
    }
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'INVALID_SERVICE_TOKEN', reason: 'INVALID_SERVICE_TOKEN' });
  }
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/transcripts', requireGatewayAndServiceJwt, (req, res) => {
  const studentId = req.query.studentId ? Number(req.query.studentId) : null;
  if (studentId !== null) {
    const rows = db.prepare(`SELECT t.*, c.course_code, c.course_name FROM transcripts t JOIN classes c ON c.id = t.class_id WHERE t.student_id = @studentId ORDER BY c.course_code`).all({ studentId });
    return res.json(rows);
  }
  const rows = db.prepare(`SELECT t.*, c.course_code, c.course_name, u.full_name as student_name FROM transcripts t JOIN classes c ON c.id = t.class_id JOIN users u ON u.id = t.student_id ORDER BY c.course_code`).all();
  return res.json(rows);
});

app.post('/transcript/sync', requireGatewayAndServiceJwt, (req, res) => {
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
