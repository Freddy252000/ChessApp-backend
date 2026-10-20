import { Router } from 'express';
import { db } from '../db';
import { HttpError } from '../middleware/error';
import { assertCanViewStudent, requireAuth, requireRole } from '../middleware/auth';
import { fillSeries, isMonthKey, lastMonths, levelFromScore, monthKey, monthLabel } from '../utils/dates';
import { STUDENT_SELECT } from '../utils/mappers';

const router = Router();
router.use(requireAuth);

const monthParam = (q: unknown) => (typeof q === 'string' && isMonthKey(q) ? q : monthKey());
const prevMonth = (key: string) => lastMonths(2, key)[0];

// GET /api/reports/summary?month=YYYY-MM   (admin/staff)
router.get('/summary', requireRole('admin', 'staff'), (req, res) => {
  const month = monthParam(req.query.month);
  const prev = prevMonth(month);
  const months = lastMonths(12, month);

  const attRows = db.prepare('SELECT substr(date, 1, 7) AS m, 100.0 * SUM(present) / COUNT(*) AS v FROM attendance GROUP BY m').all() as { m: string; v: number }[];
  const attMap = new Map(attRows.map(r => [r.m, r.v]));
  const perDay = db.prepare('SELECT AVG(c) AS v FROM (SELECT SUM(present) AS c FROM attendance WHERE substr(date, 1, 7) = ? GROUP BY date)').get(month) as { v: number | null };
  const perStudent = db.prepare(`
    SELECT s.id, s.name, s.photo, COALESCE(ROUND(100.0 * SUM(a.present) / NULLIF(COUNT(a.present), 0)), 0) AS percent
    FROM students s LEFT JOIN attendance a ON a.student_id = s.id AND substr(a.date, 1, 7) = ?
    WHERE s.status = 'Active' GROUP BY s.id ORDER BY s.id`).all(month) as any[];

  const perfRows = db.prepare('SELECT substr(date, 1, 7) AS m, AVG(score) AS v FROM assessments GROUP BY m').all() as { m: string; v: number }[];
  const perfMap = new Map(perfRows.map(r => [r.m, r.v]));
  const overall = (db.prepare('SELECT AVG(performance) AS v FROM (' + STUDENT_SELECT + ") WHERE status = 'Active' AND performance > 0").get() as { v: number | null }).v ?? 0;
  const perfAvg = perfMap.get(month) ?? overall;
  const delta = perfMap.has(month) && perfMap.has(prev) ? Math.round(perfMap.get(month)! - perfMap.get(prev)!) : 0;

  const classes = db.prepare('SELECT COUNT(DISTINCT date) AS n FROM attendance WHERE substr(date, 1, 7) = ?').get(month) as { n: number };
  const assess = db.prepare('SELECT COUNT(*) AS n FROM assessments WHERE substr(date, 1, 7) = ?').get(month) as { n: number };
  const enrolled = db.prepare("SELECT COUNT(*) AS n FROM students WHERE status = 'Active'").get() as { n: number };
  const top = db.prepare('SELECT name FROM (' + STUDENT_SELECT + ') ORDER BY performance DESC, name LIMIT 1').get() as { name: string } | undefined;

  res.json({
    month,
    attendance: {
      avg: Math.round(attMap.get(month) ?? 0), avgPresentPerDay: Math.round(perDay.v ?? 0),
      monthly: { labels: months.map(monthLabel), values: fillSeries(months, attMap, false) },
      perStudent: perStudent.map(s => ({ id: s.id, name: s.name, photo: s.photo ?? undefined, percent: Number(s.percent) })),
    },
    performance: {
      avg: Math.round(perfAvg), delta,
      trend: { labels: months.map(monthLabel), values: fillSeries(months, perfMap, true) },
    },
    monthly: {
      totalClasses: classes.n, enrolled: enrolled.n, avgAttendance: Math.round(attMap.get(month) ?? 0),
      avgPerformance: Math.round(perfAvg), assessments: assess.n, topPerformer: top?.name ?? '—',
    },
  });
});

// GET /api/reports/student/:id?month=YYYY-MM   (admin/staff, or the student themself)
router.get('/student/:id', (req, res) => {
  const id = req.params.id;
  assertCanViewStudent(req.user, id);
  const s = db.prepare('SELECT id, name, level FROM students WHERE id = ?').get(id) as { id: string; name: string; level: string } | undefined;
  if (!s) throw new HttpError(404, 'Student not found');
  const month = monthParam(req.query.month);

  const t = db.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(present), 0) AS present FROM attendance WHERE student_id = ? AND substr(date, 1, 7) = ?').get(id, month) as { total: number; present: number };
  const rows = db.prepare('SELECT id, date, score FROM assessments WHERE student_id = ? AND date <= ? ORDER BY date DESC, id DESC').all(id, `${month}-31`) as { id: number; date: string; score: number }[];
  const score = rows[0]?.score ?? 0, previous = rows[1]?.score ?? null;

  res.json({
    month, student: s, totalClasses: t.total, present: t.present, absent: t.total - t.present,
    percent: t.total ? Math.round((100 * t.present) / t.total) : 0,
    performance: { score, previous, improvement: previous === null ? 0 : score - previous, level: levelFromScore(score) },
    history: rows.slice(0, 6).map((r, i) => ({ id: r.id, date: r.date, score: r.score, level: levelFromScore(r.score), delta: rows[i + 1] ? r.score - rows[i + 1].score : null })),
  });
});

export default router;
