const tool = {
  name: 'delta_tool',
  description: 'delta duplicate dep',
  inputSchema: { type: 'object', properties: {} },
};

export default {
  kind: 'domain-manifest',
  version: 1,
  domain: 'delta',
  depKey: 'alphaDep',
  profiles: ['full'],
  registrations: [
    {
      tool,
      domain: 'delta',
      bind: () => async () => ({ ok: true }),
    },
  ],
  ensure: () => ({}),
};
