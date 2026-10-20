import type { JwtUser } from './middleware/auth';

declare global {
  namespace Express {
    interface Request { user?: JwtUser }
  }
}
export {};
