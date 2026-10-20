import { db } from '../db';

const TABLES = { students: 'STU', staff: 'STF', matches: 'MTH' } as const;

export function nextId(table: keyof typeof TABLES) {
  const prefix = TABLES[table];
  const row = db
    .prepare(`SELECT MAX(CAST(SUBSTR(id, ${prefix.length + 1}) AS INTEGER)) AS n FROM ${table}`)
    .get() as { n: number | null };
  return `${prefix}${String((row.n ?? 0) + 1).padStart(3, '0')}`;
}
