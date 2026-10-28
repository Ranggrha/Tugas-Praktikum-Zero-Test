import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { db, initializeDatabase, seedDatabase } from '../../../database/db';
import { config, isWithinAccessWindow } from '../../../packages/shared/src/config';
import { createRequestId, signJwt, verifyJwt } from '../../../packages/shared/src/helpers';
import { requireAccessToken, requireDeviceHeader, getRefreshTokenHash, getUserByUsername, validateDeviceForUser } from './auth';
import { authorizeClassFinalize, authorizeGradeRead, authorizeGradeWrite, authorizeTranscriptRead } from './policy';
import { listAuditLogs, recordAudit } from './audit';

initializeDatabase();
seedDatabase();

export const app = express();
app.use(cors());
app.use(express.json());

function issueAccessToken(user: any, extra: Record<string, any> = {}) {
  return signJwt({ sub: String(user.id), role: user.role, ...extra }, '10m');
}

function issueRefreshToken(user: any) {
  const token = cryptoRandom();
  const hash = getRefreshTokenHash(token);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO refresh_tokens (user_id, token_hash, expires_at, revoked_at, created_at) VALUES (@user_id, @token_hash, @expires_at, NULL, @created_at)`).run({
    user_id: user.id,
    token_hash: hash,
    expires_at: expiresAt,
    created_at: new Date().toISOString(),
  });
  return { token, expiresAt };
}

function cryptoRandom() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/auth/login', (req, res) => {
  const requestId = createRequestId();
  const deviceId = String(req.headers['x-device-id'] || req.body.deviceId || '');
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    recordAudit({ subjectType: 'user', subjectId: null, method: 'POST', endpoint: '/auth/login', deviceId, decision: 'DENY', reason: 'VALIDATION_FAILED', requestId });
    return res.status(400).json({ error: 'VALIDATION_FAILED', reason: 'VALIDATION_FAILED' });
  }

  const user = getUserByUsername(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    recordAudit({ subjectType: 'user', subjectId: username, method: 'POST', endpoint: '/auth/login', deviceId, decision: 'DENY', reason: 'INVALID_CREDENTIALS', requestId });
    return res.status(401).json({ error: 'INVALID_CREDENTIALS', reason: 'INVALID_CREDENTIALS' });
  }

  if (!deviceId) {
    recordAudit({ subjectType: 'user', subjectId: String(user.id), role: user.role, method: 'POST', endpoint: '/auth/login', deviceId: null, decision: 'DENY', reason: 'DEVICE_HEADER_MISSING', requestId });
    return res.status(401).json({ error: 'DEVICE_HEADER_MISSING', reason: 'DEVICE_HEADER_MISSING' });
  }

  const deviceValid = validateDeviceForUser(user.id, deviceId);
  if (!deviceValid) {
    recordAudit({ subjectType: 'user', subjectId: String(user.id), role: user.role, method: 'POST', endpoint: '/auth/login', deviceId, decision: 'DENY', reason: 'DEVICE_NOT_REGISTERED', requestId });
    return res.status(401).json({ error: 'DEVICE_NOT_REGISTERED', reason: 'DEVICE_NOT_REGISTERED' });
  }

  const accessToken = issueAccessToken(user);
  const { token: refreshToken } = issueRefreshToken(user);

  recordAudit({ subjectType: 'user', subjectId: String(user.id), role: user.role, method: 'POST', endpoint: '/auth/login', deviceId, decision: 'ALLOW', reason: 'ALLOW', requestId });
  return res.json({ accessToken, refreshToken, user: { id: user.id, username: user.username, role: user.role, fullName: user.full_name, nim: user.nim } });
});

app.post('/auth/service', (req, res) => {
  const requestId = createRequestId();
  const { clientId, clientSecret } = req.body as { clientId?: string; clientSecret?: string };
  if (clientId !== config.serviceClientId || clientSecret !== config.serviceClientSecret) {
    recordAudit({ subjectType: 'service', subjectId: clientId || 'unknown', role: 'service', method: 'POST', endpoint: '/auth/service', deviceId: null, decision: 'DENY', reason: 'INVALID_CREDENTIALS', requestId });
    return res.status(401).json({ error: 'INVALID_CREDENTIALS', reason: 'INVALID_CREDENTIALS' });
  }

  const serviceToken = signJwt({ sub: config.serviceClientId, role: 'service', scope: 'transcript-sync' }, '5m');
  recordAudit({ subjectType: 'service', subjectId: config.serviceClientId, role: 'service', method: 'POST', endpoint: '/auth/service', deviceId: null, decision: 'ALLOW', reason: 'ALLOW', requestId });
  return res.json({ serviceToken });
});

app.post('/auth/refresh', (req, res) => {
  const requestId = createRequestId();
  const refreshToken = req.body.refreshToken || req.headers['x-refresh-token'];
  if (!refreshToken || typeof refreshToken !== 'string') {
    recordAudit({ subjectType: 'user', subjectId: null, method: 'POST', endpoint: '/auth/refresh', deviceId: null, decision: 'DENY', reason: 'INVALID_CREDENTIALS', requestId });
    return res.status(401).json({ error: 'INVALID_CREDENTIALS', reason: 'INVALID_CREDENTIALS' });
  }

  const tokens = db.prepare('SELECT * FROM refresh_tokens WHERE revoked_at IS NULL AND expires_at > @now ORDER BY created_at DESC').all({ now: new Date().toISOString() }) as any[];
  let matched: any = null;
  for (const row of tokens) {
    if (bcrypt.compareSync(refreshToken, row.token_hash)) {
      matched = row;
      break;
    }
  }

  if (!matched) {
    recordAudit({ subjectType: 'user', subjectId: null, method: 'POST', endpoint: '/auth/refresh', deviceId: null, decision: 'DENY', reason: 'REFRESH_TOKEN_REVOKED', requestId });
    return res.status(401).json({ error: 'REFRESH_TOKEN_REVOKED', reason: 'REFRESH_TOKEN_REVOKED' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = @id AND is_active = 1').get({ id: matched.user_id }) as any;
  if (!user) {
    return res.status(401).json({ error: 'INVALID_CREDENTIALS', reason: 'INVALID_CREDENTIALS' });
  }

  const oldTokenId = matched.id;
  db.prepare('UPDATE refresh_tokens SET revoked_at = @now, replaced_by_token_id = @newTokenId WHERE id = @id').run({ now: new Date().toISOString(), newTokenId: oldTokenId, id: oldTokenId });
  const { token: newRefreshToken } = issueRefreshToken(user);
  const accessToken = issueAccessToken(user);

  recordAudit({ subjectType: 'user', subjectId: String(user.id), role: user.role, method: 'POST', endpoint: '/auth/refresh', deviceId: null, decision: 'ALLOW', reason: 'ALLOW', requestId });
  return res.json({ accessToken, refreshToken: newRefreshToken });
});

app.post('/auth/logout', (req, res) => {
  const requestId = createRequestId();
  const refreshToken = req.body.refreshToken || req.headers['x-refresh-token'];
  if (!refreshToken || typeof refreshToken !== 'string') {
    recordAudit({ subjectType: 'user', subjectId: null, method: 'POST', endpoint: '/auth/logout', deviceId: null, decision: 'DENY', reason: 'INVALID_CREDENTIALS', requestId });
    return res.status(400).json({ error: 'INVALID_CREDENTIALS', reason: 'INVALID_CREDENTIALS' });
  }

  const tokens = db.prepare('SELECT * FROM refresh_tokens WHERE revoked_at IS NULL').all() as any[];
  let matched: any = null;
  for (const row of tokens) {
    if (bcrypt.compareSync(refreshToken, row.token_hash)) {
      matched = row;
      break;
    }
  }

  if (matched) {
    db.prepare('UPDATE refresh_tokens SET revoked_at = @now WHERE id = @id').run({ now: new Date().toISOString(), id: matched.id });
    recordAudit({ subjectType: 'user', subjectId: String(matched.user_id), method: 'POST', endpoint: '/auth/logout', deviceId: null, decision: 'ALLOW', reason: 'ALLOW', requestId });
    return res.json({ success: true });
  }

  recordAudit({ subjectType: 'user', subjectId: null, method: 'POST', endpoint: '/auth/logout', deviceId: null, decision: 'DENY', reason: 'REFRESH_TOKEN_REVOKED', requestId });
  return res.status(401).json({ error: 'REFRESH_TOKEN_REVOKED', reason: 'REFRESH_TOKEN_REVOKED' });
});

app.get('/nilai', requireAccessToken, requireDeviceHeader, (req, res) => {
  const requestId = createRequestId();
  const user = req.user;
  const studentIdParam = req.query.studentId ? Number(req.query.studentId) : null;
  const decision = authorizeGradeRead(user, studentIdParam);
  if (!decision.allowed) {
    recordAudit({ subjectType: 'user', subjectId: String(user.id), role: user.role, method: 'GET', endpoint: '/nilai', deviceId: req.deviceId, decision: 'DENY', reason: decision.reason, requestId });
    return res.status(403).json({ error: decision.reason, reason: decision.reason });
  }

  let rows;
  if (user.role === 'mahasiswa') {
    rows = db.prepare(`SELECT g.id, g.class_id, g.student_id, g.score, g.updated_at, c.course_code, c.course_name, c.lecturer_id FROM grades g JOIN classes c ON c.id = g.class_id WHERE g.student_id = @userId ORDER BY c.course_code`).all({ userId: user.id });
  } else if (user.role === 'dosen') {
    rows = db.prepare(`SELECT g.id, g.class_id, g.student_id, g.score, g.updated_at, c.course_code, c.course_name, u.full_name as student_name FROM grades g JOIN classes c ON c.id = g.class_id JOIN users u ON u.id = g.student_id WHERE c.lecturer_id = @userId ORDER BY c.course_name`).all({ userId: user.id });
  } else {
    rows = db.prepare(`SELECT g.id, g.class_id, g.student_id, g.score, g.updated_at, c.course_code, c.course_name, u.full_name as student_name FROM grades g JOIN classes c ON c.id = g.class_id JOIN users u ON u.id = g.student_id ORDER BY c.course_code`).all();
  }

  recordAudit({ subjectType: 'user', subjectId: String(user.id), role: user.role, method: 'GET', endpoint: '/nilai', deviceId: req.deviceId, decision: 'ALLOW', reason: 'ALLOW', requestId });
  return res.json(rows);
});

app.put('/nilai/:id', requireAccessToken, requireDeviceHeader, (req, res) => {
  const requestId = createRequestId();
  const user = req.user;
  const gradeId = Number(req.params.id);
  const gradeRow = db.prepare('SELECT * FROM grades WHERE id = @id').get({ id: gradeId }) as any;
  if (!gradeRow) {
    recordAudit({ subjectType: 'user', subjectId: String(user.id), role: user.role, method: 'PUT', endpoint: '/nilai/:id', deviceId: req.deviceId, decision: 'DENY', reason: 'RESOURCE_NOT_FOUND', requestId });
    return res.status(404).json({ error: 'RESOURCE_NOT_FOUND', reason: 'RESOURCE_NOT_FOUND' });
  }

  const validation = authorizeGradeWrite(user, gradeRow.class_id, gradeRow.student_id);
  if (!validation.allowed) {
    recordAudit({ subjectType: 'user', subjectId: String(user.id), role: user.role, method: 'PUT', endpoint: '/nilai/:id', deviceId: req.deviceId, decision: 'DENY', reason: validation.reason, requestId });
    return res.status(403).json({ error: validation.reason, reason: validation.reason });
  }

  if (!isWithinAccessWindow()) {
    recordAudit({ subjectType: 'user', subjectId: String(user.id), role: user.role, method: 'PUT', endpoint: '/nilai/:id', deviceId: req.deviceId, decision: 'DENY', reason: 'OUTSIDE_ACCESS_WINDOW', requestId });
    return res.status(403).json({ error: 'OUTSIDE_ACCESS_WINDOW', reason: 'OUTSIDE_ACCESS_WINDOW' });
  }

  const score = Number(req.body.score);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    recordAudit({ subjectType: 'user', subjectId: String(user.id), role: user.role, method: 'PUT', endpoint: '/nilai/:id', deviceId: req.deviceId, decision: 'DENY', reason: 'VALIDATION_FAILED', requestId });
    return res.status(400).json({ error: 'VALIDATION_FAILED', reason: 'VALIDATION_FAILED' });
  }

  const now = new Date().toISOString();
  db.prepare('UPDATE grades SET score = @score, updated_at = @updated_at, updated_by = @updated_by WHERE id = @id').run({ score, updated_at: now, updated_by: user.id, id: gradeId });

  recordAudit({ subjectType: 'user', subjectId: String(user.id), role: user.role, method: 'PUT', endpoint: '/nilai/:id', deviceId: req.deviceId, decision: 'ALLOW', reason: 'ALLOW', requestId });
  return res.json({ success: true, score });
});

app.post('/nilai/classes/:classId/finalize', requireAccessToken, requireDeviceHeader, async (req, res) => {
  const requestId = createRequestId();
  const user = req.user;
  const classId = Number(req.params.classId);
  const decision = authorizeClassFinalize(user, classId);
  if (!decision.allowed) {
    recordAudit({ subjectType: 'user', subjectId: String(user.id), role: user.role, method: 'POST', endpoint: '/nilai/classes/:classId/finalize', deviceId: req.deviceId, decision: 'DENY', reason: decision.reason, requestId });
    return res.status(403).json({ error: decision.reason, reason: decision.reason });
  }
  if (!isWithinAccessWindow()) {
    recordAudit({ subjectType: 'user', subjectId: String(user.id), role: user.role, method: 'POST', endpoint: '/nilai/classes/:classId/finalize', deviceId: req.deviceId, decision: 'DENY', reason: 'OUTSIDE_ACCESS_WINDOW', requestId });
    return res.status(403).json({ error: 'OUTSIDE_ACCESS_WINDOW', reason: 'OUTSIDE_ACCESS_WINDOW' });
  }

  const classRow = db.prepare('SELECT * FROM classes WHERE id = @id').get({ id: classId }) as any;
  if (!classRow) {
    recordAudit({ subjectType: 'user', subjectId: String(user.id), role: user.role, method: 'POST', endpoint: '/nilai/classes/:classId/finalize', deviceId: req.deviceId, decision: 'DENY', reason: 'RESOURCE_NOT_FOUND', requestId });
    return res.status(404).json({ error: 'RESOURCE_NOT_FOUND', reason: 'RESOURCE_NOT_FOUND' });
  }

  db.prepare('UPDATE classes SET is_finalized = 1, finalized_at = @now WHERE id = @id').run({ now: new Date().toISOString(), id: classId });

  const studentRows = db.prepare('SELECT student_id FROM enrollments WHERE class_id = @classId').all({ classId }) as any[];
  const serviceToken = signJwt({ sub: config.serviceClientId, role: 'service', scope: 'transcript-sync' }, '5m');

  const syncPayload = {
    classId,
    studentIds: studentRows.map((row) => row.student_id),
  };

  let downstreamResponse: any = null;
  try {
    downstreamResponse = await fetch('http://localhost:3002/transcript/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceToken}`,
        'X-Gateway-Secret': config.gatewaySecret,
      },
      body: JSON.stringify(syncPayload),
    });
  } catch (error) {
    recordAudit({ subjectType: 'service', subjectId: config.serviceClientId, role: 'service', method: 'POST', endpoint: '/nilai/classes/:classId/finalize', deviceId: req.deviceId, decision: 'DENY', reason: 'RESOURCE_NOT_FOUND', requestId });
    return res.status(502).json({ error: 'DOWNSTREAM_SYNC_FAILED', reason: 'DOWNSTREAM_SYNC_FAILED' });
  }

  recordAudit({ subjectType: 'user', subjectId: String(user.id), role: user.role, method: 'POST', endpoint: '/nilai/classes/:classId/finalize', deviceId: req.deviceId, decision: 'ALLOW', reason: 'ALLOW', requestId });
  return res.json({ success: true, finalized: true, syncStatus: downstreamResponse.status });
});

