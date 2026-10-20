import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db, logActivity } from '../db';
import { asyncHandler, HttpError, parse } from '../middleware/error';
import { assertCanViewStudent, requireAuth, requireRole } from '../middleware/auth';
import { ageFromDob, fillSeries, isISODate, joinedLabel, lastMonths, levelFromScore, monthLabel, todayISO } from '../utils/dates';
import { nextId } from '../utils/ids';
import { mapStudent, STUDENT_SELECT } from '../utils/mappers';
import { deleteUpload } from '../utils/files';

const router = Router();
router.use(requireAuth);

/* ───────── validation ───────── */
const fields = {
  name: z.string().trim().min(1, 'Name is required').max(100),
  dob: z.string().trim().max(20).nullable().optional(),
  gender: z.enum(['Male', 'Female', 'Other']).optional(),
  level: z.enum(['Beginner', 'Intermediate', 'Advanced']).optional(),
  batch: z.string().trim().regex(/^Batch [A-Z]$/, 'Batch must look like "Batch A"').optional(),
  phone: z.string().trim().max(30).optional(),
  parent: z.string().trim().max(100).optional(),
  parentPhone: z.string().trim().max(30).optional(),
  email: z.union([z.literal(''), z.string().trim().email('Invalid email address')]).optional(),
  address: z.string().trim().max(300).optional(),
  joined: z.string().trim().max(30).optional(),
  status: z.enum(['Active', 'Inactive']).optional(),
  photo: z.string().max(500).nullable().optional(),
};
const username = z.string().trim().regex(/^[a-zA-Z0-9._-]{3,30}$/, 'Username must be 3–30 letters, numbers, dot, dash or underscore');
const password = z.string().min(6, 'Password must be at least 6 characters').max(100);
const createSchema = z.object({ ...fields, username, password });
const updateSchema = z.object(fields).partial().extend({ username: username.optional(), password: password.optional() });

const COLUMNS: Record<string, string> = {
  name: 'name', dob: 'dob', gender: 'gender', level: 'level', batch: 'batch', phone: 'phone', parent: 'parent',
  parentPhone: 'parent_phone', email: 'email', address: 'address', joined: 'joined', status: 'status', photo: 'photo',
};

const getOne = (id: string) => {
  const r = db.prepare(`${STUDENT_SELECT} WHERE s.id = ?`).get(id);
  if (!r) throw new HttpError(404, 'Student not found');
  return mapStudent(r);
};
const usernameTaken = (name: string, exceptRef?: string) =>
  !!db.prepare('SELECT 1 FROM users WHERE username = ? AND ref_id != ?').get(name, exceptRef ?? '');

/* ───────── CRUD ───────── */
// GET /api/students   (admin/staff: everyone, student: only themself)   ?batch=Batch A
router.get('/', (req, res) => {
  const u = req.user!;
  const batch = typeof req.query.batch === 'string' ? req.query.batch : null;
  const rows = u.role === 'student'
    ? db.prepare(`${STUDENT_SELECT} WHERE s.id = ?`).all(u.refId)
    : db.prepare(`${STUDENT_SELECT} ${batch ? 'WHERE s.batch = ?' : ''} ORDER BY s.id`).all(...(batch ? [batch] : []));
  res.json(rows.map(mapStudent));
});

router.get('/:id', (req, res) => {
  assertCanViewStudent(req.user, req.params.id);
  res.json(getOne(req.params.id));
});

// POST /api/students   (admin)  -> creates the student AND their login
router.post('/', requireRole('admin'), (req, res) => {
  const b = parse(createSchema, req.body);
  if (usernameTaken(b.username)) throw new HttpError(409, 'That username is already taken');
  const id = nextId('students');
  db.transaction(() => {
    db.prepare(`INSERT INTO students (id, name, dob, age, level, batch, phone, parent, parent_phone, email, gender, joined, address, status, photo)
      VALUES (@id, @name, @dob, @age, @level, @batch, @phone, @parent, @parentPhone, @email, @gender, @joined, @address, @status, @photo)`).run({
      id, name: b.name, dob: b.dob ?? null, age: ageFromDob(b.dob) ?? 12, level: b.level ?? 'Beginner', batch: b.batch ?? 'Batch A',
      phone: b.phone ?? '', parent: b.parent ?? '', parentPhone: b.parentPhone ?? '', email: b.email ?? '', gender: b.gender ?? 'Male',
      joined: b.joined || joinedLabel(), address: b.address ?? '', status: b.status ?? 'Active', photo: b.photo ?? null,
    });
    db.prepare('INSERT INTO users (ref_id, username, password_hash, role, name) VALUES (?, ?, ?, ?, ?)')
      .run(id, b.username, bcrypt.hashSync(b.password, 10), 'student', b.name);
    logActivity(`New student ${b.name} added`, 'primary');
  })();
  res.status(201).json(getOne(id));
});

