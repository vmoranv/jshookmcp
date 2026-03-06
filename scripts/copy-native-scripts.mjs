import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

const src = join(process.cwd(), 'src', 'native', 'scripts');
const dst = join(process.cwd(), 'dist', 'native', 'scripts');

if (existsSync(src)) {
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: true, force: true });
}
