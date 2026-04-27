export const networkAuthorizationSchema = {
  allowedHosts: {
    type: 'array',
    items: { type: 'string' },
    description: 'Exact hostnames or IP literals allowed for this request.',
  },
  allowedCidrs: {
    type: 'array',
    items: { type: 'string' },
    description: 'Explicit CIDR ranges allowed for this request.',
  },
  allowPrivateNetwork: {
    type: 'boolean',
    description:
      'Allow access to private or reserved network targets, but only when the resolved host matches allowedHosts or allowedCidrs.',
  },
  allowInsecureHttp: {
    type: 'boolean',
    description:
      'Allow plain HTTP access to explicitly authorized targets in allowedHosts or allowedCidrs.',
  },
  expiresAt: {
    type: 'string',
    description: 'Optional ISO-8601 expiry time for this authorization.',
  },
  reason: {
    type: 'string',
    description: 'Short audit note describing why this authorization is needed.',
  },
} as const;
