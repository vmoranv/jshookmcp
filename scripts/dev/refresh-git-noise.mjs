import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function git(args, { allowFailure = false } = {}) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  } catch (error) {
    if (allowFailure) {
      return '';
    }

    const stderr = error.stderr ? `\n${String(error.stderr).trim()}` : '';
    throw new Error(`git ${args.join(' ')} failed${stderr}`, {
      cause: error,
    });
  }
}

function parseNullSeparated(text) {
  return text.split('\0').filter(Boolean);
}

async function getIndexObjectId(filePath) {
  const output = await git(['ls-files', '--stage', '-z', '--', filePath], {
    allowFailure: true,
  });
  const entry = output.split('\0')[0]?.trim();
  if (!entry) {
    return null;
  }

  const [, objectId] = entry.split(/\s+/, 3);
  return objectId ?? null;
}

async function main() {
  const verbose = process.argv.includes('--verbose');
  const modifiedFiles = parseNullSeparated(await git(['ls-files', '-m', '-z']));

  let refreshed = 0;

  for (const filePath of modifiedFiles) {
    const indexObjectId = await getIndexObjectId(filePath);
    if (!indexObjectId) {
      continue;
    }

    const worktreeObjectId = (
      await git(['hash-object', '--', filePath], {
        allowFailure: true,
      })
    ).trim();

    if (!worktreeObjectId || worktreeObjectId !== indexObjectId) {
      continue;
    }

    await git(['add', '--renormalize', '--', filePath]);
    refreshed += 1;

    if (verbose) {
      console.log(`[git-noise] refreshed ${filePath}`);
    }
  }

  if (refreshed > 0) {
    console.log(`[git-noise] refreshed ${refreshed} noise-only file(s)`);
  }
}

main().catch((error) => {
  console.error(`[git-noise] ${error.message}`);
  process.exit(1);
});
