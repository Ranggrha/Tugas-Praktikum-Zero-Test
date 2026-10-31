import express from 'express';
import { db, initializeDatabase, seedDatabase } from '../../../database/db';
import { config, isWithinAccessWindow } from '../../../packages/shared/src/config';
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
  if (user.role !== 'mahasiswa' && user.role !== 'dosen') {
    return res.status(403).json({ error: 'ROLE_NOT_ALLOWED', reason: 'ROLE_NOT_ALLOWED' });
  }
  if (user.role === 'mahasiswa') {
    const rows = db.prepare(`SELECT g.*, c.course_code, c.course_name, c.is_finalized FROM grades g JOIN classes c ON c.id = g.class_id WHERE g.student_id = @studentId ORDER BY c.course_code`).all({ studentId: Number(user.sub) });
    return res.json(rows);
  }
  if (user.role === 'dosen') {
    const rows = db.prepare(`SELECT g.*, c.course_code, c.course_name, c.is_finalized, u.full_name as student_name FROM grades g JOIN classes c ON c.id = g.class_id JOIN users u ON u.id = g.student_id WHERE c.lecturer_id = @userId ORDER BY c.course_code`).all({ userId: Number(user.sub) });
    return res.json(rows);
  }
  return res.status(403).json({ error: 'ROLE_NOT_ALLOWED', reason: 'ROLE_NOT_ALLOWED' });
});

app.put('/grades/:id', requireGatewayAndJwt, (req, res) => {
  const user = req.user as any;
  if (user.role !== 'dosen') {
    return res.status(403).json({ error: 'ROLE_NOT_ALLOWED', reason: 'ROLE_NOT_ALLOWED' });
  }
  const { score } = req.body as { score?: number };
  const gradeId = Number(req.params.id);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    return res.status(400).json({ error: 'VALIDATION_FAILED', reason: 'VALIDATION_FAILED' });
  }

  const grade = db.prepare('SELECT * FROM grades WHERE id = @id').get({ id: gradeId }) as any;
  if (!grade) return res.status(404).json({ error: 'RESOURCE_NOT_FOUND', reason: 'RESOURCE_NOT_FOUND' });
  const classRow = db.prepare('SELECT lecturer_id, is_finalized FROM classes WHERE id = @classId').get({ classId: grade.class_id }) as { lecturer_id: number; is_finalized: number } | undefined;
  if (!classRow || classRow.lecturer_id !== Number(user.sub)) {
    return res.status(403).json({ error: 'CLASS_NOT_OWNED', reason: 'CLASS_NOT_OWNED' });
  }
  if (classRow.is_finalized === 1) {
    return res.status(403).json({ error: 'CLASS_ALREADY_FINALIZED', reason: 'CLASS_ALREADY_FINALIZED' });
  }
  if (!isWithinAccessWindow()) {
    return res.status(403).json({ error: 'OUTSIDE_ACCESS_WINDOW', reason: 'OUTSIDE_ACCESS_WINDOW' });
  }

  db.prepare('UPDATE grades SET score = @score, updated_at = @now, updated_by = @updatedBy WHERE id = @id').run({ score, now: new Date().toISOString(), updatedBy: Number(user.sub), id: gradeId });
  return res.json({ success: true, id: gradeId, score });
});

app.post('/classes/:id/finalize', requireGatewayAndJwt, async (req, res) => {
  const classId = Number(req.params.id);
  const user = req.user as any;
  if (user.role !== 'dosen') {
    return res.status(403).json({ error: 'ROLE_NOT_ALLOWED', reason: 'ROLE_NOT_ALLOWED' });
  }
  const classRow = db.prepare('SELECT lecturer_id, is_finalized FROM classes WHERE id = @id').get({ id: classId }) as { lecturer_id: number; is_finalized: number } | undefined;
  if (!classRow) return res.status(404).json({ error: 'RESOURCE_NOT_FOUND', reason: 'RESOURCE_NOT_FOUND' });
  if (classRow.lecturer_id !== Number(user.sub)) {
    return res.status(403).json({ error: 'CLASS_NOT_OWNED', reason: 'CLASS_NOT_OWNED' });
  }
  if (classRow.is_finalized === 1) {
    return res.status(403).json({ error: 'CLASS_ALREADY_FINALIZED', reason: 'CLASS_ALREADY_FINALIZED' });
  }
  if (!isWithinAccessWindow()) {
    return res.status(403).json({ error: 'OUTSIDE_ACCESS_WINDOW', reason: 'OUTSIDE_ACCESS_WINDOW' });
  }

  const studentRows = db.prepare('SELECT student_id FROM enrollments WHERE class_id = @classId').all({ classId }) as { student_id: number }[];
  let serviceToken: string;
  try {
    const tokenResponse = await fetch(new URL('/auth/service', config.gatewayUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: config.serviceClientId, clientSecret: config.serviceClientSecret }),
    });
    if (!tokenResponse.ok) {
      return res.status(502).json({ error: 'SERVICE_TOKEN_REQUEST_FAILED', reason: 'SERVICE_TOKEN_REQUEST_FAILED' });
    }
    const tokenBody = await tokenResponse.json() as { serviceToken?: string };
    if (!tokenBody.serviceToken) {
      return res.status(502).json({ error: 'SERVICE_TOKEN_REQUEST_FAILED', reason: 'SERVICE_TOKEN_REQUEST_FAILED' });
    }
    serviceToken = tokenBody.serviceToken;
  } catch (error) {
    console.error('Service Nilai could not obtain a transcript-sync token from the gateway:', error);
    return res.status(502).json({ error: 'SERVICE_TOKEN_REQUEST_FAILED', reason: 'SERVICE_TOKEN_REQUEST_FAILED' });
  }

  db.prepare('UPDATE classes SET is_finalized = 1, finalized_at = @now WHERE id = @id').run({ now: new Date().toISOString(), id: classId });
  try {
    const syncResponse = await fetch(new URL('/transkrip/sinkron', config.gatewayUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceToken}` },
      body: JSON.stringify({ classId, studentIds: studentRows.map((row) => row.student_id) }),
    });
    if (!syncResponse.ok) {
      db.prepare('UPDATE classes SET is_finalized = 0, finalized_at = NULL WHERE id = @id').run({ id: classId });
      return res.status(502).json({ error: 'TRANSCRIPT_SYNC_FAILED', reason: 'TRANSCRIPT_SYNC_FAILED' });
    }
    return res.json({ success: true, finalized: true, syncStatus: syncResponse.status });
  } catch (error) {
    db.prepare('UPDATE classes SET is_finalized = 0, finalized_at = NULL WHERE id = @id').run({ id: classId });
    console.error('Service Nilai could not synchronize transcripts through the gateway:', error);
    return res.status(502).json({ error: 'TRANSCRIPT_SYNC_FAILED', reason: 'TRANSCRIPT_SYNC_FAILED' });
  }
});

export default app;