// PUT /api/students/:id   (admin)  — partial update; username/password create or update the login
router.put('/:id', requireRole('admin'), (req, res) => {
  const id = req.params.id;
  const cur = db.prepare('SELECT * FROM students WHERE id = ?').get(id) as any;
  if (!cur) throw new HttpError(404, 'Student not found');
  const b = parse(updateSchema, req.body);
  if (b.username && usernameTaken(b.username, id)) throw new HttpError(409, 'That username is already taken');

  const sets: string[] = []; const vals: Record<string, unknown> = { id };
  for (const [k, col] of Object.entries(COLUMNS)) {
    if (k in b && (b as any)[k] !== undefined) { sets.push(`${col} = @${k}`); vals[k] = (b as any)[k]; }
  }
  if ('dob' in b && b.dob) { sets.push('age = @age'); vals.age = ageFromDob(b.dob) ?? cur.age; }

  db.transaction(() => {
    if (sets.length) db.prepare(`UPDATE students SET ${sets.join(', ')} WHERE id = @id`).run(vals);
    const user = db.prepare('SELECT * FROM users WHERE ref_id = ?').get(id) as any;
    if (user) {
      if (b.name) db.prepare('UPDATE users SET name = ? WHERE ref_id = ?').run(b.name, id);
      if (b.username) db.prepare('UPDATE users SET username = ? WHERE ref_id = ?').run(b.username, id);
      if (b.password) db.prepare('UPDATE users SET password_hash = ? WHERE ref_id = ?').run(bcrypt.hashSync(b.password, 10), id);
    } else if (b.username && b.password) {
      db.prepare('INSERT INTO users (ref_id, username, password_hash, role, name) VALUES (?, ?, ?, ?, ?)')
        .run(id, b.username, bcrypt.hashSync(b.password, 10), 'student', b.name ?? cur.name);
    }
  })();
  if ('photo' in b && cur.photo && cur.photo !== b.photo) deleteUpload(cur.photo);
  res.json(getOne(id));
});

// DELETE /api/students/:id  (admin)
router.delete('/:id', requireRole('admin'), (req, res) => {
  const cur = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id) as any;
  if (!cur) throw new HttpError(404, 'Student not found');
  db.transaction(() => {
    db.prepare('DELETE FROM users WHERE ref_id = ?').run(cur.id);
    db.prepare('DELETE FROM students WHERE id = ?').run(cur.id);
    logActivity(`Student ${cur.name} removed`);
  })();
  deleteUpload(cur.photo);
  res.status(204).end();
});

/* ───────── per-student attendance & performance ───────── */
// GET /api/students/:id/attendance
router.get('/:id/attendance', (req, res) => {
  const id = req.params.id;
  assertCanViewStudent(req.user, id);
  getOne(id);
  const t = db.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(present), 0) AS present FROM attendance WHERE student_id = ?').get(id) as { total: number; present: number };
  const months = lastMonths(12);
  const rows = db.prepare('SELECT substr(date, 1, 7) AS m, 100.0 * SUM(present) / COUNT(*) AS p FROM attendance WHERE student_id = ? GROUP BY m').all(id) as { m: string; p: number }[];
  const recent = db.prepare('SELECT date, present FROM attendance WHERE student_id = ? ORDER BY date DESC LIMIT 8').all(id) as { date: string; present: number }[];
  res.json({
    total: t.total, present: t.present, absent: t.total - t.present, percent: t.total ? Math.round((100 * t.present) / t.total) : 0,
    monthly: { labels: months.map(monthLabel), values: fillSeries(months, new Map(rows.map(r => [r.m, r.p])), false) },
    recent: recent.map(r => ({ date: r.date, present: !!r.present })),
  });
});

// GET /api/students/:id/performance
router.get('/:id/performance', (req, res) => {
  const id = req.params.id;
  assertCanViewStudent(req.user, id);
  getOne(id);
  const rows = db.prepare('SELECT * FROM assessments WHERE student_id = ? ORDER BY date DESC, id DESC').all(id) as any[];
  const cur = rows[0]; const current = cur?.score ?? 0; const previous = rows[1]?.score ?? null;
  res.json({
    current, previous, improvement: previous === null ? 0 : current - previous,
    skills: {
      tactics: cur?.tactics ?? current, openings: cur?.openings ?? current, endgame: cur?.endgame ?? current,
      analysis: cur?.analysis ?? current, tournament: cur?.tournament ?? current,
    },
    history: rows.slice(0, 12).reverse().map(r => ({ date: r.date, score: r.score })),
    assessments: rows.slice(0, 8).map(r => ({ id: r.id, date: r.date, score: r.score, level: levelFromScore(r.score) })),
    comments: rows.filter(r => r.comments).slice(0, 3).map(r => ({ id: r.id, text: r.comments, coach: r.coach_name ?? 'Coach', date: r.date })),
  });
});

// POST /api/students/:id/assessments   (admin/staff)
const score = z.number().int().min(0).max(100);
const assessmentSchema = z.object({
  date: z.string().refine(isISODate, 'Date must be YYYY-MM-DD').optional(),
  score,
  tactics: score.optional(), openings: score.optional(), endgame: score.optional(), analysis: score.optional(), tournament: score.optional(),
  comments: z.string().trim().max(500).optional(),
});
router.post('/:id/assessments', requireRole('admin', 'staff'), (req, res) => {
  const s = getOne(req.params.id);
  const b = parse(assessmentSchema, req.body);
  const r = db.prepare(`INSERT INTO assessments (student_id, date, score, tactics, openings, endgame, analysis, tournament, comments, coach_id, coach_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    s.id, b.date ?? todayISO(), b.score, b.tactics ?? null, b.openings ?? null, b.endgame ?? null, b.analysis ?? null,
    b.tournament ?? null, b.comments || null, req.user!.refId, req.user!.name);
  logActivity(`${s.name} scored ${b.score} in assessment`, 'success');
  res.status(201).json({ id: r.lastInsertRowid });
});

export default router;
