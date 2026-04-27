import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

export async function prepareRuntimeFixtures(ctx) {
  const { report, server, paths, runtimeIds, state, constants, helpers } = ctx;
  const { createRegistryFixtures, isRecord } = helpers;
  const { BODY_MARKER } = constants;
  const { runtimeMacroId, runtimeExtensionId } = runtimeIds;
  const {
    runtimeArtifactDir,
    runtimeMacroDir,
    runtimeMacroPath,
    runtimeWorkflowRoot,
    runtimePluginRoot,
    runtimeExtensionPath,
    extensionRegistryRoot,
    extensionRegistryFile,
  } = paths;

  await mkdir(runtimeArtifactDir, { recursive: true });
  await mkdir(runtimeMacroDir, { recursive: true });
  await rm(runtimeWorkflowRoot, { recursive: true, force: true });
  await rm(runtimePluginRoot, { recursive: true, force: true });
  await mkdir(runtimeWorkflowRoot, { recursive: true });
  await mkdir(runtimePluginRoot, { recursive: true });

  const registryFixtures = await createRegistryFixtures(`${runtimeArtifactDir}/registry-fixtures`);
  server.setRegistryFixtures(registryFixtures);
  report.maintenance.registryFixtures = {
    pluginRepo: registryFixtures.plugins[0]?.source?.repo ?? null,
    workflowRepo: registryFixtures.workflows[0]?.source?.repo ?? null,
  };

  await writeFile(
    runtimeMacroPath,
    `${JSON.stringify(
      {
        id: runtimeMacroId,
        displayName: 'Runtime Audit Macro',
        description: 'Single-step custom macro used by the runtime audit.',
        tags: ['runtime', 'audit'],
        steps: [
          {
            id: 'detect',
            toolName: 'detect_crypto',
            input: { code: 'crypto.subtle.digest("SHA-256", data)' },
          },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  await mkdir(extensionRegistryRoot, { recursive: true });
  try {
    state.extensionRegistryBackup = await readFile(extensionRegistryFile, 'utf8');
    state.extensionRegistryExisted = true;
  } catch {}

  await writeFile(
    runtimeExtensionPath,
    [
      'export default function runtimeAuditDefault(input = {}) {',
      `  return { ok: true, marker: ${JSON.stringify(BODY_MARKER)}, input };`,
      '}',
      'export function namedContext(input = {}) {',
      `  return { named: true, marker: ${JSON.stringify(BODY_MARKER)}, input };`,
      '}',
      `export const marker = ${JSON.stringify(BODY_MARKER)};`,
      '',
    ].join('\n'),
    'utf8',
  );

  const existingRegistry = (() => {
    if (!state.extensionRegistryBackup) {
      return [];
    }
    try {
      const parsed = JSON.parse(state.extensionRegistryBackup);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  const runtimeExtensionManifest = {
    id: runtimeExtensionId,
    name: 'Runtime Audit Extension',
    version: '1.0.0',
    entry: runtimeExtensionPath,
    permissions: [],
    status: 'unloaded',
  };
  const nextRegistry = existingRegistry.filter(
    (entry) => !isRecord(entry) || entry.id !== runtimeExtensionId,
  );
  nextRegistry.push(runtimeExtensionManifest);
  await writeFile(extensionRegistryFile, `${JSON.stringify(nextRegistry, null, 2)}\n`, 'utf8');
}
