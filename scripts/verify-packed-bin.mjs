import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
const binEntries = [...new Set(Object.values(packageJson.bin ?? {}))];
const inputPath = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : resolve(process.cwd(), '.release-artifacts');

const resolveTarballPath = (candidatePath) => {
  if (candidatePath.endsWith('.tgz')) {
    return candidatePath;
  }

  const tarballs = readdirSync(candidatePath)
    .filter((entry) => entry.endsWith('.tgz'))
    .map((entry) => resolve(candidatePath, entry))
    .sort();

  if (tarballs.length !== 1) {
    throw new Error(`Expected exactly one tarball in ${candidatePath}, found ${tarballs.length}`);
  }

  return tarballs[0];
};

const isExecutable = (modeString) => {
  const ownerExecute = modeString[3];
  return ownerExecute === 'x' || ownerExecute === 's';
};

const tarballPath = resolveTarballPath(inputPath);
const listResult = spawnSync('tar', ['-tvf', tarballPath], {
  cwd: process.cwd(),
  encoding: 'utf8',
});

if (listResult.status !== 0) {
  throw new Error(listResult.stderr || `Failed to inspect tarball: ${tarballPath}`);
}

const tarEntries = listResult.stdout
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

for (const binRelativePath of binEntries) {
  const tarEntryPath = `package/${binRelativePath.replace(/\\/g, '/')}`;
  const tarEntry = tarEntries.find((line) => line.endsWith(` ${tarEntryPath}`));

  if (!tarEntry) {
    throw new Error(`Packed tarball is missing bin entry: ${tarEntryPath}`);
  }

  const modeString = tarEntry.split(/\s+/)[0];
  if (!isExecutable(modeString)) {
    throw new Error(`Packed bin is not executable: ${tarEntryPath} (${modeString})`);
  }

  const extractResult = spawnSync('tar', ['-xOf', tarballPath, tarEntryPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  if (extractResult.status !== 0) {
    throw new Error(extractResult.stderr || `Failed to extract bin entry: ${tarEntryPath}`);
  }

  if (!extractResult.stdout.startsWith('#!/usr/bin/env node')) {
    throw new Error(`Packed bin is missing the expected node shebang: ${tarEntryPath}`);
  }
}

console.log(`Verified packed bin permissions for ${tarballPath}`);