app.get('/transkrip', requireAccessToken, requireDeviceHeader, (req, res) => {
  const requestId = createRequestId();
  const user = req.user;
  const studentIdParam = req.query.studentId ? Number(req.query.studentId) : null;
  const decision = authorizeTranscriptRead(user, studentIdParam ?? user.id);
  if (!decision.allowed) {
    recordAudit({ subjectType: 'user', subjectId: String(user.id), role: user.role, method: 'GET', endpoint: '/transkrip', deviceId: req.deviceId, decision: 'DENY', reason: decision.reason, requestId });
    return res.status(403).json({ error: decision.reason, reason: decision.reason });
  }

  const targetStudentId = user.role === 'mahasiswa' ? user.id : studentIdParam || user.id;
  const rows = db.prepare(`SELECT t.id, t.student_id, t.class_id, t.score, t.synchronized_at, c.course_code, c.course_name, u.full_name as student_name FROM transcripts t JOIN classes c ON c.id = t.class_id JOIN users u ON u.id = t.student_id WHERE t.student_id = @studentId ORDER BY c.course_code`).all({ studentId: targetStudentId });

  recordAudit({ subjectType: 'user', subjectId: String(user.id), role: user.role, method: 'GET', endpoint: '/transkrip', deviceId: req.deviceId, decision: 'ALLOW', reason: 'ALLOW', requestId });
  return res.json(rows);
});

app.get('/admin/audit-logs', requireAccessToken, requireDeviceHeader, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'ROLE_NOT_ALLOWED', reason: 'ROLE_NOT_ALLOWED' });
  }
  const logs = listAuditLogs({
    date: typeof req.query.date === 'string' ? req.query.date : undefined,
    endpoint: typeof req.query.endpoint === 'string' ? req.query.endpoint : undefined,
    decision: typeof req.query.decision === 'string' ? req.query.decision : undefined,
    reason: typeof req.query.reason === 'string' ? req.query.reason : undefined,
  });
  return res.json(logs);
});

export default app;
