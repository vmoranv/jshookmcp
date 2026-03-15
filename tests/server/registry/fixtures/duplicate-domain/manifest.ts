const tool = {
  name: 'alpha_other_tool',
  description: 'alpha duplicate domain',
  inputSchema: { type: 'object', properties: {} },
};

export default {
  kind: 'domain-manifest',
  version: 1,
  domain: 'alpha',
  depKey: 'alphaOtherDep',
  profiles: ['full'],
  registrations: [
    {
      tool,
      domain: 'alpha',
      bind: () => async () => ({ ok: true }),
    },
  ],
  ensure: () => ({}),
};
