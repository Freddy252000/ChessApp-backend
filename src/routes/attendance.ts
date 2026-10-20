import { Router } from 'express';
import { z } from 'zod';
import { db, logActivity } from '../db';
import { HttpError, parse } from '../middleware/error';
import { requireAuth, requireRole } from '../middleware/auth';
import { isISODate, todayISO } from '../utils/dates';

const router = Router();
router.use(requireAuth, requireRole('admin', 'staff'));

const dateStr = z.string().refine(isISODate, 'Date must be YYYY-MM-DD');
const batchStr = z.string().regex(/^Batch [A-Z]$/, 'Batch must look like "Batch A"');

// GET /api/attendance?date=2026-09-15&batch=Batch A
// -> active students of that batch with their status for that day (present: null = not marked yet)
router.get('/', (req, res) => {
  const { date, batch } = parse(z.object({ date: dateStr, batch: batchStr }), req.query);
  const students = db.prepare(`
    SELECT s.id, s.name, s.photo, a.present FROM students s
    LEFT JOIN attendance a ON a.student_id = s.id AND a.date = ?
    WHERE s.batch = ? AND s.status = 'Active' ORDER BY s.name`).all(date, batch) as any[];
  res.json({
    date, batch, marked: students.some(s => s.present !== null),
    students: students.map(s => ({ id: s.id, name: s.name, photo: s.photo ?? undefined, present: s.present === null ? null : !!s.present })),
  });
});

// PUT /api/attendance   { date, batch, records: [{ studentId, present }] }
router.put('/', (req, res) => {
  const b = parse(z.object({
    date: dateStr, batch: batchStr,
    records: z.array(z.object({ studentId: z.string(), present: z.boolean() })).min(1, 'No students to save'),
  }), req.body);
  if (b.date > todayISO()) throw new HttpError(400, 'You cannot mark attendance for a future date');

  const valid = new Set((db.prepare('SELECT id FROM students WHERE batch = ?').all(b.batch) as { id: string }[]).map(r => r.id));
  const bad = b.records.find(r => !valid.has(r.studentId));
  if (bad) throw new HttpError(400, `${bad.studentId} is not in ${b.batch}`);

  const up = db.prepare(`INSERT INTO attendance (student_id, date, present, marked_by) VALUES (?, ?, ?, ?)
    ON CONFLICT(student_id, date) DO UPDATE SET present = excluded.present, marked_by = excluded.marked_by`);
  db.transaction(() => {
    for (const r of b.records) up.run(r.studentId, b.date, r.present ? 1 : 0, req.user!.refId);
    logActivity(`${b.batch} attendance marked by ${req.user!.name}`);
  })();
  res.json({ ok: true, saved: b.records.length });
});

export default router;
