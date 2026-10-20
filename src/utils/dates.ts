export const pad = (n: number) => String(n).padStart(2, '0');
export const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayISO = () => toISO(new Date());
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (key: string) => MONTH_NAMES[Number(key.slice(5, 7)) - 1];

export function isISODate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
export const isMonthKey = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

/** last `n` month keys ending at `end` (inclusive), oldest first */
export function lastMonths(n: number, end = monthKey()): string[] {
  const [y, m] = end.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(y, m - 1 - (n - 1 - i), 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  });
}

export function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

/** accepts DD/MM/YYYY or YYYY-MM-DD */
export function ageFromDob(dob?: string | null): number | null {
  if (!dob) return null;
  let y: number, m: number, d: number;
  let mt = dob.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mt) { d = +mt[1]; m = +mt[2]; y = +mt[3]; }
  else if ((mt = dob.match(/^(\d{4})-(\d{2})-(\d{2})$/))) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
  else return null;
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now < new Date(now.getFullYear(), m - 1, d)) age--;
  return age >= 0 && age < 120 ? age : null;
}

/** SQLite `datetime('now')` -> ISO string */
export const sqlToISO = (s: string) => (s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
export const joinedLabel = () => { const d = new Date(); return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`; };

/** Fill a month series from a map. `carry` repeats the last known value instead of 0. */
export function fillSeries(months: string[], map: Map<string, number>, carry: boolean) {
  const first = months.map(m => map.get(m)).find(v => v !== undefined) ?? 0;
  let last = carry ? first : 0;
  return months.map(m => {
    const v = map.get(m);
    if (v !== undefined) last = v; else if (!carry) return 0;
    return Math.round(last);
  });
}
export const levelFromScore = (s: number) => (s >= 80 ? 'Advanced' : s >= 65 ? 'Intermediate' : 'Beginner');
