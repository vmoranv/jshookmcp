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
const isCi = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

if (isCi || !fs.existsSync(repoGitDir)) {
  process.exit(0);
}

if (!fs.existsSync(localBin)) {
  console.warn('[postinstall] lefthook not found locally; skipping git hook installation.');
  process.exit(0);
}

const hooksPathResult = spawnSync('git', ['config', '--local', '--get', 'core.hooksPath'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});

const configuredHooksPath = hooksPathResult.status === 0 ? hooksPathResult.stdout.trim() : '';
if (configuredHooksPath) {
  const resolvedHooksPath = path.resolve(process.cwd(), configuredHooksPath);
  const defaultHooksPath = path.resolve(repoGitDir, 'hooks');

  if (resolvedHooksPath === defaultHooksPath) {
    process.exit(0);
  }

  console.warn(
    `[postinstall] core.hooksPath is already set to "${configuredHooksPath}"; skipping git hook installation.`
  );
  process.exit(0);
}

const result = spawnSync(localBin, ['install'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: process.platform === 'win32',
});

if (result.error) {
  console.warn(
    `[postinstall] lefthook install failed to spawn: ${result.error.message}; skipping git hook installation.`
  );
} else if (result.status !== 0) {
  const firstDetailLine = [result.stdout, result.stderr]
    .join('\n')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  console.warn(
    `[postinstall] lefthook install exited with status ${result.status}; skipping git hook installation${firstDetailLine ? ` (${firstDetailLine})` : ''}.`
  );
}

process.exit(0);
