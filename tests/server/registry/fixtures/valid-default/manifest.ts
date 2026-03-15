const tool = {
  name: 'alpha_tool',
  description: 'alpha tool',
  inputSchema: { type: 'object', properties: {} },
};

export default {
  kind: 'domain-manifest',
  version: 1,
  domain: 'alpha',
  depKey: 'alphaDep',
  profiles: ['search', 'workflow', 'full'],
  registrations: [
    {
      tool,
      domain: 'alpha',
      bind: () => async () => ({ ok: true }),
    },
  ],
  ensure: () => ({}),
};
