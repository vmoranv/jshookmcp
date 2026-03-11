const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoGitDir = path.join(process.cwd(), '.git');
const localBin = path.join(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'lefthook.cmd' : 'lefthook'
);

if (!fs.existsSync(repoGitDir)) {
  process.exit(0);
}

if (!fs.existsSync(localBin)) {
  console.warn('[postinstall] lefthook not found locally; skipping git hook installation.');
  process.exit(0);
}

const result = spawnSync(localBin, ['install'], { stdio: 'inherit' });

if (result.error || result.status !== 0) {
  console.warn('[postinstall] lefthook install failed; skipping git hook installation.');
}

process.exit(0);
