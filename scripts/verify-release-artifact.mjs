import { mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const releaseArtifactDir = resolve(process.cwd(), '.release-artifacts');

const resolveWindowsCommand = (commandName) => {
  const lookup = spawnSync('where.exe', [commandName], {
    encoding: 'utf8',
    windowsHide: true,
  });

  if (lookup.error) {
    throw lookup.error;
  }
  if (lookup.status !== 0) {
    throw new Error(`Failed to resolve ${commandName}: ${lookup.stderr}`);
  }

  const resolvedPath = lookup.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!resolvedPath) {
    throw new Error(`where.exe returned no path for ${commandName}`);
  }

  return resolvedPath;
};

const pnpmCommand =
  process.platform === 'win32' ? resolveWindowsCommand('pnpm.cmd') : 'pnpm';

const quoteWindowsArg = (value) => {
  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
};

const runOrThrow = (command, args) => {
  const invocation =
    process.platform === 'win32'
      ? {
          command: 'cmd.exe',
          args: ['/d', '/s', '/c', [command, ...args].map(quoteWindowsArg).join(' ')],
        }
      : { command, args };

  const result = spawnSync(invocation.command, invocation.args, {
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
runOrThrow(pnpmCommand, ['pack', '--pack-destination', releaseArtifactDir]);
runOrThrow(process.execPath, ['scripts/verify-packed-bin.mjs', releaseArtifactDir]);
runOrThrow(process.execPath, ['scripts/verify-packed-install.mjs', releaseArtifactDir]);
