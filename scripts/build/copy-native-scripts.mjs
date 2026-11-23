import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { rmSyncWithRetries } from '../lib/fs-retry.mjs';

const src = join(process.cwd(), 'src', 'native', 'scripts');
const dst = join(process.cwd(), 'dist', 'native', 'scripts');

if (existsSync(src)) {
  rmSyncWithRetries(dst, { recursive: true, force: true });
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: true, force: true });
}
