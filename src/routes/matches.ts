import { Router } from 'express';
import { z } from 'zod';
import { db, logActivity } from '../db';
import { HttpError, parse } from '../middleware/error';
import { requireAuth, requireRole } from '../middleware/auth';
import { isISODate, isTime, todayISO } from '../utils/dates';
import { nextId } from '../utils/ids';

const router = Router();
router.use(requireAuth);

const time = z.union([z.literal(''), z.string().refine(isTime, 'Time must be HH:mm (24h)')]);
const matchSchema = z.object({
  name: z.string().trim().min(1, 'Match name is required').max(120),
  type: z.string().trim().min(1, 'Match type is required').max(50),
  venue: z.string().trim().max(200).optional(),
  date: z.string().refine(isISODate, 'Date must be YYYY-MM-DD'),
  startTime: time.optional(),
  endTime: time.optional(),
  studentIds: z.array(z.string()).default([]),
  staffIds: z.array(z.string()).default([]),
});

function hydrate(m: any) {
  const studentIds = (db.prepare('SELECT student_id AS id FROM match_students WHERE match_id = ? ORDER BY student_id').all(m.id) as { id: string }[]).map(r => r.id);
  const staffIds = (db.prepare('SELECT staff_id AS id FROM match_staff WHERE match_id = ? ORDER BY staff_id').all(m.id) as { id: string }[]).map(r => r.id);
  const rs = db.prepare('SELECT * FROM match_results WHERE match_id = ?').all(m.id) as any[];
  const today = todayISO();
  const status = rs.length || m.date < today ? 'Completed' : m.date === today ? 'Ongoing' : 'Upcoming';
  return {
    id: m.id, name: m.name, type: m.type, venue: m.venue, date: m.date, startTime: m.start_time, endTime: m.end_time,
    status, studentIds, staffIds,
    results: rs.length ? Object.fromEntries(rs.map(r => [r.student_id, { played: r.played, wins: r.wins, draws: r.draws, losses: r.losses, points: r.points, rank: r.rank }])) : undefined,
  };
}
const getOne = (id: string) => {
  const m = db.prepare('SELECT * FROM matches WHERE id = ?').get(id);
  if (!m) throw new HttpError(404, 'Match not found');
  return hydrate(m);
};
function assertIds(table: 'students' | 'staff', ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return unique;
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE id IN (${unique.map(() => '?').join(',')})`).get(...unique) as { n: number }).n;
  if (n !== unique.length) throw new HttpError(400, `One or more ${table} do not exist`);
  return unique;
}
function setParticipants(matchId: string, studentIds: string[], staffIds: string[]) {
  db.prepare('DELETE FROM match_students WHERE match_id = ?').run(matchId);
  db.prepare('DELETE FROM match_staff WHERE match_id = ?').run(matchId);
  const s = db.prepare('INSERT INTO match_students (match_id, student_id) VALUES (?, ?)');
  const t = db.prepare('INSERT INTO match_staff (match_id, staff_id) VALUES (?, ?)');
  studentIds.forEach(id => s.run(matchId, id));
  staffIds.forEach(id => t.run(matchId, id));
}

// GET /api/matches   (admin/staff: all, student: only matches they play in)
router.get('/', (req, res) => {
  const u = req.user!;
  const rows = u.role === 'student'
    ? db.prepare('SELECT m.* FROM matches m JOIN match_students ms ON ms.match_id = m.id WHERE ms.student_id = ? ORDER BY m.date, m.start_time').all(u.refId)
    : db.prepare('SELECT * FROM matches ORDER BY date, start_time').all();
  res.json(rows.map(hydrate));
});

router.get('/:id', (req, res) => {
  const m = getOne(req.params.id);
  if (req.user!.role === 'student' && !m.studentIds.includes(req.user!.refId)) throw new HttpError(403, 'You are not part of this match');
  res.json(m);
});

// POST /api/matches   (admin)
router.post('/', requireRole('admin'), (req, res) => {
  const b = parse(matchSchema, req.body);
  const studentIds = assertIds('students', b.studentIds), staffIds = assertIds('staff', b.staffIds);
  const id = nextId('matches');
  db.transaction(() => {
    db.prepare('INSERT INTO matches (id, name, type, venue, date, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, b.name, b.type, b.venue ?? '', b.date, b.startTime ?? '', b.endTime ?? '');
    setParticipants(id, studentIds, staffIds);
    logActivity(`Match "${b.name}" scheduled`, 'primary');
  })();
  res.status(201).json(getOne(id));
});

// PUT /api/matches/:id   (admin)
router.put('/:id', requireRole('admin'), (req, res) => {
  getOne(req.params.id);
  const b = parse(matchSchema, req.body);
  const studentIds = assertIds('students', b.studentIds), staffIds = assertIds('staff', b.staffIds);
  db.transaction(() => {
    db.prepare('UPDATE matches SET name = ?, type = ?, venue = ?, date = ?, start_time = ?, end_time = ? WHERE id = ?')
      .run(b.name, b.type, b.venue ?? '', b.date, b.startTime ?? '', b.endTime ?? '', req.params.id);
    setParticipants(req.params.id, studentIds, staffIds);
  })();
  res.json(getOne(req.params.id));
});

// DELETE /api/matches/:id   (admin)  — cancels the match
router.delete('/:id', requireRole('admin'), (req, res) => {
  const m = getOne(req.params.id);
  db.transaction(() => {
    db.prepare('DELETE FROM matches WHERE id = ?').run(m.id);
    logActivity(`Match "${m.name}" cancelled`);
  })();
  res.status(204).end();
});

// PUT /api/matches/:id/results/:studentId   (admin, or staff assigned to the match)
const count = z.number().int().min(0).max(100);
const resultSchema = z.object({
  played: count, wins: count, draws: count, losses: count,
  points: z.string().trim().max(10), rank: z.string().trim().max(10),
}).refine(r => r.wins + r.draws + r.losses <= r.played, { message: 'Wins + draws + losses cannot be more than games played' });

router.put('/:id/results/:studentId', requireRole('admin', 'staff'), (req, res) => {
  const m = getOne(req.params.id);
  const u = req.user!;
  if (u.role === 'staff' && !m.staffIds.includes(u.refId)) throw new HttpError(403, 'You are not assigned to this match');
  if (!m.studentIds.includes(req.params.studentId)) throw new HttpError(400, 'That student is not part of this match');
  const r = parse(resultSchema, req.body);
  db.prepare(`INSERT INTO match_results (match_id, student_id, played, wins, draws, losses, points, rank) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(match_id, student_id) DO UPDATE SET played = excluded.played, wins = excluded.wins, draws = excluded.draws,
    losses = excluded.losses, points = excluded.points, rank = excluded.rank`)
    .run(m.id, req.params.studentId, r.played, r.wins, r.draws, r.losses, r.points, r.rank);
  const s = db.prepare('SELECT name FROM students WHERE id = ?').get(req.params.studentId) as { name: string };
  logActivity(`Result recorded for ${s.name} in "${m.name}"`, 'success');
  res.json(getOne(m.id));
});

export default router;
