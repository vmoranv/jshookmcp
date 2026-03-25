import { expect } from 'vitest';

type ToolLike = Record<string, unknown>;

type RegistrationLike = {
  tool: ToolLike;
  domain?: string;
  bind: unknown;
};

type ManifestLike = {
  kind: string;
  version: number;
  domain: string;
  depKey: string;
  profiles: readonly string[];
  ensure: unknown;
  registrations: readonly RegistrationLike[];
};

type RuntimeModule = Record<string, unknown>;

type DomainExportContractConfig = {
  expectedDomain: string;
  definitionExportNames: string[];
  loadDefinitions: () => Promise<RuntimeModule>;
  getToolArrays: (module: RuntimeModule) => Array<Array<Record<string, unknown>>>;
  loadManifest: () => Promise<{ default: ManifestLike }>;
};

export async function assertDomainExportContract(
  config: DomainExportContractConfig,
): Promise<void> {
  const definitionModule = await config.loadDefinitions();

  expect(Object.keys(definitionModule).toSorted()).toEqual(
    [...config.definitionExportNames].toSorted(),
  );

  const toolArrays = config.getToolArrays(definitionModule);
  expect(toolArrays.length).toBeGreaterThan(0);

  const combinedTools = toolArrays.flat();
  expect(combinedTools.length).toBeGreaterThan(0);

  combinedTools.forEach((tool) => {
    expect(tool).toEqual(
      expect.objectContaining({
        name: expect.any(String),
        description: expect.any(String),
        inputSchema: expect.anything(),
      }),
    );
  });

  const toolNames = combinedTools.map((tool) => tool.name as string);
  expect(new Set(toolNames).size).toBe(toolNames.length);

  const manifestModule = await config.loadManifest();
  expect(Object.keys(manifestModule)).toEqual(['default']);

  const manifest = manifestModule.default;
  expect(manifest).toEqual(
    expect.objectContaining({
      kind: 'domain-manifest',
      version: 1,
      domain: config.expectedDomain,
      depKey: expect.any(String),
      profiles: expect.any(Array),
      ensure: expect.any(Function),
      registrations: expect.any(Array),
    }),
  );

  expect(manifest.profiles.length).toBeGreaterThan(0);
  // Every registered tool must be defined (but not all definitions may be registered
  // when tools are platform-filtered at startup).
  const registrationToolNames = new Set(
    manifest.registrations.map((r) => (r.tool as ToolLike).name as string),
  );
  const definedToolNames = new Set(toolNames);
  for (const name of registrationToolNames) {
    expect(definedToolNames.has(name), `Registered tool "${name}" not in definitions`).toBe(true);
  }
  expect(manifest.registrations.map((registration) => registration.domain)).toEqual(
    Array(manifest.registrations.length).fill(config.expectedDomain),
  );

  manifest.registrations.forEach((registration) => {
    expect(typeof registration.bind).toBe('function');
  });
}
