const tool = {
  name: 'js_tool',
  description: 'js preferred tool',
  inputSchema: { type: 'object', properties: {} },
};

export default {
  kind: 'domain-manifest',
  version: 1,
  domain: 'js-first',
  depKey: 'jsFirstDep',
  profiles: ['search', 'full'],
  registrations: [
    {
      tool,
      domain: 'js-first',
      bind: () => async () => ({ ok: true }),
    },
  ],
  ensure: () => ({}),
};
