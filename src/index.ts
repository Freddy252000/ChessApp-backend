import { createApp } from './app';
import { config } from './config';
import { migrate } from './db';
import { seedIfEmpty } from './seed';

migrate();
seedIfEmpty();

createApp().listen(config.port, '0.0.0.0', () => {
  console.log(`Chess Academy API running on http://localhost:${config.port}  (health: /api/health)`);
});
