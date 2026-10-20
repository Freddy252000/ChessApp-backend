import { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, ZodType } from 'zod';
import multer from 'multer';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler =>
  (req, res, next) => { Promise.resolve(fn(req, res, next)).catch(next); };

/** validate and return typed data, throws 400 with a readable message */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  throw zodToHttp(r.error);
}

function zodToHttp(err: ZodError) {
  const i = err.issues[0];
  const field = i.path.length ? `${i.path.join('.')}: ` : '';
  return new HttpError(400, `${field}${i.message}`);
}

export const notFound: RequestHandler = (_req, res) => { res.status(404).json({ message: 'Route not found' }); };

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message });
  if (err instanceof ZodError) { const e = zodToHttp(err); return res.status(e.status).json({ message: e.message }); }
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: err.code === 'LIMIT_FILE_SIZE' ? 'Image is too large (max 5 MB)' : err.message });
  }
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ message: 'Invalid JSON body' });
  // node:sqlite error codes: 2067 = UNIQUE constraint, 1555 = PRIMARY KEY constraint
  if (err?.errcode === 2067 || err?.errcode === 1555) return res.status(409).json({ message: 'That value already exists' });
  console.error(err);
  res.status(500).json({ message: 'Something went wrong on the server' });
};
