/**
 * Thin wrapper around Node's BUILT-IN SQLite (`node:sqlite`, Node 22.13+).
 * No native add-on to compile → `npm install` works on Windows without Visual Studio / Python.
 * The API mirrors the small subset of better-sqlite3 the server uses: prepare().run/get/all, exec(), transaction().
 */
import fs from 'fs';
import path from 'path';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(
    `\nThe Chess Academy server needs Node.js 22.13 or newer (you are running ${process.versions.node}).\n` +
    `  Windows (nvm):  nvm install 22.13.0   then   nvm use 22.13.0   (run PowerShell as Administrator)\n` +
    `  Then run:       node -v   to confirm, and   npm install   again.\n`,
  );
  process.exit(1);
}

// node:sqlite prints an "ExperimentalWarning" on load – hide just that one line
const original = process.emitWarning;
process.emitWarning = ((w: unknown, ...rest: unknown[]) =>
  String((w as Error)?.message ?? w).includes('SQLite') ? undefined : (original as any).call(process, w, ...rest)) as typeof process.emitWarning;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
process.emitWarning = original;

const bindable = (v: unknown): unknown => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
const clean = (params: unknown[]) =>
  params.map(p =>
    p && typeof p === 'object' && !(p instanceof Uint8Array)
      ? Object.fromEntries(Object.entries(p).map(([k, v]) => [k, bindable(v)])) // named parameters
      : bindable(p));

export interface Statement {
  run(...params: any[]): { changes: number; lastInsertRowid: number };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}
export interface Db {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  transaction<F extends (...args: any[]) => any>(fn: F): F;
}

export function openDatabase(file: string): Db {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA foreign_keys = ON');
  if (file !== ':memory:') raw.exec('PRAGMA journal_mode = WAL');

  const cache = new Map<string, import('node:sqlite').StatementSync>();
  const stmt = (sql: string) => {
    let s = cache.get(sql);
    if (!s) {
      if (cache.size > 300) cache.clear(); // dynamic SQL (IN lists) – keep the cache bounded
      s = raw.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };

  let depth = 0;
  return {
    exec: sql => raw.exec(sql),
    prepare: sql => ({
      run: (...p) => {
        const r = stmt(sql).run(...(clean(p) as any[]));
        return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
      },
      get: (...p) => stmt(sql).get(...(clean(p) as any[])),
      all: (...p) => stmt(sql).all(...(clean(p) as any[])),
    }),
    // BEGIN/COMMIT with SAVEPOINTs for nesting, like better-sqlite3's transaction()
    transaction: fn =>
      ((...args: any[]) => {
        const sp = `sp${depth}`;
        raw.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${sp}`);
        depth++;
        try {
          const result = fn(...args);
          depth--;
          raw.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
          return result;
        } catch (e) {
          depth--;
          if (depth === 0) raw.exec('ROLLBACK');
          else { raw.exec(`ROLLBACK TO ${sp}`); raw.exec(`RELEASE ${sp}`); }
          throw e;
        }
      }) as typeof fn,
  };
}
