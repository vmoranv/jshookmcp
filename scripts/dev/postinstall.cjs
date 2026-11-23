const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// ── Dev-checkout setup (NOT a package lifecycle hook) ───────────────────────
//
// ⚠️ This script is deliberately NOT wired to the `postinstall` lifecycle event
// any more, and it is deliberately NOT listed in package.json `files`.
//
// Reason: the package is published under npm's Dual-Use Content Policy, where
// any install-time code execution is a blocking signal for automated review.
// Shipping a `postinstall` script provided zero value to consumers (it always
// exited 0 outside a dev checkout — see shouldSkipPostinstall below) while
// looking exactly like an install-time payload. So it was removed from the
// published surface entirely.
//
// Contributors run it explicitly:  pnpm run hooks:install
//
// What it does, in a dev checkout only:
//   - rebuilds a native module whose ABI no longer matches the active Node
//     version. The hardcoded pnpm store paths below do not exist elsewhere, so
//     outside a dev checkout an ABI check would silently fall through to
//     `npm rebuild`, which *compiles* isolated-vm / better-sqlite3 and peaks at
//     1.5–2.5 GB — enough to OOM a 2 GB VPS. Hence the skip list.
//   - installs git hooks via lefthook.

const NATIVE_MODULES = ['better-sqlite3', 'isolated-vm', 'koffi'];

/**
 * True when `cwd` is inside an npx / pnpm dlx temporary extraction directory
 * (e.g. `~/.npm/_npx/<hash>/node_modules/@jshookmcp/jshook`).
 *
 * @param {string} cwd process.cwd()
 * @returns {boolean}
 */
function isNpxTempDir(cwd) {
  const segments = String(cwd).split(path.sep).filter(Boolean);
  return segments.includes('_npx');
}

/**
 * Decide whether the postinstall native-ABI check should be skipped.
 *
 * @param {Record<string, string | undefined>} env process.env
 * @param {string} cwd process.cwd()
 * @param {boolean} isDevRepo true when `cwd` looks like the dev checkout
 *   (contains `.git`, `src/index.ts` or `tsconfig.json` — none of which ship in
 *   the published package)
 * @returns {boolean} true to skip the ABI check
 */
function shouldSkipPostinstall(env, cwd, devRepo) {
  if (env.CI === 'true' || env.GITHUB_ACTIONS === 'true') return true; // CI builds itself
  if (env.npm_config_global === 'true') return true; // global install — no dev ABI rebuild
  if (isNpxTempDir(cwd)) return true; // npx / pnpm dlx cache extraction
  if (!devRepo) return true; // plain install of the published package
  return false;
}

/**
 * True when `cwd` looks like the dev checkout rather than the published package.
 *
 * @param {string} cwd process.cwd()
 * @returns {boolean}
 */
function isDevRepo(cwd) {
  // A dev checkout carries the TypeScript source entry, tsconfig, or a .git
  // directory — none of which are published ("files" whitelist excludes them).
  return (
    fs.existsSync(path.join(cwd, '.git')) ||
    fs.existsSync(path.join(cwd, 'src', 'index.ts')) ||
    fs.existsSync(path.join(cwd, 'tsconfig.json'))
  );
}

function checkNativeModuleAbi() {
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
    `[setup] Native module ABI mismatch detected for: ${needsRebuild.join(', ')}`
  );
  console.log(
    `[setup] Auto-rebuilding for Node ${process.version} (ABI ${process.versions.modules})...`
  );

  for (const mod of needsRebuild) {
    const result = spawnSync(
      process.execPath,
      [path.join(process.cwd(), 'node_modules', '.pnpm', 'node_modules', '.bin', 'node-gyp'), 'rebuild'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: path.dirname(require.resolve(`${mod}/package.json`)),
        shell: process.platform === 'win32',
        timeout: 120_000,
      }
    );

    if (result.status === 0) {
      console.log(`[setup] ✓ Rebuilt ${mod} successfully`);
    } else {
      // Do NOT fall back to `npm rebuild` — compiling native modules can OOM a
      // low-memory machine. Prompt the developer to rebuild explicitly instead.
      console.warn(
        `[setup] ✗ Could not rebuild ${mod} automatically. ` +
          `Run manually under the active Node version: npm rebuild ${mod} --foreground-scripts`
      );
    }
  }
}

function installGitHooks() {
  const repoGitDir = path.join(process.cwd(), '.git');
  if (!fs.existsSync(repoGitDir)) {
    process.exit(0);
  }

  const localBin = path.join(
    process.cwd(),
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'lefthook.cmd' : 'lefthook'
  );

  if (!fs.existsSync(localBin)) {
    console.warn('[setup] lefthook not found locally; skipping git hook installation.');
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
      `[setup] core.hooksPath is already set to "${configuredHooksPath}"; skipping git hook installation.`
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
      `[setup] lefthook install failed to spawn: ${result.error.message}; skipping git hook installation.`
    );
  } else if (result.status !== 0) {
    const firstDetailLine = [result.stdout, result.stderr]
      .join('\n')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    console.warn(
      `[setup] lefthook install exited with status ${result.status}; skipping git hook installation${firstDetailLine ? ` (${firstDetailLine})` : ''}.`
    );
  }
}

function main() {
  const env = process.env;
  const cwd = process.cwd();

  if (shouldSkipPostinstall(env, cwd, isDevRepo(cwd))) {
    process.exit(0);
  }

  try {
    checkNativeModuleAbi();
  } catch (err) {
    // Never let the ABI check block installation
    console.warn(`[setup] ABI check failed (non-fatal): ${err && err.message ? err.message : err}`);
  }

  installGitHooks();

  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { isNpxTempDir, shouldSkipPostinstall };
