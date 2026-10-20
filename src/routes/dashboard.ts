import { Router } from 'express';
import { db } from '../db';
import { requireAuth, requireRole, JwtUser } from '../middleware/auth';
import { fillSeries, lastMonths, monthKey, monthLabel, sqlToISO } from '../utils/dates';
import { staffBatchLetters } from '../utils/mappers';

const router = Router();
router.use(requireAuth, requireRole('admin', 'staff'));

const AVG_CURRENT = `
  SELECT AVG(a.score) AS v FROM assessments a
  WHERE a.id = (SELECT id FROM assessments WHERE student_id = a.student_id ORDER BY date DESC, id DESC LIMIT 1)
    AND a.student_id IN (SELECT id FROM students WHERE status = 'Active' {{FILTER}})`;

export function perfTrend() {
  const months = lastMonths(12);
  const rows = db.prepare('SELECT substr(date, 1, 7) AS m, AVG(score) AS v FROM assessments GROUP BY m').all() as { m: string; v: number }[];
  const values = fillSeries(months, new Map(rows.map(r => [r.m, r.v])), true);
  return { trend: { labels: months.map(monthLabel), values }, delta: values[11] - values[10] };
}

function latestAttendance(filterSql = '', params: unknown[] = []) {
  const d = db.prepare(`SELECT MAX(a.date) AS d FROM attendance a ${filterSql ? `JOIN students s ON s.id = a.student_id WHERE ${filterSql}` : ''}`).get(...params) as { d: string | null };
  if (!d.d) return null;
  const r = db.prepare(`SELECT COALESCE(SUM(a.present),0) AS present, COUNT(*) AS total FROM attendance a ${filterSql ? 'JOIN students s ON s.id = a.student_id' : ''}
    WHERE a.date = ? ${filterSql ? `AND ${filterSql}` : ''}`).get(d.d, ...params) as { present: number; total: number };
  return { date: d.d, present: r.present, total: r.total, percent: r.total ? Math.round((100 * r.present) / r.total) : 0 };
}

// GET /api/dashboard  (admin → academy stats, staff → stats for their batches)
router.get('/', (req, res) => {
  const u = req.user as JwtUser;
  if (u.role === 'admin') {
    const st = db.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(status = 'Active'), 0) AS active FROM students").get() as any;
    const sf = db.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(status = 'Active'), 0) AS active FROM staff").get() as any;
    const avg = (db.prepare(AVG_CURRENT.replace('{{FILTER}}', '')).get() as { v: number | null }).v ?? 0;
    const { trend, delta } = perfTrend();
    const activity = (db.prepare('SELECT id, text, type, created_at FROM activity ORDER BY id DESC LIMIT 6').all() as any[])
      .map(a => ({ id: a.id, text: a.text, type: a.type, time: sqlToISO(a.created_at) }));
    return res.json({
      students: st, staff: sf, attendance: latestAttendance(),
      performance: { avg: Math.round(avg), delta }, trend, activity,
    });
  }

  // staff
  const me = db.prepare('SELECT batch FROM staff WHERE id = ?').get(u.refId) as { batch: string } | undefined;
  const batches = staffBatchLetters(me?.batch ?? '').map(l => `Batch ${l}`);
  const ph = batches.map(() => '?').join(',') || "''";
  const students = db.prepare(`SELECT s.id, s.name, s.photo, s.level,
      COALESCE((SELECT x.score FROM assessments x WHERE x.student_id = s.id ORDER BY x.date DESC, x.id DESC LIMIT 1), 0) AS performance
    FROM students s WHERE s.status = 'Active' AND s.batch IN (${ph}) ORDER BY s.name`).all(...batches) as any[];
  const scored = students.filter(s => s.performance > 0); // ignore students with no assessment yet
  const avg = scored.length ? scored.reduce((n, s) => n + s.performance, 0) / scored.length : 0;
  const month = db.prepare(`SELECT COALESCE(SUM(a.present),0) AS p, COUNT(*) AS t FROM attendance a JOIN students s ON s.id = a.student_id
    WHERE substr(a.date,1,7) = ? AND s.batch IN (${ph})`).get(monthKey(), ...batches) as { p: number; t: number };
  res.json({
    batch: me?.batch ?? '', myStudents: students.length,
    attendance: latestAttendance(`s.batch IN (${ph})`, batches),
    monthRate: month.t ? Math.round((100 * month.p) / month.t) : 0,
    performance: { avg: Math.round(avg), delta: perfTrend().delta },
    students: students.map(s => ({ id: s.id, name: s.name, photo: s.photo ?? undefined, level: s.level, performance: s.performance })),
  });
});

export default router;
