import bcrypt from 'bcryptjs';
import { db } from '../../../database/db';
import { config } from '../../../packages/shared/src/config';
import { safeCompare, verifyJwt } from '../../../packages/shared/src/helpers';

export function getUserByUsername(username: string) {
  return db.prepare('SELECT * FROM users WHERE username = @username AND is_active = 1').get({ username }) as any | undefined;
}

export function validateDeviceForUser(userId: number, deviceId: string) {
  const device = db.prepare('SELECT * FROM devices WHERE user_id = @userId AND device_id = @deviceId AND is_active = 1').get({ userId, deviceId }) as any | undefined;
  return !!device;
}

export function getRefreshTokenHash(token: string) {
  return bcrypt.hashSync(token, 10);
}

export function verifyGatewaySecret(req: any) {
  const provided = req.headers['x-gateway-secret'];
  if (!provided || typeof provided !== 'string') {
    return false;
  }
  return safeCompare(provided, config.gatewaySecret);
}

export function requireAccessToken(req: any, res: any, next: any) {
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'MISSING_TOKEN', reason: 'MISSING_TOKEN' });
  }

  try {
    const payload = verifyJwt(token);
    const user = db.prepare('SELECT * FROM users WHERE id = @id AND is_active = 1').get({ id: payload.sub }) as any | undefined;
    if (!user) {
      return res.status(401).json({ error: 'INVALID_TOKEN', reason: 'INVALID_TOKEN' });
    }
    req.user = user;
    req.tokenPayload = payload;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'INVALID_TOKEN', reason: 'INVALID_TOKEN' });
  }
}

export function requireDeviceHeader(req: any, res: any, next: any) {
  const deviceId = req.headers['x-device-id'];
  if (!deviceId || typeof deviceId !== 'string') {
    return res.status(401).json({ error: 'DEVICE_HEADER_MISSING', reason: 'DEVICE_HEADER_MISSING' });
  }
  const user = req.user;
  const valid = validateDeviceForUser(user.id, deviceId);
  if (!valid) {
    return res.status(401).json({ error: 'DEVICE_NOT_REGISTERED', reason: 'DEVICE_NOT_REGISTERED' });
  }
  req.deviceId = deviceId;
  next();
}
