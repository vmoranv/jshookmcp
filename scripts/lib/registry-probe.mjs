/**
 * Registry summary probe — spawns tsx to import the live registry and count
 * domains/tools.
 *
 * Extracted from `generate-metadata.mjs` so `audit-readme-counts.mjs` can
 * consume it without a module cycle: generate-metadata imports the audit
 * module's pure prose-count functions, and the audit CLI needs this probe.
 * Both sides now import this leaf instead of each other.
 */
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);

const registryMetadataPlatform = 'win32';

const registryProbe = `
import { initRegistry, getAllManifests, getAllRegistrations } from './src/server/registry/index.ts';

(async () => {
  await initRegistry();

  const manifests = [...getAllManifests()].sort((a, b) => a.domain.localeCompare(b.domain));
  const registrations = [...getAllRegistrations()];

  console.log(JSON.stringify({
    domainCount: manifests.length,
    toolCount: registrations.length,
    domains: manifests.map((manifest) => manifest.domain),
  }, null, 2));
})();
`;

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function loadRegistrySummary() {
  const packageJson = await readJson(join(projectRoot, 'package.json'));
  const tsxPackagePath = require.resolve('tsx/package.json');
  const tsxCliPath = join(dirname(tsxPackagePath), 'dist', 'cli.mjs');
  const result = spawnSync(process.execPath, [tsxCliPath, '--eval', registryProbe], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      JSHOOK_REGISTRY_PLATFORM: registryMetadataPlatform,
      LOG_LEVEL: 'error',
    },
  });

  if (result.status !== 0) {
    const details = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`Failed to load registry summary via tsx.${details ? `\n${details}` : ''}`);
  }

  const stdout = result.stdout.trim();
  if (!stdout) {
    throw new Error('Registry summary probe returned empty stdout.');
  }

  const summary = JSON.parse(stdout);
  return {
    packageVersion: packageJson.version,
    domainCount: summary.domainCount,
    toolCount: summary.toolCount,
    domains: summary.domains,
  };
}
