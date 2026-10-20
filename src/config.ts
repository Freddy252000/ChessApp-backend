import 'dotenv/config';
import path from 'path';

const isProd = process.env.NODE_ENV === 'production';
const DEV_SECRET = 'dev-secret-change-me';

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? DEV_SECRET,
  jwtExpires: process.env.JWT_EXPIRES ?? '7d',
  dbPath: process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'chess.db'),
  uploadDir: process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads'),
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
};

if (isProd && config.jwtSecret === DEV_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}
