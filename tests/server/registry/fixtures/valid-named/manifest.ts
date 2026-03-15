const tool = {
  name: 'beta_tool',
  description: 'beta tool',
  inputSchema: { type: 'object', properties: {} },
};

export const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: 'beta',
  depKey: 'betaDep',
  profiles: ['workflow', 'full'],
  registrations: [
    {
      tool,
      domain: 'beta',
      bind: () => async () => ({ ok: true }),
    },
  ],
  ensure: () => ({}),
};
