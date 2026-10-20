import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../db';
import { asyncHandler, HttpError, parse } from '../middleware/error';
import { requireAuth, requireRole } from '../middleware/auth';

const router = Router();
router.use(requireAuth, requireRole('admin'));

// POST /api/users/:refId/password  { password }   (admin resets anyone's password)
router.post('/:refId/password', asyncHandler(async (req, res) => {
  const { password } = parse(z.object({ password: z.string().min(6, 'Password must be at least 6 characters').max(100) }), req.body);
  const r = db.prepare('UPDATE users SET password_hash = ? WHERE ref_id = ?').run(await bcrypt.hash(password, 10), req.params.refId);
  if (!r.changes) throw new HttpError(404, 'That user has no login account');
  res.json({ ok: true });
}));

export default router;
