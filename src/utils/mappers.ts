import { db } from '../db';
import { ageFromDob } from './dates';

/** students + computed attendance % and current performance (latest assessment) */
export const STUDENT_SELECT = `
  SELECT s.*, u.username AS username,
    COALESCE((SELECT ROUND(100.0 * SUM(a.present) / COUNT(*)) FROM attendance a WHERE a.student_id = s.id), 0) AS attendance,
    COALESCE((SELECT x.score FROM assessments x WHERE x.student_id = s.id ORDER BY x.date DESC, x.id DESC LIMIT 1), 0) AS performance
  FROM students s LEFT JOIN users u ON u.ref_id = s.id`;

export function mapStudent(r: any) {
  return {
    id: r.id, name: r.name, dob: r.dob ?? undefined, age: ageFromDob(r.dob) ?? r.age,
    level: r.level, batch: r.batch, phone: r.phone, parent: r.parent, parentPhone: r.parent_phone,
    email: r.email, gender: r.gender, joined: r.joined, address: r.address, status: r.status,
    photo: r.photo ?? undefined, username: r.username ?? undefined,
    attendance: Number(r.attendance), performance: Number(r.performance),
  };
}

export const STAFF_SELECT = `SELECT t.*, u.username AS username FROM staff t LEFT JOIN users u ON u.ref_id = t.id`;

const batchLetters = (b: string) => b.match(/\b[A-Z]\b/g) ?? [];

export function batchCounts() {
  const rows = db.prepare("SELECT batch, COUNT(*) c FROM students WHERE status = 'Active' GROUP BY batch").all() as { batch: string; c: number }[];
  return new Map(rows.map(r => [batchLetters(r.batch)[0] ?? r.batch, r.c]));
}

/** number of active students in the batches a staff member teaches */
export function mapStaff(r: any, counts: Map<string, number> = batchCounts()) {
  const students = batchLetters(r.batch).reduce((n, l) => n + (counts.get(l) ?? 0), 0);
  return {
    id: r.id, name: r.name, email: r.email, phone: r.phone, batch: r.batch, status: r.status,
    joined: r.joined, address: r.address, photo: r.photo ?? undefined, username: r.username ?? undefined, students,
  };
}
export const mapStaffPublic = (r: any) => ({ id: r.id, name: r.name, batch: r.batch, status: r.status, photo: r.photo ?? undefined });
export const staffBatchLetters = batchLetters;
