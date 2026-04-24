import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

const releaseArtifactDir = resolve(process.cwd(), '.release-artifacts');

const resolveWindowsPnpmModule = () => {
  const candidate = resolve(dirname(process.execPath), 'node_modules', 'pnpm', 'bin', 'pnpm.cjs');
  if (!existsSync(candidate)) {
    throw new Error(`Failed to resolve pnpm.cjs near ${process.execPath}`);
  }
  return candidate;
};

const resolvePnpmInvocation = () => {
  if (process.platform === 'win32') {
    return {
      command: process.execPath,
      prefixArgs: [resolveWindowsPnpmModule()],
    };
  }

  return {
    command: 'pnpm',
    prefixArgs: [],
  };
};

const runOrThrow = (command, args, prefixArgs = []) => {
  const result = spawnSync(command, [...prefixArgs, ...args], {
    cwd: process.cwd(),
    stdio: 'inherit',
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${command} ${args.join(' ')}`);
  }
};

rmSync(releaseArtifactDir, { recursive: true, force: true });
mkdirSync(releaseArtifactDir, { recursive: true });

// Validate the exact tarball users install so missing runtime dependencies fail before publish.
const pnpmInvocation = resolvePnpmInvocation();
runOrThrow(
  pnpmInvocation.command,
  ['pack', '--pack-destination', releaseArtifactDir],
  pnpmInvocation.prefixArgs,
);
runOrThrow(process.execPath, ['scripts/verify-packed-bin.mjs', releaseArtifactDir]);
runOrThrow(process.execPath, ['scripts/verify-packed-install.mjs', releaseArtifactDir]);
