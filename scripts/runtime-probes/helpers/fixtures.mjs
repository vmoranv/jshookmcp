import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileAsync } from './runtime.mjs';

async function createGitFixtureRepo(repoDir, entryFile, sourceText) {
  await rm(repoDir, { recursive: true, force: true }).catch(() => {});
  await mkdir(repoDir, { recursive: true });
  await writeFile(join(repoDir, entryFile), sourceText, 'utf8');
  await execFileAsync('git', ['init'], { cwd: repoDir, timeout: 15000 });
  await execFileAsync('git', ['config', 'user.email', 'runtime-audit@example.invalid'], {
    cwd: repoDir,
    timeout: 15000,
  });
  await execFileAsync('git', ['config', 'user.name', 'Runtime Audit'], {
    cwd: repoDir,
    timeout: 15000,
  });
  await execFileAsync('git', ['add', entryFile], { cwd: repoDir, timeout: 15000 });
  await execFileAsync('git', ['commit', '-m', 'runtime audit fixture'], {
    cwd: repoDir,
    timeout: 15000,
  });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: repoDir,
    timeout: 15000,
  });

  return {
    repo: repoDir.replace(/\\/g, '/'),
    entry: entryFile,
    commit: stdout.trim(),
  };
}

export async function createRegistryFixtures(rootDir) {
  const pluginFixture = await createGitFixtureRepo(
    join(rootDir, 'plugin-repo'),
    'index.mjs',
    [
      'export default {',
      "  id: 'runtime-audit-plugin',",
      "  version: '1.0.0',",
      "  pluginName: 'Runtime Audit Plugin',",
      "  compatibleCoreRange: '*',",
      '  allowedTools: [],',
      '  tools: [],',
      '  workflows: [],',
      '  mergeMetadata() {',
      '    return this;',
      '  },',
      '};',
      '',
    ].join('\n'),
  );
  const workflowFixture = await createGitFixtureRepo(
    join(rootDir, 'workflow-repo'),
    'index.mjs',
    [
      'export default {',
      "  kind: 'workflow-contract',",
      '  version: 1,',
      "  id: 'runtime-audit-installed-workflow',",
      "  displayName: 'Runtime Audit Installed Workflow',",
      "  description: 'Installed workflow fixture for runtime audit.',",
      "  tags: ['runtime', 'audit'],",
      '  route: {',
      "    kind: 'workflow',",
      '    triggerPatterns: [/runtime audit installed workflow/i],',
      "    requiredDomains: ['workflow'],",
      '    priority: 90,',
      '    steps: [',
      '      {',
      "        id: 'cache-stats',",
      "        toolName: 'get_cache_stats',",
      "        description: 'Read cache stats',",
      '        prerequisites: [],',
      '      },',
      '    ],',
      '  },',
      '  build() {',
      '    return {',
      "      kind: 'sequence',",
      "      id: 'root',",
      '      steps: [',
      '        {',
      "          kind: 'tool',",
      "          id: 'cache-stats',",
      "          toolName: 'get_cache_stats',",
      '        },',
      '      ],',
      '    };',
      '  },',
      '};',
      '',
    ].join('\n'),
  );

  return {
    plugins: [
      {
        slug: 'runtime-audit-plugin',
        id: 'runtime-audit-plugin',
        source: {
          type: 'git',
          repo: pluginFixture.repo,
          ref: 'HEAD',
          commit: pluginFixture.commit,
          subpath: '.',
          entry: pluginFixture.entry,
        },
        meta: {
          name: 'Runtime Audit Plugin',
          description: 'Local registry fixture for runtime audit coverage.',
          author: 'jshookmcp-runtime-audit',
          source_repo: pluginFixture.repo,
        },
      },
    ],
    workflows: [
      {
        slug: 'runtime-audit-workflow',
        id: 'runtime-audit-workflow',
        source: {
          type: 'git',
          repo: workflowFixture.repo,
          ref: 'HEAD',
          commit: workflowFixture.commit,
          subpath: '.',
          entry: workflowFixture.entry,
        },
        meta: {
          name: 'Runtime Audit Workflow',
          description: 'Local registry fixture for workflow registry coverage.',
          author: 'jshookmcp-runtime-audit',
          source_repo: workflowFixture.repo,
        },
      },
    ],
  };
}

export function buildMockElectronExe(fuseBytes) {
  const sentinel = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZIA', 'ascii');
  return Buffer.concat([Buffer.alloc(256, 0x90), sentinel, Buffer.from(fuseBytes)]);
}

export function buildMockAsar(entries) {
  const dataBuffers = [];
  const headerFiles = {};
  let dataOffset = 0;

  for (const entry of entries) {
    const contentBuf = Buffer.from(entry.content, 'utf8');
    const parts = entry.path.split('/');
    let current = headerFiles;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const dir = parts[index];
      if (!current[dir]) current[dir] = { files: {} };
      current = current[dir].files;
    }
    const fileName = parts[parts.length - 1];
    current[fileName] = { size: contentBuf.length, offset: String(dataOffset) };
    dataBuffers.push(contentBuf);
    dataOffset += contentBuf.length;
  }

  const headerBuf = Buffer.from(JSON.stringify({ files: headerFiles }), 'utf8');
  const headerPrefix = Buffer.alloc(16);
  headerPrefix.writeUInt32LE(headerBuf.length + 8, 0);
  headerPrefix.writeUInt32LE(headerBuf.length + 4, 4);
  headerPrefix.writeUInt32LE(headerBuf.length, 8);
  headerPrefix.writeUInt32LE(0, 12);
  return Buffer.concat([headerPrefix, headerBuf, ...dataBuffers]);
}

export function buildMiniappPkg(entries = []) {
  const dataBuffers = [];
  const normalizedEntries = entries.map((entry) => {
    const nameBuffer = Buffer.from(entry.path, 'utf8');
    const contentBuffer = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content, 'utf8');
    dataBuffers.push(contentBuffer);
    return { nameBuffer, contentBuffer };
  });
  const headerLength = 14;
  const indexLength =
    4 + normalizedEntries.reduce((sum, entry) => sum + 12 + entry.nameBuffer.length, 0);
  const dataSectionStart = headerLength + indexLength;
  const entryBuffers = [];
  let dataOffset = 0;

  for (const entry of normalizedEntries) {
    const entryBuffer = Buffer.alloc(12 + entry.nameBuffer.length);
    entryBuffer.writeUInt32BE(entry.nameBuffer.length, 0);
    entry.nameBuffer.copy(entryBuffer, 4);
    entryBuffer.writeUInt32BE(dataSectionStart + dataOffset, 4 + entry.nameBuffer.length);
    entryBuffer.writeUInt32BE(entry.contentBuffer.length, 8 + entry.nameBuffer.length);
    entryBuffers.push(entryBuffer);
    dataOffset += entry.contentBuffer.length;
  }

  const indexBuffer = Buffer.concat([
    Buffer.from([
      (entries.length >>> 24) & 0xff,
      (entries.length >>> 16) & 0xff,
      (entries.length >>> 8) & 0xff,
      entries.length & 0xff,
    ]),
    ...entryBuffers,
  ]);
  const dataBuffer = Buffer.concat(dataBuffers);
  const header = Buffer.alloc(14);
  header.writeUInt8(0xbe, 0);
  header.writeUInt32BE(0, 1);
  header.writeUInt32BE(indexBuffer.length, 5);
  header.writeUInt32BE(dataBuffer.length, 9);
  header.writeUInt8(0, 13);
  return Buffer.concat([header, indexBuffer, dataBuffer]);
}
