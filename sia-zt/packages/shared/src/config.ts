import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.GATEWAY_PORT || 3000),
  gatewaySecret: process.env.GATEWAY_SECRET || 'demo-gateway-secret',
  jwtSecret: process.env.JWT_SECRET || 'demo-jwt-secret',
  jwtIssuer: process.env.JWT_ISSUER || 'sia-zt',
  jwtAudience: process.env.JWT_AUDIENCE || 'sia-zt-app',
  databasePath: process.env.DATABASE_PATH || './database/sia_zt.db',
  gatewayUrl: process.env.GATEWAY_URL || 'http://localhost:3000',
  serviceNilaiUrl: process.env.SERVICE_NILAI_URL || 'http://localhost:3001',
  serviceTranskripUrl: process.env.SERVICE_TRANSKRIP_URL || 'http://localhost:3002',
  serviceClientId: process.env.SERVICE_CLIENT_ID || 'grading-service',
  serviceClientSecret: process.env.SERVICE_CLIENT_SECRET || 'demo-service-secret',
};

export interface AccessWindowConfig {
  start: string;
  end: string;
  timeZone: string;
}

const accessWindowConfigPath = fileURLToPath(new URL('../../../config/access-window.json', import.meta.url));

function isValidClockTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return false;
  return true;
}

export function readAccessWindowConfig(): AccessWindowConfig {
  const parsed: unknown = JSON.parse(readFileSync(accessWindowConfigPath, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Access window config must be a JSON object: ${accessWindowConfigPath}`);
  }

  const settings = parsed as Record<string, unknown>;
  if (!isValidClockTime(settings.start) || !isValidClockTime(settings.end)) {
    throw new Error(`Access window start and end must use 24-hour HH:mm format: ${accessWindowConfigPath}`);
  }
  if (typeof settings.timeZone !== 'string' || settings.timeZone.length === 0) {
    throw new Error(`Access window timeZone must be a valid IANA time zone: ${accessWindowConfigPath}`);
  }

  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: settings.timeZone });
  } catch {
    throw new Error(`Invalid access window timeZone "${settings.timeZone}": ${accessWindowConfigPath}`);
  }

  return { start: settings.start, end: settings.end, timeZone: settings.timeZone };
}

export function parseClockTime(value: string): number {
  const [hourStr, minuteStr] = value.split(':');
  const hour = Number(hourStr || 0);
  const minute = Number(minuteStr || 0);
  return hour * 60 + minute;
}

export function isWithinAccessWindow(now = new Date()): boolean {
  const accessWindow = readAccessWindowConfig();
  const testNowIso = process.env.TEST_NOW_ISO;
  const effectiveNow = testNowIso ? new Date(testNowIso) : now;

  const locale = new Intl.DateTimeFormat('en-CA', {
    timeZone: accessWindow.timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });

  const parts = locale.formatToParts(effectiveNow);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const currentMinutes = hour * 60 + minute;
  const startMinutes = parseClockTime(accessWindow.start);
  const endMinutes = parseClockTime(accessWindow.end);

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }

  return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
}

export type UserRole = 'admin' | 'dosen' | 'mahasiswa' | 'service';
