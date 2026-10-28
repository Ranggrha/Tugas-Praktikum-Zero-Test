import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from './config';

export function createRequestId() {
  return crypto.randomUUID();
}

export function signJwt(payload: Record<string, unknown>, expiresIn = '10m') {
  return jwt.sign(payload, config.jwtSecret, {
    issuer: config.jwtIssuer,
    audience: config.jwtAudience,
    expiresIn,
  });
}

export function verifyJwt(token: string) {
  return jwt.verify(token, config.jwtSecret, {
    issuer: config.jwtIssuer,
    audience: config.jwtAudience,
  }) as jwt.JwtPayload;
}

export function safeCompare(a: string, b: string) {
  if (a.length !== b.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export function normalizeUserRole(role: string | undefined): string {
  return role || 'mahasiswa';
}
