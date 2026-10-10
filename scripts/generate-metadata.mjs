#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditReadmeCounts, reportAudit } from './audit-readme-counts.mjs';

const scriptDirUrl = new URL('.', import.meta.url);
const projectRootUrl = new URL('../', scriptDirUrl);
const projectRoot = fileURLToPath(projectRootUrl);
const require = createRequire(import.meta.url);

const packageJsonPath = join(projectRoot, 'package.json');
const serverJsonPath = join(projectRoot, 'server.json');
const readmePath = join(projectRoot, 'README.md');
const readmeZhPath = join(projectRoot, 'README.zh.md');

const README_SYNC_START = '<!-- metadata-sync:start -->';
const README_SYNC_END = '<!-- metadata-sync:end -->';
const toolReferenceUrl = 'https://vmoranv.github.io/jshookmcp/reference/';
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

function stringifyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function prependCommand(existing, command) {
  if (!existing || existing.trim().length === 0) {
    return command;
  }
  if (existing.includes(command)) {
    return existing;
  }
  return `${command} && ${existing}`;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readText(path) {
  return readFile(path, 'utf8');
}

export async function loadRegistrySummary() {
  const packageJson = await readJson(packageJsonPath);
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

export function buildDescription() {
  return `MCP server with built-in tools across multiple domains for AI-assisted JavaScript analysis and security analysis — browser automation, CDP debugging, network monitoring, JS hooks, code analysis, and workflow orchestration`;
}

/**
 * The MCP Registry caps `description` at 100 characters, while npm does not.
 * `buildDescription()` is 221 characters, so feeding it to both consumers made
 * every registry publish fail with HTTP 422 (`expected length <= 100`) — which
 * went unnoticed because nothing validated server.json against the registry
 * schema. Registry copy therefore gets its own budgeted builder.
 *
 * @see https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json
 */
export const REGISTRY_DESCRIPTION_MAX = 100;

export function buildRegistryDescription(summary) {
  const text = `Search-first MCP server for JavaScript reverse engineering: ${summary.toolCount} tools across ${summary.domainCount} domains.`;
  if (text.length > REGISTRY_DESCRIPTION_MAX) {
    // Throw instead of truncating: a silently shortened description is how this
    // drifted in the first place. Grow the counts and this fails loudly instead.
    throw new Error(
      `Registry description is ${text.length} chars, over the MCP Registry limit of ${REGISTRY_DESCRIPTION_MAX}. ` +
        `Shorten buildRegistryDescription() in scripts/generate-metadata.mjs.`,
    );
  }
  return text;
}

function buildMetadataBlock(summary, language) {
  if (language === 'zh') {
    return [
      README_SYNC_START,
      `- 包版本：\`${summary.packageVersion}\``,
      `- 内置工具数：\`${summary.toolCount}\``,
      `- 域列表：${summary.domains.map((domain) => `\`${domain}\``).join(', ')}`,
      '- 说明：以上数据由运行时 registry 动态生成，不要手改计数。',
      README_SYNC_END,
    ].join('\n');
  }

  return [
    README_SYNC_START,
    `- Package version: \`${summary.packageVersion}\``,
    `- Built-in tools: \`${summary.toolCount}\``,
    `- Domains: ${summary.domains.map((domain) => `\`${domain}\``).join(', ')}`,
    '- Note: this snapshot is generated from the runtime registry; do not edit the counts by hand.',
    README_SYNC_END,
  ].join('\n');
}

function replaceSection(readme, pattern, replacement) {
  if (!pattern.test(readme)) {
    return readme;
  }
  return readme.replace(pattern, replacement);
}

function updateEnglishReadme(readme, summary) {
  const intro =
    'An MCP (Model Context Protocol) server with a runtime-registry-driven catalog of built-in tools for AI-assisted JavaScript analysis and security analysis. It combines browser automation, Chrome DevTools Protocol debugging, network monitoring, intelligent JavaScript hooks, LLM-powered code analysis, process and memory inspection, WASM tooling, source-map reconstruction, AST transforms, and composite workflows in a single server.';
  const snapshotSection = [
    '## Registry snapshot',
    '',
    'The built-in surface below is generated from the runtime registry and checked in CI.',
    '',
    buildMetadataBlock(summary, 'en'),
    '',
    `> **[View the complete Tool Reference ↗](${toolReferenceUrl})**`,
  ].join('\n');

  let next = readme;
  // One-time legacy badge migration was removed: README badges (Node.js 22.12+)
  // no longer match the old `node->=20` pattern, so the replaces were dead no-ops.
  // The `i` flags absorb the old title-case headers ("Registry Snapshot" /
  // "Project Stats") so pre-restructure READMEs keep updating too.
  next = replaceSection(next, /An MCP[\s\S]*?(?=\n## What makes jshook different\n)/, `${intro}\n`);
  next = replaceSection(
    next,
    /## (Tool Domains|Registry Snapshot)[\s\S]*?(?=\n---\n|\n## Project Stats\n)/i,
    `${snapshotSection}\n`,
  );
  return `${next.trimEnd()}\n`;
}

function updateChineseReadme(readme, summary) {
  const intro =
    '面向 AI 辅助 JavaScript 分析与安全分析的 MCP（模型上下文协议）服务器，内置工具面来自运行时 registry，而不是手写清单。它将浏览器自动化、Chrome DevTools Protocol 调试、网络监控、JavaScript Hook、LLM 驱动代码分析、进程与内存检查、WASM 工具链、Source Map 重建、AST 变换与复合工作流整合到同一服务中。';
  const snapshotSection = [
    '## 注册表快照',
    '',
    '下面的内置能力快照由运行时 registry 动态生成，并在 CI 中校验。',
    '',
    buildMetadataBlock(summary, 'zh'),
    '',
    `> **[查看完整工具参考 ↗](${toolReferenceUrl})**`,
  ].join('\n');

  let next = readme;
  // One-time legacy badge migration was removed: README badges (Node.js 22.12+)
  // no longer match the old `node->=20` pattern, so the replaces were dead no-ops.
  next = replaceSection(next, /面向 AI[\s\S]*?(?=\n## jshook 的不同之处\n)/, `${intro}\n`);
  if (/## 注册表快照[\s\S]*?(?=\n---\n|\n## 项目统计\n)/.test(next)) {
    next = next.replace(/## 注册表快照[\s\S]*?(?=\n---\n|\n## 项目统计\n)/, `${snapshotSection}\n`);
  } else {
    next = next.replace(/\n## 项目统计\n/, `\n${snapshotSection}\n\n## 项目统计\n`);
  }
  return `${next.trimEnd()}\n`;
}

