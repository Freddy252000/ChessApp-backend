import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { db } from '../db';
import { asyncHandler, HttpError, parse } from '../middleware/error';
import { requireAuth, signToken } from '../middleware/auth';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { message: 'Too many login attempts, try again in a few minutes' },
});

const loginSchema = z.object({ username: z.string().trim().min(1, 'Username is required'), password: z.string().min(1, 'Password is required') });

// POST /api/auth/login  { username, password } -> { token, user }   (role is decided by the account)
router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const { username, password } = parse(loginSchema, req.body);
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
  const ok = u && (await bcrypt.compare(password, u.password_hash));
  if (!ok) throw new HttpError(401, 'Invalid username or password');
  res.json({ token: signToken(u.ref_id), user: { refId: u.ref_id, username: u.username, name: u.name, role: u.role } });
}));

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => { res.json(req.user); });

// POST /api/auth/change-password  { currentPassword, newPassword }
router.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = parse(z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(6, 'New password must be at least 6 characters').max(100),
  }), req.body);
  const u = db.prepare('SELECT password_hash FROM users WHERE ref_id = ?').get(req.user!.refId) as any;
  if (!(await bcrypt.compare(currentPassword, u.password_hash))) throw new HttpError(400, 'Current password is incorrect');
  db.prepare('UPDATE users SET password_hash = ? WHERE ref_id = ?').run(await bcrypt.hash(newPassword, 10), req.user!.refId);
  res.json({ ok: true });
}));

export default router;
