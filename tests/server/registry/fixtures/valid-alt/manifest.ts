const tool = {
  name: 'gamma_tool',
  description: 'gamma tool',
  inputSchema: { type: 'object', properties: {} },
};

export const domainManifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: 'gamma',
  depKey: 'gammaDep',
  profiles: ['full'],
  registrations: [
    {
      tool,
      domain: 'gamma',
      bind: () => async () => ({ ok: true }),
    },
  ],
  ensure: () => ({}),
};
