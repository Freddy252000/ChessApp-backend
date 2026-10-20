import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db, logActivity } from '../db';
import { asyncHandler, HttpError, parse } from '../middleware/error';
import { requireAuth, requireRole } from '../middleware/auth';
import { joinedLabel } from '../utils/dates';
import { nextId } from '../utils/ids';
import { batchCounts, mapStaff, mapStaffPublic, STAFF_SELECT } from '../utils/mappers';
import { deleteUpload } from '../utils/files';

const router = Router();
router.use(requireAuth);

const fields = {
  name: z.string().trim().min(1, 'Name is required').max(100),
  email: z.union([z.literal(''), z.string().trim().email('Invalid email address')]).optional(),
  phone: z.string().trim().max(30).optional(),
  batch: z.string().trim().regex(/^Batch [A-Z](, [A-Z])*$/, 'Batch must look like "Batch A" or "Batch B, C"').optional(),
  status: z.enum(['Active', 'Inactive']).optional(),
  joined: z.string().trim().max(30).optional(),
  address: z.string().trim().max(300).optional(),
  photo: z.string().max(500).nullable().optional(),
};
const username = z.string().trim().regex(/^[a-zA-Z0-9._-]{3,30}$/, 'Username must be 3–30 letters, numbers, dot, dash or underscore');
const password = z.string().min(6, 'Password must be at least 6 characters').max(100);
const createSchema = z.object({ ...fields, username, password });
const updateSchema = z.object(fields).partial().extend({ username: username.optional(), password: password.optional() });
const COLUMNS = ['name', 'email', 'phone', 'batch', 'status', 'joined', 'address', 'photo'];

const getOne = (id: string) => {
  const r = db.prepare(`${STAFF_SELECT} WHERE t.id = ?`).get(id);
  if (!r) throw new HttpError(404, 'Staff member not found');
  return mapStaff(r);
};
const usernameTaken = (name: string, exceptRef?: string) =>
  !!db.prepare('SELECT 1 FROM users WHERE username = ? AND ref_id != ?').get(name, exceptRef ?? '');

// GET /api/staff   (students only get names/photos)
router.get('/', (req, res) => {
  const rows = db.prepare(`${STAFF_SELECT} ORDER BY t.id`).all();
  if (req.user!.role === 'student') return res.json(rows.map(mapStaffPublic));
  const counts = batchCounts();
  res.json(rows.map(r => mapStaff(r, counts)));
});

// GET /api/staff/:id   (admin, or the staff member themself)
router.get('/:id', (req, res) => {
  const u = req.user!;
  if (u.role === 'student' || (u.role === 'staff' && u.refId !== req.params.id)) throw new HttpError(403, 'You do not have permission to do that');
  res.json(getOne(req.params.id));
});

// POST /api/staff   (admin)
router.post('/', requireRole('admin'), (req, res) => {
  const b = parse(createSchema, req.body);
  if (usernameTaken(b.username)) throw new HttpError(409, 'That username is already taken');
  const id = nextId('staff');
  db.transaction(() => {
    db.prepare(`INSERT INTO staff (id, name, email, phone, batch, status, joined, address, photo)
      VALUES (@id, @name, @email, @phone, @batch, @status, @joined, @address, @photo)`).run({
      id, name: b.name, email: b.email ?? '', phone: b.phone ?? '', batch: b.batch ?? 'Batch A', status: b.status ?? 'Active',
      joined: b.joined || joinedLabel(), address: b.address ?? '', photo: b.photo ?? null,
    });
    db.prepare('INSERT INTO users (ref_id, username, password_hash, role, name) VALUES (?, ?, ?, ?, ?)')
      .run(id, b.username, bcrypt.hashSync(b.password, 10), 'staff', b.name);
    logActivity(`New staff member ${b.name} added`, 'primary');
  })();
  res.status(201).json(getOne(id));
});

// PUT /api/staff/:id   (admin)
router.put('/:id', requireRole('admin'), (req, res) => {
  const id = req.params.id;
  const cur = db.prepare('SELECT * FROM staff WHERE id = ?').get(id) as any;
  if (!cur) throw new HttpError(404, 'Staff member not found');
  const b = parse(updateSchema, req.body);
  if (b.username && usernameTaken(b.username, id)) throw new HttpError(409, 'That username is already taken');

  const sets: string[] = []; const vals: Record<string, unknown> = { id };
  for (const k of COLUMNS) if (k in b && (b as any)[k] !== undefined) { sets.push(`${k} = @${k}`); vals[k] = (b as any)[k]; }

  db.transaction(() => {
    if (sets.length) db.prepare(`UPDATE staff SET ${sets.join(', ')} WHERE id = @id`).run(vals);
    const user = db.prepare('SELECT 1 FROM users WHERE ref_id = ?').get(id);
    if (user) {
      if (b.name) db.prepare('UPDATE users SET name = ? WHERE ref_id = ?').run(b.name, id);
      if (b.username) db.prepare('UPDATE users SET username = ? WHERE ref_id = ?').run(b.username, id);
      if (b.password) db.prepare('UPDATE users SET password_hash = ? WHERE ref_id = ?').run(bcrypt.hashSync(b.password, 10), id);
    } else if (b.username && b.password) {
      db.prepare('INSERT INTO users (ref_id, username, password_hash, role, name) VALUES (?, ?, ?, ?, ?)')
        .run(id, b.username, bcrypt.hashSync(b.password, 10), 'staff', b.name ?? cur.name);
    }
  })();
  if ('photo' in b && cur.photo && cur.photo !== b.photo) deleteUpload(cur.photo);
  res.json(getOne(id));
});

// DELETE /api/staff/:id   (admin)
router.delete('/:id', requireRole('admin'), (req, res) => {
  const cur = db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id) as any;
  if (!cur) throw new HttpError(404, 'Staff member not found');
  db.transaction(() => {
    db.prepare('DELETE FROM users WHERE ref_id = ?').run(cur.id);
    db.prepare('DELETE FROM staff WHERE id = ?').run(cur.id);
    logActivity(`Staff member ${cur.name} removed`);
  })();
  deleteUpload(cur.photo);
  res.status(204).end();
});

export default router;
