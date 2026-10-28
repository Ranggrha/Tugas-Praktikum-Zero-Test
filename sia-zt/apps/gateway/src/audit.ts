import { db } from '../../../database/db';

export function recordAudit({
  subjectType,
  subjectId,
  role,
  method,
  endpoint,
  deviceId,
  decision,
  reason,
  requestId,
}: {
  subjectType: string;
  subjectId: string | null;
  role?: string | null;
  method: string;
  endpoint: string;
  deviceId?: string | null;
  decision: 'ALLOW' | 'DENY';
  reason: string;
  requestId: string;
}) {
  db.prepare(`
    INSERT INTO audit_logs (subject_type, subject_id, role, method, endpoint, device_id, decision, reason, request_id)
    VALUES (@subjectType, @subjectId, @role, @method, @endpoint, @deviceId, @decision, @reason, @requestId)
  `).run({ subjectType, subjectId, role: role ?? null, method, endpoint, deviceId: deviceId ?? null, decision, reason, requestId });
}

export function listAuditLogs(filters?: { date?: string; endpoint?: string; decision?: string; reason?: string; }) {
  const where: string[] = [];
  const params: Record<string, string> = {};

  if (filters?.date) {
    where.push('DATE(timestamp) = DATE(@date)');
    params.date = filters.date;
  }
  if (filters?.endpoint) {
    where.push('endpoint LIKE @endpoint');
    params.endpoint = `%${filters.endpoint}%`;
  }
  if (filters?.decision) {
    where.push('decision = @decision');
    params.decision = filters.decision;
  }
  if (filters?.reason) {
    where.push('reason LIKE @reason');
    params.reason = `%${filters.reason}%`;
  }

  const query = `SELECT * FROM audit_logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY timestamp DESC LIMIT 200`;
  return db.prepare(query).all(params);
}
