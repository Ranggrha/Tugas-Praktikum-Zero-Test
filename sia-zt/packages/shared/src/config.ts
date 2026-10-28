import 'dotenv/config';

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.GATEWAY_PORT || 3000),
  gatewaySecret: process.env.GATEWAY_SECRET || 'demo-gateway-secret',
  jwtSecret: process.env.JWT_SECRET || 'demo-jwt-secret',
  jwtIssuer: process.env.JWT_ISSUER || 'sia-zt',
  jwtAudience: process.env.JWT_AUDIENCE || 'sia-zt-app',
  databasePath: process.env.DATABASE_PATH || './database/sia_zt.db',
  serviceClientId: process.env.SERVICE_CLIENT_ID || 'grading-service',
  serviceClientSecret: process.env.SERVICE_CLIENT_SECRET || 'demo-service-secret',
  accessWindowStart: process.env.ACCESS_WINDOW_START || '07:00',
  accessWindowEnd: process.env.ACCESS_WINDOW_END || '21:00',
  accessWindowTz: process.env.ACCESS_WINDOW_TZ || 'Asia/Jakarta',
};

export function parseClockTime(value: string): number {
  const [hourStr, minuteStr] = value.split(':');
  const hour = Number(hourStr || 0);
  const minute = Number(minuteStr || 0);
  return hour * 60 + minute;
}

export function isWithinAccessWindow(now = new Date(), zone = config.accessWindowTz): boolean {
  const testNowIso = process.env.TEST_NOW_ISO;
  const effectiveNow = testNowIso ? new Date(testNowIso) : now;

  const locale = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });

  const parts = locale.formatToParts(effectiveNow);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const currentMinutes = hour * 60 + minute;
  const startMinutes = parseClockTime(config.accessWindowStart);
  const endMinutes = parseClockTime(config.accessWindowEnd);

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }

  return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
}

export type UserRole = 'admin' | 'dosen' | 'mahasiswa' | 'service';
