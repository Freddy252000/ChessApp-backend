import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { config } from '../config';
import { HttpError } from '../middleware/error';
import { requireAuth } from '../middleware/auth';

const EXT: Record<string, string> = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, config.uploadDir),
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${EXT[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => (EXT[file.mimetype] ? cb(null, true) : cb(new HttpError(400, 'Only JPG, PNG or WebP images are allowed'))),
});

const router = Router();

// POST /api/uploads/photo   multipart/form-data, field "photo"  ->  { url: "/uploads/<file>" }
router.post('/photo', requireAuth, upload.single('photo'), (req, res) => {
  if (!req.file) throw new HttpError(400, 'No photo uploaded');
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
});

export default router;