function updatePackageJson(packageJson) {
  const next = {
    ...packageJson,
    description: buildDescription(),
    scripts: {
      ...packageJson.scripts,
    },
  };

  next.scripts['metadata:sync'] = 'node scripts/generate-metadata.mjs --write';
  next.scripts['metadata:check'] = 'node scripts/generate-metadata.mjs --check';
  next.scripts['check:docs-format'] ??= 'pnpm run lint:md';
  next.scripts['check'] = prependCommand(next.scripts['check'], 'pnpm run metadata:check');
  next.scripts['prepack'] = prependCommand(next.scripts['prepack'], 'pnpm run metadata:check');

  return next;
}

/**
 * The registry schema requires camelCase `registryType` and a `transport`
 * object; earlier revisions of this generator wrote snake_case `registry_type`
 * and omitted `transport`, so the registry dropped the type and rejected every
 * publish with `expected length >= 1`. Normalising on every pass (not just when
 * appending a new entry) means `metadata:check` — which diffs the file on disk
 * against this generator's output — also catches and repairs hand edits.
 */
function normalizeRegistryPackage(entry) {
  const next = { ...entry };
  if (next.registryType === undefined && typeof next.registry_type === 'string') {
    next.registryType = next.registry_type;
  }
  delete next.registry_type;
  next.registryType ??= 'npm';
  next.transport ??= { type: 'stdio' };
  return next;
}

function updateServerJson(serverJson, packageJson, summary) {
  const packages = Array.isArray(serverJson.packages)
    ? serverJson.packages.map((entry) => normalizeRegistryPackage(entry))
    : [];

  const packageEntry = packages.find((entry) => entry.identifier === packageJson.name);
  if (packageEntry) {
    packageEntry.version = packageJson.version;
  } else {
    packages.push(
      normalizeRegistryPackage({
        identifier: packageJson.name,
        version: packageJson.version,
      }),
    );
  }

  return {
    ...serverJson,
    name: packageJson.mcpName ?? serverJson.name,
    description: buildRegistryDescription(summary),
    version: packageJson.version,
    packages,
  };
}

