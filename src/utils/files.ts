import fs from 'fs';
import path from 'path';
import { config } from '../config';

/** delete an uploaded file if `photo` points to our /uploads folder (best effort) */
export function deleteUpload(photo?: string | null) {
  if (!photo) return;
  const m = photo.match(/\/uploads\/([\w.-]+)$/);
  if (!m) return;
  fs.unlink(path.join(config.uploadDir, m[1]), () => {});
}
