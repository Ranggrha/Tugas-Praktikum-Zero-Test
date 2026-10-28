import express from 'express';
import { db, initializeDatabase, seedDatabase } from '../../../database/db';
import { config } from '../../../packages/shared/src/config';
import { verifyJwt, safeCompare } from '../../../packages/shared/src/helpers';

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
    if (payload.role !== 'service' && payload.role !== 'dosen' && payload.role !== 'admin' && payload.role !== 'mahasiswa') {
      return res.status(401).json({ error: 'INVALID_TOKEN', reason: 'INVALID_TOKEN' });
    }
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'INVALID_TOKEN', reason: 'INVALID_TOKEN' });
  }
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/grades', requireGatewayAndJwt, (req, res) => {
  const user = req.user as any;
  const studentId = req.query.studentId ? Number(req.query.studentId) : null;
  if (user.role === 'mahasiswa') {
    const rows = db.prepare(`SELECT g.*, c.course_code, c.course_name FROM grades g JOIN classes c ON c.id = g.class_id WHERE g.student_id = @studentId ORDER BY c.course_code`).all({ studentId: Number(user.sub) });
    return res.json(rows);
  }
  if (user.role === 'dosen') {
    const rows = db.prepare(`SELECT g.*, c.course_code, c.course_name, u.full_name as student_name FROM grades g JOIN classes c ON c.id = g.class_id JOIN users u ON u.id = g.student_id WHERE c.lecturer_id = @userId ORDER BY c.course_code`).all({ userId: Number(user.sub) });
    return res.json(rows);
  }
  if (studentId !== null) {
    const rows = db.prepare(`SELECT g.*, c.course_code, c.course_name FROM grades g JOIN classes c ON c.id = g.class_id WHERE g.student_id = @studentId ORDER BY c.course_code`).all({ studentId });
    return res.json(rows);
  }
  const rows = db.prepare(`SELECT g.*, c.course_code, c.course_name, u.full_name as student_name FROM grades g JOIN classes c ON c.id = g.class_id JOIN users u ON u.id = g.student_id ORDER BY c.course_code`).all();
  return res.json(rows);
});

app.put('/grades/:id', requireGatewayAndJwt, (req, res) => {
  const { score } = req.body as { score?: number };
  const gradeId = Number(req.params.id);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    return res.status(400).json({ error: 'VALIDATION_FAILED', reason: 'VALIDATION_FAILED' });
  }

  const grade = db.prepare('SELECT * FROM grades WHERE id = @id').get({ id: gradeId }) as any;
  if (!grade) return res.status(404).json({ error: 'RESOURCE_NOT_FOUND', reason: 'RESOURCE_NOT_FOUND' });

  db.prepare('UPDATE grades SET score = @score, updated_at = @now, updated_by = @updatedBy WHERE id = @id').run({ score, now: new Date().toISOString(), updatedBy: Number((req.user as any).sub), id: gradeId });
  return res.json({ success: true, id: gradeId, score });
});

app.post('/classes/:id/finalize', requireGatewayAndJwt, (req, res) => {
  const classId = Number(req.params.id);
  db.prepare('UPDATE classes SET is_finalized = 1, finalized_at = @now WHERE id = @id').run({ now: new Date().toISOString(), id: classId });
  return res.json({ success: true });
});

export default app;
