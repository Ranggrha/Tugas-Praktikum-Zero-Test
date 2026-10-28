export type UserRole = 'admin' | 'dosen' | 'mahasiswa' | 'service';

export interface User {
  id: number;
  username: string;
  full_name: string;
  role: UserRole;
  nim: string | null;
  is_active: number;
}

export interface Device {
  id: number;
  user_id: number;
  device_id: string;
  device_name: string;
  is_active: number;
}

export interface GradeRecord {
  id: number;
  class_id: number;
  student_id: number;
  score: number;
  updated_at: string;
  updated_by: number | null;
}

export interface ClassRecord {
  id: number;
  course_code: string;
  course_name: string;
  lecturer_id: number;
  semester: string;
  academic_year: string;
  is_finalized: number;
  finalized_at: string | null;
}

export interface TranscriptRecord {
  id: number;
  student_id: number;
  class_id: number;
  score: number;
  synchronized_at: string | null;
}

export interface AuditLog {
  id: number;
  timestamp: string;
  subject_type: string;
  subject_id: string;
  role: string | null;
  method: string;
  endpoint: string;
  device_id: string | null;
  decision: 'ALLOW' | 'DENY';
  reason: string;
  request_id: string;
}
