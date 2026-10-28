import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { config } from '../packages/shared/src/config';

const dbDir = path.dirname(config.databasePath);
fs.mkdirSync(dbDir, { recursive: true });

export const db = new Database(config.databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

type UserInsert = {
  username: string;
  password_hash: string;
  full_name: string;
  role: 'admin' | 'dosen' | 'mahasiswa' | 'service';
  nim: string | null;
  is_active: number;
};

export function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','dosen','mahasiswa','service')),
      nim TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      device_id TEXT NOT NULL,
      device_name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, device_id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_code TEXT NOT NULL,
      course_name TEXT NOT NULL,
      lecturer_id INTEGER NOT NULL,
      semester TEXT NOT NULL,
      academic_year TEXT NOT NULL,
      is_finalized INTEGER NOT NULL DEFAULT 0,
      finalized_at TEXT,
      FOREIGN KEY(lecturer_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      UNIQUE(class_id, student_id),
      FOREIGN KEY(class_id) REFERENCES classes(id),
      FOREIGN KEY(student_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS grades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      score REAL NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_by INTEGER,
      UNIQUE(class_id, student_id),
      FOREIGN KEY(class_id) REFERENCES classes(id),
      FOREIGN KEY(student_id) REFERENCES users(id),
      FOREIGN KEY(updated_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS transcripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      class_id INTEGER NOT NULL,
      score REAL NOT NULL,
      synchronized_at TEXT,
      UNIQUE(student_id, class_id),
      FOREIGN KEY(student_id) REFERENCES users(id),
      FOREIGN KEY(class_id) REFERENCES classes(id)
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      replaced_by_token_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(replaced_by_token_id) REFERENCES refresh_tokens(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      subject_type TEXT NOT NULL,
      subject_id TEXT,
      role TEXT,
      method TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      device_id TEXT,
      decision TEXT NOT NULL CHECK(decision IN ('ALLOW','DENY')),
      reason TEXT NOT NULL,
      request_id TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);
    CREATE INDEX IF NOT EXISTS idx_classes_lecturer_id ON classes(lecturer_id);
    CREATE INDEX IF NOT EXISTS idx_enrollments_student_id ON enrollments(student_id);
    CREATE INDEX IF NOT EXISTS idx_grades_student_id ON grades(student_id);
    CREATE INDEX IF NOT EXISTS idx_transcripts_student_id ON transcripts(student_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_endpoint ON audit_logs(endpoint);
  `);
}

const demoUsers: UserInsert[] = [
  { username: 'admin01', password_hash: bcrypt.hashSync('admin123', 10), full_name: 'Admin Sistem', role: 'admin', nim: null, is_active: 1 },
  { username: 'dosen01', password_hash: bcrypt.hashSync('dosen123', 10), full_name: 'Dr. Anita Sari', role: 'dosen', nim: null, is_active: 1 },
  { username: 'dosen02', password_hash: bcrypt.hashSync('dosen456', 10), full_name: 'Dr. Budi Santoso', role: 'dosen', nim: null, is_active: 1 },
  { username: 'mahasiswa01', password_hash: bcrypt.hashSync('mahasiswa123', 10), full_name: 'Rina Mahasiswa', role: 'mahasiswa', nim: '20231001', is_active: 1 },
  { username: 'mahasiswa02', password_hash: bcrypt.hashSync('mahasiswa456', 10), full_name: 'Dewi Putri', role: 'mahasiswa', nim: '20231002', is_active: 1 },
  { username: 'mahasiswa03', password_hash: bcrypt.hashSync('mahasiswa789', 10), full_name: 'Fajar Rahman', role: 'mahasiswa', nim: '20231003', is_active: 1 },
];

export function seedDatabase() {
  const rowCount = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
  if (rowCount.c > 0) return;

  const insertUser = db.prepare(`INSERT INTO users (username, password_hash, full_name, role, nim, is_active) VALUES (@username, @password_hash, @full_name, @role, @nim, @is_active)`);
  const userIds: Record<string, number> = {};
  for (const user of demoUsers) {
    const res = insertUser.run(user);
    userIds[user.username] = Number(res.lastInsertRowid);
  }

  const devices = [
    { user: 'admin01', device_id: 'device-admin-01', device_name: 'Laptop Admin' },
    { user: 'dosen01', device_id: 'device-dosen-01', device_name: 'Laptop Dosen 01' },
    { user: 'dosen02', device_id: 'device-dosen-02', device_name: 'Laptop Dosen 02' },
    { user: 'mahasiswa01', device_id: 'device-mhs-01', device_name: 'HP Mahasiswa 01' },
    { user: 'mahasiswa02', device_id: 'device-mhs-02', device_name: 'HP Mahasiswa 02' },
    { user: 'mahasiswa03', device_id: 'device-mhs-03', device_name: 'HP Mahasiswa 03' },
  ];

  const insertDevice = db.prepare(`INSERT INTO devices (user_id, device_id, device_name, is_active) VALUES (@user_id, @device_id, @device_name, 1)`);
  for (const device of devices) {
    insertDevice.run({ user_id: userIds[device.user], device_id: device.device_id, device_name: device.device_name });
  }

  const insertClass = db.prepare(`INSERT INTO classes (course_code, course_name, lecturer_id, semester, academic_year, is_finalized, finalized_at) VALUES (@course_code, @course_name, @lecturer_id, @semester, @academic_year, @is_finalized, @finalized_at)`);
  const classMap: Record<string, number> = {};
  const classes = [
    { course_code: 'CS101', course_name: 'Pemrograman Web', lecturer_id: userIds.dosen01, semester: '2024/2025 Ganjil', academic_year: '2024/2025', is_finalized: 0, finalized_at: null },
    { course_code: 'CS201', course_name: 'Keamanan Informasi', lecturer_id: userIds.dosen02, semester: '2024/2025 Ganjil', academic_year: '2024/2025', is_finalized: 0, finalized_at: null },
  ];
  for (const course of classes) {
    const res = insertClass.run(course);
    classMap[course.course_code] = Number(res.lastInsertRowid);
  }

  const insertEnrollment = db.prepare(`INSERT INTO enrollments (class_id, student_id) VALUES (@class_id, @student_id)`);
  for (const [courseCode, studentUsernames] of [
    ['CS101', ['mahasiswa01', 'mahasiswa02']],
    ['CS201', ['mahasiswa01', 'mahasiswa03']],
  ] as const) {
    for (const username of studentUsernames) {
      insertEnrollment.run({ class_id: classMap[courseCode], student_id: userIds[username] });
    }
  }

  const insertGrade = db.prepare(`INSERT INTO grades (class_id, student_id, score, updated_at, updated_by) VALUES (@class_id, @student_id, @score, @updated_at, @updated_by)`);
  const gradeRows = [
    { class_id: classMap.CS101, student_id: userIds.mahasiswa01, score: 85, updated_at: new Date().toISOString(), updated_by: userIds.dosen01 },
    { class_id: classMap.CS101, student_id: userIds.mahasiswa02, score: 88, updated_at: new Date().toISOString(), updated_by: userIds.dosen01 },
    { class_id: classMap.CS201, student_id: userIds.mahasiswa01, score: 90, updated_at: new Date().toISOString(), updated_by: userIds.dosen02 },
    { class_id: classMap.CS201, student_id: userIds.mahasiswa03, score: 94, updated_at: new Date().toISOString(), updated_by: userIds.dosen02 },
  ];
  for (const row of gradeRows) insertGrade.run(row);

  const insertTranscript = db.prepare(`INSERT INTO transcripts (student_id, class_id, score, synchronized_at) VALUES (@student_id, @class_id, @score, @synchronized_at)`);
  for (const row of gradeRows) {
    insertTranscript.run({ student_id: row.student_id, class_id: row.class_id, score: row.score, synchronized_at: new Date().toISOString() });
  }
}

export function resetDatabaseForTests() {
  db.exec(`
    DELETE FROM audit_logs;
    DELETE FROM refresh_tokens;
    DELETE FROM transcripts;
    DELETE FROM grades;
    DELETE FROM enrollments;
    DELETE FROM classes;
    DELETE FROM devices;
    DELETE FROM users;
    DELETE FROM sqlite_sequence;
  `);
  seedDatabase();
}
