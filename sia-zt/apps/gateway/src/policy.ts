import { db } from '../../../database/db';
import type { UserRole } from '../../../packages/shared/src/types';

export type Decision = { allowed: boolean; reason: string };

export function authorizeGradeRead(user: { id: number; role: UserRole }, studentId?: number | null): Decision {
  if (user.role === 'mahasiswa') {
    if (studentId === null || studentId === undefined || Number(studentId) === user.id) {
      return { allowed: true, reason: 'ALLOW' };
    }
    return { allowed: false, reason: 'STUDENT_OWNERSHIP_MISMATCH' };
  }
  if (user.role === 'dosen') {
    return { allowed: true, reason: 'ALLOW' };
  }
  return { allowed: false, reason: 'ROLE_NOT_ALLOWED' };
}

export function authorizeGradeWrite(user: { id: number; role: UserRole }, classId: number, studentId: number): Decision {
  if (user.role !== 'dosen') return { allowed: false, reason: 'ROLE_NOT_ALLOWED' };

  const classRow = db.prepare('SELECT lecturer_id, is_finalized FROM classes WHERE id = @classId').get({ classId }) as { lecturer_id: number; is_finalized: number } | undefined;
  if (!classRow) return { allowed: false, reason: 'RESOURCE_NOT_FOUND' };
  if (classRow.lecturer_id !== user.id) return { allowed: false, reason: 'CLASS_NOT_OWNED' };
  if (classRow.is_finalized === 1) return { allowed: false, reason: 'CLASS_ALREADY_FINALIZED' };

  const studentEnrollment = db.prepare('SELECT id FROM enrollments WHERE class_id = @classId AND student_id = @studentId').get({ classId, studentId }) as { id: number } | undefined;
  if (!studentEnrollment) return { allowed: false, reason: 'STUDENT_OWNERSHIP_MISMATCH' };

  return { allowed: true, reason: 'ALLOW' };
}

export function authorizeClassFinalize(user: { id: number; role: UserRole }, classId: number): Decision {
  if (user.role !== 'dosen') return { allowed: false, reason: 'ROLE_NOT_ALLOWED' };
  const classRow = db.prepare('SELECT lecturer_id, is_finalized FROM classes WHERE id = @classId').get({ classId }) as { lecturer_id: number; is_finalized: number } | undefined;
  if (!classRow) return { allowed: false, reason: 'RESOURCE_NOT_FOUND' };
  if (classRow.lecturer_id !== user.id) return { allowed: false, reason: 'CLASS_NOT_OWNED' };
  if (classRow.is_finalized === 1) return { allowed: false, reason: 'CLASS_ALREADY_FINALIZED' };
  return { allowed: true, reason: 'ALLOW' };
}

export function authorizeTranscriptRead(user: { id: number; role: UserRole }, studentId?: number | null): Decision {
  if (user.role === 'admin') return { allowed: true, reason: 'ALLOW' };
  if (user.role === 'mahasiswa') {
    if (studentId === null || studentId === undefined || Number(studentId) === user.id) return { allowed: true, reason: 'ALLOW' };
    return { allowed: false, reason: 'STUDENT_OWNERSHIP_MISMATCH' };
  }
  return { allowed: false, reason: 'ROLE_NOT_ALLOWED' };
}
