import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packageJsonPath = resolve(process.cwd(), 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const binEntries = [...new Set(Object.values(packageJson.bin ?? {}))];

for (const relativePath of binEntries) {
  const binPath = resolve(process.cwd(), relativePath);

  if (!existsSync(binPath)) {
    throw new Error(`Bin target not found: ${relativePath}`);
  }

  const fileText = readFileSync(binPath, 'utf8');
  if (!fileText.startsWith('#!')) {
    throw new Error(`Bin target is missing a shebang: ${relativePath}`);
  }

  if (process.platform !== 'win32') {
    chmodSync(binPath, 0o755);
  }
}
