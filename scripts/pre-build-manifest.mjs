#!/usr/bin/env node
/**
 * pre-build-manifest.mjs — generate a static tool manifest and sync metadata.
 *
 * Prefers compiled manifests from dist/ so path-alias resolution is already baked
 * by tsc-alias. This makes the script safe to call from the normal build flow.
 *
 * Usage:
 *   node scripts/pre-build-manifest.mjs [--out <path>] [--from <auto|dist|src>] [--sync-metadata]
 *
 * Default output: <projectRoot>/generated/tool-manifest.json
 */
import { readdir, stat, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirUrl = new URL('.', import.meta.url);
const projectRootUrl = new URL('../', scriptDirUrl);
const projectRoot = fileURLToPath(projectRootUrl);
const README_SYNC_START = '<!-- metadata-sync:start -->';
const README_SYNC_END = '<!-- metadata-sync:end -->';

// Parse CLI args
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const fromIdx = args.indexOf('--from');
const outputPath =
  outIdx >= 0 && args[outIdx + 1]
    ? args[outIdx + 1]
    : join(projectRoot, 'generated', 'tool-manifest.json');
const sourcePreference = fromIdx >= 0 && args[fromIdx + 1] ? args[fromIdx + 1] : 'auto';
const syncMetadata = args.includes('--sync-metadata');

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveManifestSource(preference) {
  const sources = {
    dist: {
      key: 'dist',
      domainsDir: join(projectRoot, 'dist', 'src', 'server', 'domains'),
      manifestFile: 'manifest.js',
    },
    src: {
      key: 'src',
      domainsDir: join(projectRoot, 'src', 'server', 'domains'),
      manifestFile: 'manifest.ts',
    },
  };

  if (!['auto', 'dist', 'src'].includes(preference)) {
    throw new Error(`Unsupported --from value "${preference}". Expected auto, dist, or src.`);
  }

  if (preference === 'dist' || preference === 'src') {
    const source = sources[preference];
    if (!(await exists(source.domainsDir))) {
      throw new Error(
        `Requested manifest source "${preference}" is unavailable: ${source.domainsDir}`,
      );
    }
    return source;
  }

  if (await exists(sources.dist.domainsDir)) {
    return sources.dist;
  }
  if (await exists(sources.src.domainsDir)) {
    return sources.src;
  }

  throw new Error('No manifest source found in dist/ or src/.');
}

// ── Discovery ──

async function discoverManifestPaths(source) {
  const { domainsDir, manifestFile } = source;
  const entries = await readdir(domainsDir, { withFileTypes: true });
  const directories = entries.filter((e) => e.isDirectory());

  const paths = [];
  for (const dir of directories) {
    const manifestPath = join(domainsDir, dir.name, manifestFile);
    try {
      const s = await stat(manifestPath);
      if (s.isFile()) {
        paths.push(manifestPath);
      }
    } catch {
      // Not found
    }
  }
  return paths;
}

function toImportSpec(absPath) {
  return pathToFileURL(absPath).href;
}

function extractManifest(mod) {
  if (!mod || typeof mod !== 'object') return null;
  for (const key of ['default', 'manifest', 'domainManifest']) {
    const candidate = mod[key];
    if (
      candidate &&
      typeof candidate === 'object' &&
      candidate.kind === 'domain-manifest' &&
      candidate.version === 1
    ) {
      return candidate;
    }
  }
  return null;
}

function getToolName(registration) {
  const resolvedTool =
    typeof registration?.tool === 'function' ? registration.tool() : registration?.tool;
  return resolvedTool?.name ?? null;
}

function buildSummary(domains, packageVersion) {
  const sortedDomains = [...domains].sort((a, b) => a.domain.localeCompare(b.domain));
  const totalTools = sortedDomains.reduce((sum, domain) => sum + domain.toolCount, 0);

  return {
    packageVersion,
    domainCount: sortedDomains.length,
    totalTools,
    domains: sortedDomains.map((domain) => domain.domain),
  };
}

function buildDescription(summary) {
  return `MCP server with ${summary.totalTools} built-in tools across ${summary.domainCount} domains for AI-assisted JavaScript analysis and security analysis — browser automation, CDP debugging, network monitoring, JS hooks, code analysis, and workflow orchestration`;
}

function buildReadmeMetadataBlock(summary) {
  const domainList = summary.domains.map((domain) => `\`${domain}\``).join(', ');
  return [
    README_SYNC_START,
    `- Package version: \`${summary.packageVersion}\``,
    `- Built-in domains: \`${summary.domainCount}\``,
    `- Built-in tools: \`${summary.totalTools}\``,
    `- Domains: ${domainList}`,
    '- Note: counts are generated from domain manifests on the current build platform; platform-filtered tools can change the total.',
    README_SYNC_END,
  ].join('\n');
}

function replaceOrInsertReadmeBlock(readme, block) {
  const existingBlock = new RegExp(`${README_SYNC_START}[\\s\\S]*?${README_SYNC_END}`, 'm');
  if (existingBlock.test(readme)) {
    return readme.replace(existingBlock, block);
  }

  const toolDomainsHeading = '## Tool Domains';
  const headingIndex = readme.indexOf(toolDomainsHeading);
  if (headingIndex === -1) {
    return `${readme.trimEnd()}\n\n## Tool Domains\n\nThe current built-in surface is generated from domain manifests during build.\n\n${block}\n`;
  }

  const insertionPoint = headingIndex + toolDomainsHeading.length;
  return `${readme.slice(0, insertionPoint)}\n\nThe current built-in surface is generated from domain manifests during build.\n\n${block}${readme.slice(insertionPoint)}`;
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

async function syncProjectMetadata(summary) {
  const packageJsonPath = join(projectRoot, 'package.json');
  const serverJsonPath = join(projectRoot, 'server.json');
  const readmePath = join(projectRoot, 'README.md');

  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));
  packageJson.description = buildDescription(summary);
  await writeJson(packageJsonPath, packageJson);

  const serverJson = JSON.parse(await readFile(serverJsonPath, 'utf-8'));
  serverJson.description = buildDescription(summary);
  serverJson.version = summary.packageVersion;
  serverJson.packages = Array.isArray(serverJson.packages) ? serverJson.packages : [];

  const packageEntry = serverJson.packages.find((entry) => entry.identifier === packageJson.name);
  if (packageEntry) {
    packageEntry.version = summary.packageVersion;
  } else {
    serverJson.packages.push({
      registry_type: 'npm',
      identifier: packageJson.name,
      version: summary.packageVersion,
    });
  }
  await writeJson(serverJsonPath, serverJson);

  let readme = await readFile(readmePath, 'utf-8');
  readme = readme.replace(
    '[![Node.js >= 22](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)',
    '[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)',
  );
  readme = readme.replace(
    'An MCP (Model Context Protocol) server providing a comprehensive set of **built-in tools** across **17+ domains** (including core meta-tools) — with runtime extension loading from `plugins/` and `workflows/` for AI-assisted JavaScript analysis and security analysis.',
    'An MCP (Model Context Protocol) server providing a manifest-driven catalog of **built-in tools** across multiple domains — with runtime extension loading from `plugins/` and `workflows/` for AI-assisted JavaScript analysis and security analysis.',
  );
  readme = readme.replace(
    '- **Domain Self-Discovery**: Runtime manifest scanning (`domains/*/manifest.ts`) replaces hardcoded imports; add new domains by creating a single manifest file',
    '- **Manifest-Driven Metadata**: Domain manifests remain the source of truth, and the build syncs generated tool/domain metadata from them',
  );
  readme = readme.replace(
    /## Tool Domains\s+The server provides built-in tools across \*\*17\+ domains\*\* \([^)]+\)\.\s+/m,
    '## Tool Domains\n\n',
  );
  readme = replaceOrInsertReadmeBlock(readme, buildReadmeMetadataBlock(summary));
  await writeFile(readmePath, readme, 'utf-8');
}

