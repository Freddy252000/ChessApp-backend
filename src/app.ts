import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config';
import { errorHandler, notFound } from './middleware/error';
import auth from './routes/auth';
import users from './routes/users';
import students from './routes/students';
import staff from './routes/staff';
import attendance from './routes/attendance';
import matches from './routes/matches';
import dashboard from './routes/dashboard';
import reports from './routes/reports';
import uploads from './routes/uploads';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map(s => s.trim()) }));
  app.use(express.json({ limit: '1mb' }));
  if (process.env.NODE_ENV !== 'test') app.use(morgan(config.isProd ? 'combined' : 'dev'));

  app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d' }));

  app.get('/api/health', (_req, res) => { res.json({ status: 'ok', time: new Date().toISOString() }); });
  app.use('/api/auth', auth);
  app.use('/api/users', users);
  app.use('/api/students', students);
  app.use('/api/staff', staff);
  app.use('/api/attendance', attendance);
  app.use('/api/matches', matches);
  app.use('/api/dashboard', dashboard);
  app.use('/api/reports', reports);
  app.use('/api/uploads', uploads);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
