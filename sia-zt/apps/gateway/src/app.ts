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

async function forwardToService(req: any, res: any, url: string): Promise<number | null> {
  try {
    const headers: Record<string, string> = { 'X-Gateway-Secret': config.gatewaySecret };
    const authorization = req.headers.authorization;
    const deviceId = req.headers['x-device-id'];
    if (typeof authorization === 'string') headers.Authorization = authorization;
    if (typeof deviceId === 'string') headers['X-Device-ID'] = deviceId;

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    if (hasBody) headers['Content-Type'] = 'application/json';
    const upstream = await fetch(url, {
      method: req.method,
      headers,
      ...(hasBody ? { body: JSON.stringify(req.body) } : {}),
    });
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.set('Content-Type', contentType);
    res.status(upstream.status).send(await upstream.text());
    return upstream.status;
  } catch (error) {
    console.error(`Gateway could not reach service at ${url}:`, error);
    res.status(502).json({ error: 'DOWNSTREAM_SERVICE_UNAVAILABLE', reason: 'DOWNSTREAM_SERVICE_UNAVAILABLE' });
    return null;
  }
}

function requireServiceToken(req: any, res: any, next: any) {
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'INVALID_SERVICE_TOKEN', reason: 'INVALID_SERVICE_TOKEN' });
  }

  try {
    const payload = verifyJwt(token);
    if (payload.role !== 'service' || payload.scope !== 'transcript-sync') {
      return res.status(401).json({ error: 'INVALID_SERVICE_TOKEN', reason: 'INVALID_SERVICE_TOKEN' });
    }
    req.serviceToken = token;
    next();
  } catch {
    return res.status(401).json({ error: 'INVALID_SERVICE_TOKEN', reason: 'INVALID_SERVICE_TOKEN' });
  }
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

app.get('/nilai', requireAccessToken, requireDeviceHeader, async (req, res) => {
  const requestId = createRequestId();
  const user = req.user;
  const studentIdParam = req.query.studentId ? Number(req.query.studentId) : null;
  const decision = authorizeGradeRead(user, studentIdParam);
  if (!decision.allowed) {
    recordAudit({ subjectType: 'user', subjectId: String(user.id), role: user.role, method: 'GET', endpoint: '/nilai', deviceId: req.deviceId, decision: 'DENY', reason: decision.reason, requestId });
    return res.status(403).json({ error: decision.reason, reason: decision.reason });
  }

  const serviceUrl = new URL('/grades', config.serviceNilaiUrl);
  if (typeof req.query.studentId === 'string') serviceUrl.searchParams.set('studentId', req.query.studentId);
  const status = await forwardToService(req, res, serviceUrl.toString());
  const allowed = status !== null && status < 400;
  recordAudit({ subjectType: 'user', subjectId: String(user.id), role: user.role, method: 'GET', endpoint: '/nilai', deviceId: req.deviceId, decision: allowed ? 'ALLOW' : 'DENY', reason: allowed ? 'ALLOW' : 'DOWNSTREAM_SERVICE_ERROR', requestId });
});

app.put('/nilai/:id', requireAccessToken, requireDeviceHeader, async (req, res) => {
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

  const status = await forwardToService(req, res, new URL(`/grades/${gradeId}`, config.serviceNilaiUrl).toString());
  const allowed = status !== null && status < 400;
  recordAudit({ subjectType: 'user', subjectId: String(user.id), role: user.role, method: 'PUT', endpoint: '/nilai/:id', deviceId: req.deviceId, decision: allowed ? 'ALLOW' : 'DENY', reason: allowed ? 'ALLOW' : 'DOWNSTREAM_SERVICE_ERROR', requestId });
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

  const status = await forwardToService(req, res, new URL('/classes/' + classId + '/finalize', config.serviceNilaiUrl).toString());
  const allowed = status !== null && status < 400;
  recordAudit({ subjectType: 'user', subjectId: String(user.id), role: user.role, method: 'POST', endpoint: '/nilai/classes/:classId/finalize', deviceId: req.deviceId, decision: allowed ? 'ALLOW' : 'DENY', reason: allowed ? 'ALLOW' : 'DOWNSTREAM_SERVICE_ERROR', requestId });
});

app.get('/transkrip', requireAccessToken, requireDeviceHeader, async (req, res) => {
  const requestId = createRequestId();
  const user = req.user;
  const studentIdParam = req.query.studentId ? Number(req.query.studentId) : null;
  const decision = authorizeTranscriptRead(user, studentIdParam ?? user.id);
  if (!decision.allowed) {
    recordAudit({ subjectType: 'user', subjectId: String(user.id), role: user.role, method: 'GET', endpoint: '/transkrip', deviceId: req.deviceId, decision: 'DENY', reason: decision.reason, requestId });
    return res.status(403).json({ error: decision.reason, reason: decision.reason });
  }

  const serviceUrl = new URL('/transcripts', config.serviceTranskripUrl);
  if (typeof req.query.studentId === 'string') serviceUrl.searchParams.set('studentId', req.query.studentId);
  const status = await forwardToService(req, res, serviceUrl.toString());
  const allowed = status !== null && status < 400;
  recordAudit({ subjectType: 'user', subjectId: String(user.id), role: user.role, method: 'GET', endpoint: '/transkrip', deviceId: req.deviceId, decision: allowed ? 'ALLOW' : 'DENY', reason: allowed ? 'ALLOW' : 'DOWNSTREAM_SERVICE_ERROR', requestId });
});

app.post('/transkrip/sinkron', requireServiceToken, async (req, res) => {
  const status = await forwardToService(req, res, new URL('/transcript/sync', config.serviceTranskripUrl).toString());
  const allowed = status !== null && status < 400;
  recordAudit({ subjectType: 'service', subjectId: config.serviceClientId, role: 'service', method: 'POST', endpoint: '/transkrip/sinkron', decision: allowed ? 'ALLOW' : 'DENY', reason: allowed ? 'ALLOW' : 'DOWNSTREAM_SERVICE_ERROR', requestId: createRequestId() });
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