// ── Main ──

async function main() {
  const packageJson = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf-8'));
  const source = await resolveManifestSource(sourcePreference);
  console.log(`[pre-build-manifest] Scanning ${source.key} manifests...`);
  const manifestPaths = await discoverManifestPaths(source);
  const result = {
    generatedAt: new Date().toISOString(),
    packageVersion: packageJson.version,
    domains: [],
  };

  for (const absPath of manifestPaths) {
    try {
      const mod = await import(toImportSpec(absPath));
      const manifest = extractManifest(mod);
      if (!manifest) {
        console.warn(`  [skip] No valid DomainManifest in ${absPath}`);
        continue;
      }
      const relPath = relative(projectRoot, absPath).split(sep).join('/');
      result.domains.push({
        domain: manifest.domain,
        depKey: manifest.depKey,
        profiles: manifest.profiles,
        toolCount: manifest.registrations?.length ?? 0,
        tools: (manifest.registrations ?? [])
          .map((reg) => getToolName(reg))
          .filter(Boolean)
          .map((name) => ({ name, domain: manifest.domain })),
        source: relPath,
      });
      console.log(`  [ok] ${manifest.domain} (${manifest.registrations?.length ?? 0} tools)`);
    } catch (error) {
      console.error(`  [error] Failed to import ${absPath}:`, error.message);
    }
  }

  result.domains.sort((a, b) => a.domain.localeCompare(b.domain));
  result.summary = buildSummary(result.domains, packageJson.version);

  // Ensure output directory exists
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(result, null, 2), 'utf-8');

  if (syncMetadata) {
    await syncProjectMetadata(result.summary);
    console.log('  [ok] Synced package.json, server.json, and README.md');
  }

  console.log(
    `[pre-build-manifest] Done! ${result.summary.domainCount} domains, ${result.summary.totalTools} tools → ${outputPath}`,
  );
}

main().catch((err) => {
  console.error('[pre-build-manifest] Fatal error:', err);
  process.exit(1);
});
