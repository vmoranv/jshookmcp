const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// ── Native module ABI compatibility check ──────────────────────────────────
// When switching Node versions, native modules (better-sqlite3, isolated-vm,
// koffi) may have been compiled against a different NODE_MODULE_VERSION.
// Detect this and auto-rebuild to avoid runtime ERR_DLOPEN_FAILED errors.

const NATIVE_MODULES = ['better-sqlite3', 'isolated-vm', 'koffi'];

function checkNativeModuleAbi() {
  const isCiEnv = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
  if (isCiEnv) return; // CI handles its own builds

  const needsRebuild = [];

  for (const mod of NATIVE_MODULES) {
    try {
      require(mod);
    } catch (err) {
      const msg = err && err.message ? err.message : '';
      if (
        msg.includes('NODE_MODULE_VERSION') ||
        msg.includes('ERR_DLOPEN_FAILED') ||
        msg.includes('was compiled against a different')
      ) {
        needsRebuild.push(mod);
      }
      // Other errors (e.g. module not installed) are fine — skip silently
    }
  }

  if (needsRebuild.length === 0) return;

  console.log(
    `[postinstall] Native module ABI mismatch detected for: ${needsRebuild.join(', ')}`
  );
  console.log(
    `[postinstall] Auto-rebuilding for Node ${process.version} (ABI ${process.versions.modules})...`
  );

  for (const mod of needsRebuild) {
    const result = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), 'node_modules', '.pnpm', 'node_modules', '.bin', 'node-gyp') ||
          'node-gyp',
        'rebuild',
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: path.dirname(require.resolve(`${mod}/package.json`)),
        shell: process.platform === 'win32',
        timeout: 120_000,
      }
    );

    // Fallback: use npm rebuild for the specific module
    if (result.status !== 0) {
      const npmResult = spawnSync('npm', ['rebuild', mod, '--foreground-scripts'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: process.cwd(),
        shell: true,
        timeout: 120_000,
      });
      if (npmResult.status === 0) {
        console.log(`[postinstall] ✓ Rebuilt ${mod} successfully`);
      } else {
        console.warn(
          `[postinstall] ✗ Failed to rebuild ${mod}. Run manually: npm rebuild ${mod} --foreground-scripts`
        );
      }
    } else {
      console.log(`[postinstall] ✓ Rebuilt ${mod} successfully`);
    }
  }
}

try {
  checkNativeModuleAbi();
} catch (err) {
  // Never let the ABI check block installation
  console.warn(`[postinstall] ABI check failed (non-fatal): ${err && err.message ? err.message : err}`);
}

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
