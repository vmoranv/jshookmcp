import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
const packageName = packageJson.name;
const binName = Object.keys(packageJson.bin ?? {})[0] ?? 'jshook';
const inputPath = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(process.cwd(), '.release-artifacts');

const resolveNpmCommand = () => {
  if (process.platform !== 'win32') {
    return { command: 'npm', prefixArgs: [] };
  }

  const whereResult = spawnSync('where.exe', ['npm.cmd'], {
    encoding: 'utf8',
    windowsHide: true,
  });

  if (whereResult.status !== 0) {
    throw new Error(`Failed to resolve npm.cmd via where.exe: ${whereResult.stderr}`);
  }

  const resolvedPath = whereResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!resolvedPath) {
    throw new Error('where.exe returned no npm.cmd path');
  }

  return { command: resolvedPath, prefixArgs: [] };
};

const npmRunner = resolveNpmCommand();

const resolveTarballPath = (candidatePath) => {
  if (candidatePath.endsWith('.tgz')) {
    return candidatePath;
  }

  const tarballs = readdirSync(candidatePath)
    .filter((entry) => entry.endsWith('.tgz'))
    .map((entry) => resolve(candidatePath, entry))
    .toSorted();

  if (tarballs.length !== 1) {
    throw new Error(`Expected exactly one tarball in ${candidatePath}, found ${tarballs.length}`);
  }

  return tarballs[0];
};

function createTempProject(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: `${prefix}-fixture`, private: true }, null, 2),
  );
  return dir;
}

function listRepoWorkflowNames(repoWorkflowRoot) {
  return readdirSync(repoWorkflowRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(repoWorkflowRoot, name, 'workflow.js')))
    .toSorted();
}

async function removeDirWithRetries(dir, retries = 12, delayMs = 250) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (attempt === retries) {
        break;
      }
      await delay(delayMs * (attempt + 1));
    }
  }

  console.warn(
    `Warning: failed to remove temporary directory ${dir}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function run(command, args, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, npm_config_loglevel: 'warn' },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', rejectPromise);
    child.on('close', (code) => {
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });
}

function smokeExec(command, args, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, npm_config_loglevel: 'warn' },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      handler(value);
    };

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => finish(rejectPromise, error));
    child.on('close', (code, signal) => {
      finish(
        rejectPromise,
        new Error(
          `Smoke execution exited before MCP handshake wait state (code=${code}, signal=${signal ?? 'none'})\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    });

    setTimeout(() => {
      if (process.platform === 'win32') {
        spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      } else {
        child.kill('SIGTERM');
      }
      child.stdin?.end();
      finish(resolvePromise, { stdout, stderr });
    }, 1500);
  });
}

const tarballPath = resolveTarballPath(inputPath);
const installDir = createTempProject('jshook-pack-install-');
const execDir = createTempProject('jshook-pack-exec-');

try {
  const installResult = await run(
    npmRunner.command,
    [...npmRunner.prefixArgs, 'install', '--no-audit', '--no-fund', tarballPath],
    installDir,
  );

  if (installResult.code !== 0) {
    throw new Error(
      `Failed to install packed tarball ${tarballPath}\nstdout:\n${installResult.stdout}\nstderr:\n${installResult.stderr}`,
    );
  }

  const installedPackageDir = join(installDir, 'node_modules', ...packageName.split('/'));
  if (!existsSync(installedPackageDir)) {
    throw new Error(`Installed package directory is missing: ${installedPackageDir}`);
  }

  const repoWorkflowRoot = resolve(process.cwd(), 'workflows');
  const repoWorkflowNames = listRepoWorkflowNames(repoWorkflowRoot);
  const requiredWorkflowPaths = repoWorkflowNames.map((name) =>
    join(installedPackageDir, 'workflows', name, 'workflow.js'),
  );
  for (const workflowPath of requiredWorkflowPaths) {
    if (!existsSync(workflowPath)) {
      throw new Error(`Installed package is missing required workflow asset: ${workflowPath}`);
    }
  }

  for (const workflowName of repoWorkflowNames) {
    const workflowPath = join(installedPackageDir, 'workflows', workflowName, 'workflow.js');

    try {
      const mod = await import(pathToFileURL(workflowPath).href);
      if (!mod?.default || mod.default.kind !== 'workflow-contract') {
        throw new Error('default export is not a workflow contract');
      }
    } catch (error) {
      const stackOrMessage =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      throw new Error(`Installed workflow failed to load: ${workflowPath}\n${stackOrMessage}`, {
        cause: error,
      });
    }
  }

  const installedBinPath = join(
    installDir,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? `${binName}.cmd` : binName,
  );
  if (!existsSync(installedBinPath)) {
    throw new Error(`Installed executable shim is missing: ${installedBinPath}`);
  }

  const smokeCommand =
    process.platform === 'win32'
      ? { command: installedBinPath, args: [] }
      : {
          command: npmRunner.command,
          args: [...npmRunner.prefixArgs, 'exec', '--yes', '--package', tarballPath, binName],
        };

  const smokeResult = await smokeExec(smokeCommand.command, smokeCommand.args, execDir);

  if (smokeResult.stdout.trim().length > 0) {
    throw new Error(
      `Packed tarball wrote to stdout before any MCP handshake.\nstdout:\n${smokeResult.stdout}\nstderr:\n${smokeResult.stderr}`,
    );
  }

  if (/\[Config\]/.test(smokeResult.stderr)) {
    throw new Error(
      `Packed tarball emitted config bootstrap noise before handshake.\nstderr:\n${smokeResult.stderr}`,
    );
  }

  console.log(`Verified packed install + npm exec smoke test for ${tarballPath}`);
} finally {
  await removeDirWithRetries(installDir);
  await removeDirWithRetries(execDir);
}
