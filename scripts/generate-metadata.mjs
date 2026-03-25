#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

export function buildDescription(summary) {
  return `MCP server with ${summary.toolCount} built-in tools across ${summary.domainCount} domains for AI-assisted JavaScript analysis and security analysis — browser automation, CDP debugging, network monitoring, JS hooks, code analysis, and workflow orchestration`;
}

function buildMetadataBlock(summary, language) {
  if (language === 'zh') {
    return [
      README_SYNC_START,
      `- 包版本：\`${summary.packageVersion}\``,
      `- 内置工具域：\`${summary.domainCount}\``,
      `- 内置工具数：\`${summary.toolCount}\``,
      `- 域列表：${summary.domains.map((domain) => `\`${domain}\``).join(', ')}`,
      '- 说明：以上数据由运行时 registry 动态生成，不要手改计数。',
      README_SYNC_END,
    ].join('\n');
  }

  return [
    README_SYNC_START,
    `- Package version: \`${summary.packageVersion}\``,
    `- Built-in domains: \`${summary.domainCount}\``,
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
    '## Registry Snapshot',
    '',
    'The built-in surface below is generated from the runtime registry and checked in CI.',
    '',
    buildMetadataBlock(summary, 'en'),
    '',
    `> **[View the complete Tool Reference ↗](${toolReferenceUrl})**`,
  ].join('\n');

  let next = readme;
  next = next.replace(
    '[![Node.js >= 22](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)',
    '[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)',
  );
  next = replaceSection(
    next,
    /An MCP[\s\S]*?(?=\n## Documentation \/ Quick Links\n)/,
    `${intro}\n`,
  );
  next = replaceSection(
    next,
    /## (Tool Domains|Registry Snapshot)[\s\S]*?(?=\n## Project Stats\n)/,
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
  next = next.replace(
    '[![Node.js >= 22](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)',
    '[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)',
  );
  next = replaceSection(next, /面向 AI[\s\S]*?(?=\n## 文档与快速导航\n)/, `${intro}\n`);
  if (/## 注册表快照[\s\S]*?(?=\n## 项目统计\n)/.test(next)) {
    next = next.replace(/## 注册表快照[\s\S]*?(?=\n## 项目统计\n)/, `${snapshotSection}\n`);
  } else {
    next = next.replace(/\n## 项目统计\n/, `\n${snapshotSection}\n\n## 项目统计\n`);
  }
  return `${next.trimEnd()}\n`;
}

function updatePackageJson(packageJson, summary) {
  const next = {
    ...packageJson,
    description: buildDescription(summary),
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

function updateServerJson(serverJson, packageJson, summary) {
  const packages = Array.isArray(serverJson.packages)
    ? serverJson.packages.map((entry) => ({ ...entry }))
    : [];

  const packageEntry = packages.find((entry) => entry.identifier === packageJson.name);
  if (packageEntry) {
    packageEntry.version = packageJson.version;
  } else {
    packages.push({
      registry_type: 'npm',
      identifier: packageJson.name,
      version: packageJson.version,
    });
  }

  return {
    ...serverJson,
    name: packageJson.mcpName ?? serverJson.name,
    description: buildDescription(summary),
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

  const expectedPackageJson = updatePackageJson(packageJson, summary);
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

  if (!quiet) {
    console.log(
      `[metadata] registry summary: version=${state.summary.packageVersion}, domains=${state.summary.domainCount}, tools=${state.summary.toolCount}`,
    );
    if (mismatches.length === 0) {
      console.log('[metadata] OK: metadata is in sync.');
    } else {
      console.error(`[metadata] STALE: ${mismatches.join(', ')}`);
    }
  }

  return {
    summary: state.summary,
    mismatches,
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

  return {
    summary: state.summary,
    changedFiles,
  };
}

async function main() {
  const mode = process.argv.includes('--check') ? 'check' : 'write';

  if (mode === 'check') {
    const result = await checkMetadata();
    process.exit(result.mismatches.length === 0 ? 0 : 1);
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