export async function computeMetadataState() {
  const summary = await loadRegistrySummary();
  const packageJson = await readJson(packageJsonPath);
  const serverJson = await readJson(serverJsonPath);
  const readme = await readText(readmePath);
  const readmeZh = await readText(readmeZhPath);

  const expectedPackageJson = updatePackageJson(packageJson);
  const expectedServerJson = updateServerJson(serverJson, expectedPackageJson, summary);
  const expectedReadme = updateEnglishReadme(readme, summary);
  const expectedReadmeZh = updateChineseReadme(readmeZh, summary);

  return {
    summary,
    files: {
      'package.json': {
        path: packageJsonPath,
        actual: stringifyJson(packageJson),
        expected: stringifyJson(expectedPackageJson),
      },
      'server.json': {
        path: serverJsonPath,
        actual: stringifyJson(serverJson),
        expected: stringifyJson(expectedServerJson),
      },
      'README.md': {
        path: readmePath,
        actual: readme,
        expected: expectedReadme,
      },
      'README.zh.md': {
        path: readmeZhPath,
        actual: readmeZh,
        expected: expectedReadmeZh,
      },
    },
  };
}

export async function checkMetadata(options = {}) {
  const { quiet = false } = options;
  const state = await computeMetadataState();
  const mismatches = Object.entries(state.files)
    .filter(([, file]) => file.actual !== file.expected)
    .map(([name]) => name);

  // The sync block is only ONE of the two places the tool count lives. The other
  // is hand-written prose, which nothing else validates — see audit-readme-counts.mjs.
  const prose = auditReadmeCounts({
    expectedToolCount: state.summary.toolCount,
    files: [
      { name: 'README.md', lang: 'en', text: state.files['README.md'].actual },
      { name: 'README.zh.md', lang: 'zh', text: state.files['README.zh.md'].actual },
    ],
  });

  if (!quiet) {
    console.log(
      `[metadata] registry summary: version=${state.summary.packageVersion}, domains=${state.summary.domainCount}, tools=${state.summary.toolCount}`,
    );
    if (prose.aborts.length > 0) {
      reportAudit(prose, { expectedToolCount: state.summary.toolCount });
    } else if (mismatches.length === 0 && prose.failures.length === 0) {
      console.log('[metadata] OK: metadata is in sync.');
    } else {
      if (mismatches.length > 0) {
        console.error(`[metadata] STALE: ${mismatches.join(', ')}`);
      }
      if (prose.failures.length > 0) {
        reportAudit(prose, { expectedToolCount: state.summary.toolCount });
      }
    }
  }

  return {
    summary: state.summary,
    mismatches,
    prose,
  };
}

export async function syncMetadata() {
  const state = await computeMetadataState();
  const changedFiles = [];

  for (const [name, file] of Object.entries(state.files)) {
    if (file.actual === file.expected) {
      continue;
    }
    await writeFile(file.path, file.expected, 'utf8');
    changedFiles.push(name);
  }

  // `sync` rewrites the generated block only. Prose is authored text and is left
  // alone, so a stale prose count survives a sync by design — report it loudly
  // here rather than letting the next `check` be the first time anyone hears.
  const prose = auditReadmeCounts({
    expectedToolCount: state.summary.toolCount,
    files: [
      { name: 'README.md', lang: 'en', text: state.files['README.md'].actual },
      { name: 'README.zh.md', lang: 'zh', text: state.files['README.zh.md'].actual },
    ],
  });

  return {
    summary: state.summary,
    changedFiles,
    prose,
  };
}

async function main() {
  const mode = process.argv.includes('--check') ? 'check' : 'write';

  if (mode === 'check') {
    const result = await checkMetadata();
    // ABORT (2) outranks FAIL (1): it means the guard could not reach a verdict,
    // so a "stale" report would be a guess rather than a finding.
    if (result.prose.aborts.length > 0) {
      process.exit(2);
    }
    process.exit(result.mismatches.length === 0 && result.prose.failures.length === 0 ? 0 : 1);
  }

  const result = await syncMetadata();
  console.log(
    `[metadata] synced from runtime registry: version=${result.summary.packageVersion}, domains=${result.summary.domainCount}, tools=${result.summary.toolCount}`,
  );
  if (result.changedFiles.length === 0) {
    console.log('[metadata] No file changes were required.');
  } else {
    console.log(`[metadata] Updated: ${result.changedFiles.join(', ')}`);
  }
  if (result.prose.aborts.length > 0 || result.prose.failures.length > 0) {
    reportAudit(result.prose, { expectedToolCount: result.summary.toolCount });
    console.error('[metadata] WARNING: sync does not rewrite prose — fix the lines above by hand.');
  }
}

const isCliEntry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isCliEntry) {
  main().catch((error) => {
    console.error(
      `[metadata] Fatal error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
}
