import jwt from 'jsonwebtoken';
import { RequestHandler } from 'express';
import { config } from '../config';
import { db } from '../db';
import { HttpError } from './error';

export type Role = 'admin' | 'staff' | 'student';
export interface JwtUser { refId: string; role: Role; username: string; name: string }

export const signToken = (refId: string) =>
  jwt.sign({ sub: refId }, config.jwtSecret, { expiresIn: config.jwtExpires as jwt.SignOptions['expiresIn'] });

export const requireAuth: RequestHandler = (req, _res, next) => {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return next(new HttpError(401, 'Please sign in'));
  try {
    const payload = jwt.verify(h.slice(7), config.jwtSecret) as { sub: string };
    // always read the user from the DB so deleted users / renamed users are respected immediately
    const row = db.prepare('SELECT ref_id, role, username, name FROM users WHERE ref_id = ?').get(payload.sub) as
      | { ref_id: string; role: Role; username: string; name: string } | undefined;
    if (!row) return next(new HttpError(401, 'Account no longer exists'));
    req.user = { refId: row.ref_id, role: row.role, username: row.username, name: row.name };
    next();
  } catch {
    next(new HttpError(401, 'Session expired, please sign in again'));
  }
};

export const requireRole = (...roles: Role[]): RequestHandler => (req, _res, next) =>
  req.user && roles.includes(req.user.role) ? next() : next(new HttpError(403, 'You do not have permission to do that'));

/** students may only see their own record */
export function assertCanViewStudent(user: JwtUser | undefined, studentId: string) {
  if (!user) throw new HttpError(401, 'Please sign in');
  if (user.role === 'student' && user.refId !== studentId) throw new HttpError(403, 'You can only view your own data');
}
