import fs from 'fs';
import { config } from './config';
import { openDatabase } from './sqlite';

fs.mkdirSync(config.uploadDir, { recursive: true });

export const db = openDatabase(config.dbPath);

export function migrate() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    ref_id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','staff','student')),
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    dob TEXT,
    age INTEGER NOT NULL DEFAULT 12,
    level TEXT NOT NULL DEFAULT 'Beginner',
    batch TEXT NOT NULL DEFAULT 'Batch A',
    phone TEXT NOT NULL DEFAULT '',
    parent TEXT NOT NULL DEFAULT '',
    parent_phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    gender TEXT NOT NULL DEFAULT 'Male',
    joined TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Active',
    photo TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS staff (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    batch TEXT NOT NULL DEFAULT 'Batch A',
    status TEXT NOT NULL DEFAULT 'Active',
    joined TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    photo TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS attendance (
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    present INTEGER NOT NULL CHECK (present IN (0,1)),
    marked_by TEXT,
    PRIMARY KEY (student_id, date)
  );
  CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);

  CREATE TABLE IF NOT EXISTS assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    score INTEGER NOT NULL,
    tactics INTEGER, openings INTEGER, endgame INTEGER, analysis INTEGER, tournament INTEGER,
    comments TEXT,
    coach_id TEXT,
    coach_name TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_assessments_student ON assessments(student_id, date);

  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    venue TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL,
    start_time TEXT NOT NULL DEFAULT '',
    end_time TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS match_students (
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    PRIMARY KEY (match_id, student_id)
  );
  CREATE TABLE IF NOT EXISTS match_staff (
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    PRIMARY KEY (match_id, staff_id)
  );
  CREATE TABLE IF NOT EXISTS match_results (
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    played INTEGER NOT NULL, wins INTEGER NOT NULL, draws INTEGER NOT NULL, losses INTEGER NOT NULL,
    points TEXT NOT NULL DEFAULT '', rank TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (match_id, student_id)
  );

  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'default',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `);
}

export function logActivity(text: string, type: 'success' | 'primary' | 'default' = 'default') {
  db.prepare('INSERT INTO activity (text, type) VALUES (?, ?)').run(text, type);
}
