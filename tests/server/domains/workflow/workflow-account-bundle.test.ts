import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockIsSsrfTarget, mockIsPrivateHost, mockIsLoopbackHost, mockLookup } = vi.hoisted(() => ({
  mockIsSsrfTarget: vi.fn(async () => false),
  mockIsPrivateHost: vi.fn(() => false),
  mockIsLoopbackHost: vi.fn(() => false),
  mockLookup: vi.fn(),
}));

vi.mock('@src/server/domains/network/replay', () => ({
  isSsrfTarget: mockIsSsrfTarget,
  isPrivateHost: mockIsPrivateHost,
  isLoopbackHost: mockIsLoopbackHost,
}));

vi.mock('node:dns/promises', () => ({
  lookup: mockLookup,
}));

vi.mock('node:net', () => ({
  isIP: vi.fn((v: string) => (/^\d+\.\d+\.\d+\.\d+$/.test(v) ? 4 : 0)),
}));

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  realpath: vi.fn(async (p: string) => p),
}));

vi.mock('@utils/outputPaths', () => ({
  getProjectRoot: vi.fn(() => '/project'),
}));

vi.mock('@server/workflows/WorkflowEngine', () => ({
  executeExtensionWorkflow: vi.fn(),
}));

import { WorkflowHandlersAccountBundle } from '@server/domains/workflow/handlers.impl.workflow-account-bundle';
import type {
  WorkflowHandlersDeps,
  ToolHandlerResult,
} from '@server/domains/workflow/handlers.impl.workflow-base';

interface RegisterAccountResponse {
  success: boolean;
  error?: string;
  steps: string[];
  warnings?: string[];
  result: {
    registeredEmail?: string;
    verified: boolean;
    verificationUrl?: string;
    authFindings: Array<{ type: string; confidence: number }>;
  };
}

interface JsBundleSearchResponse {
  success: boolean;
  error?: string;
  bundleSize?: number;
  bundleUrl?: string;
  patternsSearched?: number;
  cached?: boolean;
  results: Record<string, Array<{ match: string; context: string }>>;
}

function makeTextResult(payload: Record<string, unknown>): ToolHandlerResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

function createDeps(): WorkflowHandlersDeps {
  return {
    browserHandlers: {
      handlePageEvaluate: vi.fn(),
      handlePageNavigate: vi.fn().mockResolvedValue(makeTextResult({ success: true })),
      handlePageType: vi.fn().mockResolvedValue(makeTextResult({ success: true })),
      handlePageClick: vi.fn().mockResolvedValue(makeTextResult({ success: true })),
      handleTabWorkflow: vi.fn().mockResolvedValue(makeTextResult({ success: true })),
    },
    advancedHandlers: {
      handleNetworkEnable: vi.fn().mockResolvedValue(makeTextResult({ success: true })),
      handleConsoleInjectFetchInterceptor: vi.fn(),
      handleConsoleInjectXhrInterceptor: vi.fn(),
      handleNetworkGetStats: vi.fn(),
      handleNetworkGetRequests: vi.fn(),
      handleNetworkExtractAuth: vi
        .fn()
        .mockResolvedValue(makeTextResult({ found: 0, findings: [] })),
      handleNetworkExportHar: vi.fn(),
    },
    serverContext: {
      extensionWorkflowsById: new Map(),
      extensionWorkflowRuntimeById: new Map(),
    } as unknown as WorkflowHandlersDeps['serverContext'],
  };
}

describe('WorkflowHandlersAccountBundle', () => {
  let deps: WorkflowHandlersDeps;
  let handlers: WorkflowHandlersAccountBundle;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsSsrfTarget.mockResolvedValue(false);
    deps = createDeps();
    handlers = new WorkflowHandlersAccountBundle(
      deps as unknown as ConstructorParameters<typeof WorkflowHandlersAccountBundle>[0],
    );
  });

  // ── handleRegisterAccountFlow ──────────────────────────────────

  describe('handleRegisterAccountFlow', () => {
    it('performs registration flow without email verification', async () => {
      const body = parseJson<RegisterAccountResponse>(
        await handlers.handleRegisterAccountFlow({
          registerUrl: 'https://example.com/register',
          fields: { email: 'test@example.com', password: 'password123' },
        }),
      );

      expect(body.success).toBe(true);
      expect(body.steps).toContain('network_enable');
      expect(body.steps).toContain('page_navigate(https://example.com/register)');
      expect(body.steps).toContain('network_extract_auth');
      expect(body.result.registeredEmail).toBe('test@example.com');
      expect(body.result.verified).toBe(false);
    });

    it('enables network monitoring as first step', async () => {
      await handlers.handleRegisterAccountFlow({
        registerUrl: 'https://example.com/register',
        fields: {},
      });

      expect(deps.advancedHandlers.handleNetworkEnable).toHaveBeenCalledWith({
        enableExceptions: true,
      });
    });

    it('navigates to register URL', async () => {
      await handlers.handleRegisterAccountFlow({
        registerUrl: 'https://example.com/register',
        fields: {},
      });

      expect(deps.browserHandlers.handlePageNavigate).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://example.com/register',
          waitUntil: 'domcontentloaded',
        }),
      );
    });

    it('fills form fields via handlePageType', async () => {
      await handlers.handleRegisterAccountFlow({
        registerUrl: 'https://example.com/register',
        fields: { username: 'testuser', email: 'test@example.com' },
      });

      expect(deps.browserHandlers.handlePageType).toHaveBeenCalledTimes(2);
      expect(deps.browserHandlers.handlePageType).toHaveBeenCalledWith(
        expect.objectContaining({
          selector: "input[name='username']",
          text: 'testuser',
          delay: 20,
        }),
      );
    });

    it('tracks registered email from email field', async () => {
      const body = parseJson<RegisterAccountResponse>(
        await handlers.handleRegisterAccountFlow({
          registerUrl: 'https://example.com/register',
          fields: { email: 'user@test.com', name: 'Test User' },
        }),
      );

      expect(body.result.registeredEmail).toBe('user@test.com');
    });

    it('clicks submit button with default selector', async () => {
      await handlers.handleRegisterAccountFlow({
        registerUrl: 'https://example.com/register',
        fields: {},
      });

      expect(deps.browserHandlers.handlePageClick).toHaveBeenCalledWith({
        selector: "button[type='submit']",
      });
    });

    it('uses custom submit selector', async () => {
      await handlers.handleRegisterAccountFlow({
        registerUrl: 'https://example.com/register',
        fields: {},
        submitSelector: '#register-btn',
      });

      expect(deps.browserHandlers.handlePageClick).toHaveBeenCalledWith({
        selector: '#register-btn',
      });
    });

    it('records warnings for failed field fills', async () => {
      (
        deps.browserHandlers.handlePageType as unknown as { mockRejectedValueOnce: Function }
      ).mockRejectedValueOnce(new Error('Element not found'));

      const body = parseJson<RegisterAccountResponse>(
        await handlers.handleRegisterAccountFlow({
          registerUrl: 'https://example.com/register',
          fields: { missing_field: 'value' },
        }),
      );

      expect(body.success).toBe(true);
      expect(body.warnings).toBeDefined();
      expect(body.warnings?.some((w) => w.includes('fill failed'))).toBe(true);
    });

    it('handles checkbox selectors', async () => {
      (
        deps.browserHandlers.handlePageEvaluate as unknown as { mockResolvedValue: Function }
      ).mockResolvedValue(makeTextResult({ value: true }));

      const body = parseJson<RegisterAccountResponse>(
        await handlers.handleRegisterAccountFlow({
          registerUrl: 'https://example.com/register',
          fields: {},
          checkboxSelectors: ['#terms', '#newsletter'],
        }),
      );

      expect(body.success).toBe(true);
      expect(body.steps).toContain('page_click(#terms)');
      expect(body.steps).toContain('page_click(#newsletter)');
      expect(deps.browserHandlers.handlePageEvaluate).toHaveBeenCalledTimes(2);
    });

    it('parses checkbox selectors from JSON string', async () => {
      (
        deps.browserHandlers.handlePageEvaluate as unknown as { mockResolvedValue: Function }
      ).mockResolvedValue(makeTextResult({ value: true }));

      const body = parseJson<RegisterAccountResponse>(
        await handlers.handleRegisterAccountFlow({
          registerUrl: 'https://example.com/register',
          fields: {},
          checkboxSelectors: JSON.stringify(['#terms']),
        }),
      );

      expect(body.success).toBe(true);
      expect(body.steps).toContain('page_click(#terms)');
    });

    it('records checkbox click failures as warnings', async () => {
      (
        deps.browserHandlers.handlePageEvaluate as unknown as { mockRejectedValueOnce: Function }
      ).mockRejectedValueOnce(new Error('Checkbox not found'));

      const body = parseJson<RegisterAccountResponse>(
        await handlers.handleRegisterAccountFlow({
          registerUrl: 'https://example.com/register',
          fields: {},
          checkboxSelectors: ['#missing-checkbox'],
        }),
      );

      expect(body.success).toBe(true);
      expect(body.warnings?.some((w) => w.includes('Checkbox'))).toBe(true);
    });

    it('returns error when overall flow fails', async () => {
      (
        deps.advancedHandlers.handleNetworkEnable as unknown as { mockRejectedValue: Function }
      ).mockRejectedValue(new Error('CDP not connected'));

      const body = parseJson<RegisterAccountResponse>(
        await handlers.handleRegisterAccountFlow({
          registerUrl: 'https://example.com/register',
          fields: {},
        }),
      );

      expect(body.success).toBe(false);
      expect(body.error).toContain('CDP not connected');
    });

    it('includes auth findings from network extraction', async () => {
      (
        deps.advancedHandlers.handleNetworkExtractAuth as unknown as { mockResolvedValue: Function }
      ).mockResolvedValue(
        makeTextResult({ found: 1, findings: [{ type: 'cookie', confidence: 0.8 }] }),
      );

      const body = parseJson<RegisterAccountResponse>(
        await handlers.handleRegisterAccountFlow({
          registerUrl: 'https://example.com/register',
          fields: {},
        }),
      );

      expect(body.result.authFindings).toHaveLength(1);
      // @ts-expect-error — auto-suppressed [TS2532]
      expect(body.result.authFindings[0].type).toBe('cookie');
    });

    it('uses empty array for checkbox selectors when not provided', async () => {
      const body = parseJson<RegisterAccountResponse>(
        await handlers.handleRegisterAccountFlow({
          registerUrl: 'https://example.com/register',
          fields: {},
        }),
      );

      expect(body.success).toBe(true);
      // No evaluate calls for checkboxes
      expect(deps.browserHandlers.handlePageEvaluate).not.toHaveBeenCalled();
    });

    it('falls back to an empty checkbox list when the JSON string is invalid', async () => {
      const body = parseJson<RegisterAccountResponse>(
        await handlers.handleRegisterAccountFlow({
          registerUrl: 'https://example.com/register',
          fields: {},
          checkboxSelectors: 'not-json',
        }),
      );

      expect(body.success).toBe(true);
      expect(deps.browserHandlers.handlePageEvaluate).not.toHaveBeenCalled();
    });

    it('adds a warning when the verification link is not found before timeout', async () => {
      const body = parseJson<RegisterAccountResponse>(
        await handlers.handleRegisterAccountFlow({
          registerUrl: 'https://example.com/register',
          fields: { email: 'test@example.com' },
          emailProviderUrl: 'https://mail.example.com',
          verificationLinkPattern: '/auth/verify',
          timeoutMs: 0,
        }),
      );

      expect(body.success).toBe(true);
      expect(body.result.verified).toBe(false);
      expect(body.warnings?.some((warning) => warning.includes('Verification link'))).toBe(true);
    });

    it('warns when the email provider tab fails to open', async () => {
      vi.mocked(deps.browserHandlers.handleTabWorkflow)
        .mockResolvedValueOnce(makeTextResult({ success: true }))
        .mockResolvedValueOnce(makeTextResult({ success: false, error: 'mailbox unavailable' }));

      const body = parseJson<RegisterAccountResponse>(
        await handlers.handleRegisterAccountFlow({
          registerUrl: 'https://example.com/register',
          fields: { email: 'test@example.com' },
          emailProviderUrl: 'https://mail.example.com',
          timeoutMs: 1,
        }),
      );

      expect(body.success).toBe(true);
      expect(body.result.verified).toBe(false);
      expect(
        body.warnings?.some((warning) => warning.includes('Could not open email provider tab')),
      ).toBe(true);
    });
  });

  // ── handleJsBundleSearch ───────────────────────────────────────

  describe('handleJsBundleSearch', () => {
    it('returns error when url is missing', async () => {
      const body = parseJson<JsBundleSearchResponse>(
        await handlers.handleJsBundleSearch({ patterns: [{ name: 'test', regex: 'test' }] }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('url and patterns are required');
    });

    it('returns error when patterns array is empty', async () => {
      const body = parseJson<JsBundleSearchResponse>(
        await handlers.handleJsBundleSearch({
          url: 'https://cdn.example.com/bundle.js',
          patterns: [],
        }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('url and patterns are required');
    });

    it('returns error when patterns is missing', async () => {
      const body = parseJson<JsBundleSearchResponse>(
        await handlers.handleJsBundleSearch({ url: 'https://cdn.example.com/bundle.js' }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('url and patterns are required');
    });

    it('blocks SSRF targets', async () => {
      mockIsSsrfTarget.mockResolvedValue(true);

      const body = parseJson<JsBundleSearchResponse>(
        await handlers.handleJsBundleSearch({
          url: 'http://169.254.169.254/latest',
          patterns: [{ name: 'test', regex: 'test' }],
        }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('Blocked');
      expect(body.error).toContain('private/reserved');
    });

    it('reports invalid regex in pattern results', async () => {
      // Mock a successful fetch
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => 'var x = 1;',
        headers: new Map(),
      }) as unknown as typeof globalThis.fetch;

      mockLookup.mockResolvedValue({ address: '1.2.3.4' });

      try {
        const body = parseJson<JsBundleSearchResponse>(
          await handlers.handleJsBundleSearch({
            url: 'https://cdn.example.com/bundle.js',
            patterns: [{ name: 'bad_regex', regex: '[invalid' }],
            cacheBundle: false,
          }),
        );

        expect(body.success).toBe(true);
        // @ts-expect-error — auto-suppressed [TS18048, TS2532]
        expect(body.results.bad_regex[0].context).toContain('Invalid regex');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('returns fetch error for network failures', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new Error('Network error')) as unknown as typeof globalThis.fetch;
      mockLookup.mockResolvedValue({ address: '1.2.3.4' });

      try {
        const body = parseJson<JsBundleSearchResponse>(
          await handlers.handleJsBundleSearch({
            url: 'https://cdn.example.com/bundle.js',
            patterns: [{ name: 'test', regex: 'test' }],
            cacheBundle: false,
          }),
        );

        expect(body.success).toBe(false);
        expect(body.error).toContain('Fetch error');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('skips noisy base64 matches when stripNoise is enabled', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => 'data:image/png;base64,abc123',
        headers: new Map(),
      }) as unknown as typeof globalThis.fetch;
      mockLookup.mockResolvedValue({ address: '1.2.3.4' });

      try {
        const body = parseJson<JsBundleSearchResponse>(
          await handlers.handleJsBundleSearch({
            url: 'https://cdn.example.com/bundle.js',
            patterns: [{ name: 'noise', regex: 'abc123' }],
            cacheBundle: false,
            stripNoise: true,
          }),
        );

        expect(body.success).toBe(true);
        expect(body.results.noise).toHaveLength(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('returns cached results on a repeated bundle lookup', async () => {
      const originalFetch = globalThis.fetch;
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => 'cached content var test = 1;',
        headers: new Map(),
      });
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
      mockLookup.mockResolvedValue({ address: '1.2.3.4' });

      try {
        await handlers.handleJsBundleSearch({
          url: 'https://cdn.example.com/cached.js',
          patterns: [{ name: 'test', regex: 'test' }],
          cacheBundle: true,
        });

        const body = parseJson<JsBundleSearchResponse>(
          await handlers.handleJsBundleSearch({
            url: 'https://cdn.example.com/cached.js',
            patterns: [{ name: 'test', regex: 'test' }],
            cacheBundle: true,
          }),
        );

        expect(body.success).toBe(true);
        expect(body.cached).toBe(true);
        expect(mockFetch).toHaveBeenCalledTimes(1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('returns error for non-ok HTTP response', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Map(),
      }) as unknown as typeof globalThis.fetch;
      mockLookup.mockResolvedValue({ address: '1.2.3.4' });

      try {
        const body = parseJson<JsBundleSearchResponse>(
          await handlers.handleJsBundleSearch({
            url: 'https://cdn.example.com/bundle.js',
            patterns: [{ name: 'test', regex: 'test' }],
            cacheBundle: false,
          }),
        );

        expect(body.success).toBe(false);
        expect(body.error).toContain('404');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('parses patterns from JSON string', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => 'function hello() { return "world"; }',
        headers: new Map(),
      }) as unknown as typeof globalThis.fetch;
      mockLookup.mockResolvedValue({ address: '1.2.3.4' });

      try {
        const body = parseJson<JsBundleSearchResponse>(
          await handlers.handleJsBundleSearch({
            url: 'https://cdn.example.com/bundle.js',
            patterns: JSON.stringify([{ name: 'fn_search', regex: 'function\\s+\\w+' }]),
            cacheBundle: false,
          }),
        );

        expect(body.success).toBe(true);
        expect(body.results.fn_search).toBeDefined();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('searches bundle text and returns matching results', async () => {
      const bundleContent = 'var apiKey = "sk-12345"; var token = "tok-abc";';
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => bundleContent,
        headers: new Map(),
      }) as unknown as typeof globalThis.fetch;
      mockLookup.mockResolvedValue({ address: '1.2.3.4' });

      try {
        const body = parseJson<JsBundleSearchResponse>(
          await handlers.handleJsBundleSearch({
            url: 'https://cdn.example.com/bundle.js',
            patterns: [{ name: 'api_keys', regex: 'apiKey\\s*=\\s*"[^"]*"' }],
            cacheBundle: false,
          }),
        );

        expect(body.success).toBe(true);
        expect(body.bundleSize).toBe(bundleContent.length);
        expect(body.results.api_keys).toHaveLength(1);
        // @ts-expect-error — auto-suppressed [TS18048, TS2532]
        expect(body.results.api_keys[0].match).toContain('apiKey');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('limits matches to maxMatches', async () => {
      const bundleContent = 'aaa bbb aaa bbb aaa bbb aaa bbb aaa bbb';
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => bundleContent,
        headers: new Map(),
      }) as unknown as typeof globalThis.fetch;
      mockLookup.mockResolvedValue({ address: '1.2.3.4' });

      try {
        const body = parseJson<JsBundleSearchResponse>(
          await handlers.handleJsBundleSearch({
            url: 'https://cdn.example.com/bundle.js',
            patterns: [{ name: 'all_aaa', regex: 'aaa' }],
            maxMatches: 2,
            cacheBundle: false,
          }),
        );

        expect(body.success).toBe(true);
        // @ts-expect-error — auto-suppressed [TS18048]
        expect(body.results.all_aaa.length).toBeLessThanOrEqual(2);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('uses cache when cacheBundle is true and cache is fresh', async () => {
      const bundleContent = 'cached content var test = 1;';
      const originalFetch = globalThis.fetch;
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => bundleContent,
        headers: new Map(),
      });
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
      mockLookup.mockResolvedValue({ address: '1.2.3.4' });

      try {
        // First call populates cache
        await handlers.handleJsBundleSearch({
          url: 'https://cdn.example.com/bundle.js',
          patterns: [{ name: 'test', regex: 'test' }],
          cacheBundle: true,
        });

        // Second call should use cache
        const body = parseJson<JsBundleSearchResponse>(
          await handlers.handleJsBundleSearch({
            url: 'https://cdn.example.com/bundle.js',
            patterns: [{ name: 'test', regex: 'test' }],
            cacheBundle: true,
          }),
        );

        expect(body.success).toBe(true);
        expect(body.cached).toBe(true);
        // fetch should only be called once (first call)
        expect(mockFetch).toHaveBeenCalledTimes(1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('returns bundleUrl and patternsSearched in response', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => 'content',
        headers: new Map(),
      }) as unknown as typeof globalThis.fetch;
      mockLookup.mockResolvedValue({ address: '1.2.3.4' });

      try {
        const body = parseJson<JsBundleSearchResponse>(
          await handlers.handleJsBundleSearch({
            url: 'https://cdn.example.com/bundle.js',
            patterns: [
              { name: 'p1', regex: 'a' },
              { name: 'p2', regex: 'b' },
            ],
            cacheBundle: false,
          }),
        );

        expect(body.bundleUrl).toBe('https://cdn.example.com/bundle.js');
        expect(body.patternsSearched).toBe(2);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('falls back to empty array if patterns JSON is invalid', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => 'content',
        headers: new Map(),
      }) as unknown as typeof globalThis.fetch;
      mockLookup.mockResolvedValue({ address: '1.2.3.4' });

      try {
        const body = parseJson<JsBundleSearchResponse>(
          await handlers.handleJsBundleSearch({
            url: 'https://cdn.example.com/bundle.js',
            patterns: '{invalid:json',
            cacheBundle: false,
          }),
        );
        expect(body.success).toBe(false);
        expect(body.error).toContain('url and patterns are required');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('blocks non-HTTP/HTTPS protocols', async () => {
      mockLookup.mockResolvedValue({ address: '1.2.3.4' });
      const body = parseJson<JsBundleSearchResponse>(
        await handlers.handleJsBundleSearch({
          url: 'ftp://example.com/bundle.js',
          patterns: [{ name: 'test', regex: 'test' }],
          cacheBundle: false,
        }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('insecure HTTP is only allowed');
    });

    it('throws when max redirects exceeded', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 301,
        headers: new Map([['location', 'https://cdn.example.com/redir']]),
      }) as unknown as typeof globalThis.fetch;
      mockLookup.mockResolvedValue({ address: '1.2.3.4' });

      try {
        const body = parseJson<JsBundleSearchResponse>(
          await handlers.handleJsBundleSearch({
            url: 'https://cdn.example.com/bundle.js',
            patterns: [{ name: 'test', regex: 'test' }],
            cacheBundle: false,
          }),
        );
        expect(body.success).toBe(false);
        expect(body.error).toContain('Too many redirects');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('aborts fetch on timeout when cacheBundle is true', async () => {
      const originalFetch = globalThis.fetch;
      vi.useFakeTimers({ shouldAdvanceTime: true });

      // Mock fetch that rejects on abort — compatible with fake timers.
      // AbortController.timeout (WORKFLOW_JS_BUNDLE_FETCH_TIMEOUT_MS) is faked
      // by vi.useFakeTimers(), so advancing time triggers the abort and this
      // mock's listener fires in sync with the fake clock.
      globalThis.fetch = vi.fn().mockImplementation(async (_url: unknown, options: unknown) => {
        const opts = options as { signal?: AbortSignal } | undefined;
        if (opts?.signal?.aborted) throw new Error('AbortError');
        return new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => reject(new Error('AbortError')), {
            once: true,
          });
        });
      }) as unknown as typeof globalThis.fetch;
      mockLookup.mockResolvedValue({ address: '1.2.3.4' });

      try {
        // Start the handler — it will set WORKFLOW_JS_BUNDLE_FETCH_TIMEOUT_MS
        // (30 s) as an AbortController timeout which is faked by vitest.
        const promise = handlers.handleJsBundleSearch({
          url: 'https://cdn.example.com/bundle.js',
          patterns: [{ name: 'test', regex: 'test' }],
          cacheBundle: true,
        });

        // Advance fake time past the fetch timeout so the abort fires
        await vi.advanceTimersByTimeAsync(30_000);
        const body = parseJson<JsBundleSearchResponse>(await promise);

        expect(body.success).toBe(false);
        expect(body.error).toContain('Fetch error');
      } finally {
        vi.useRealTimers();
        globalThis.fetch = originalFetch;
      }
    });

    it('aborts fetch on timeout when cacheBundle is false', async () => {
      const originalFetch = globalThis.fetch;
      vi.useFakeTimers({ shouldAdvanceTime: true });

      globalThis.fetch = vi.fn().mockImplementation(async (_url: unknown, options: unknown) => {
        const opts = options as { signal?: AbortSignal } | undefined;
        if (opts?.signal?.aborted) throw new Error('AbortError');
        return new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => reject(new Error('AbortError')), {
            once: true,
          });
        });
      }) as unknown as typeof globalThis.fetch;
      mockLookup.mockResolvedValue({ address: '1.2.3.4' });

      try {
        const promise = handlers.handleJsBundleSearch({
          url: 'https://cdn.example.com/bundle.js',
          patterns: [{ name: 'test', regex: 'test' }],
          cacheBundle: false,
        });

        await vi.advanceTimersByTimeAsync(30_000);
        const body = parseJson<JsBundleSearchResponse>(await promise);

        expect(body.success).toBe(false);
        expect(body.error).toContain('Fetch error');
      } finally {
        vi.useRealTimers();
        globalThis.fetch = originalFetch;
      }
    });
  });
  describe('additional coverage', () => {
    it('follows the email verification flow when a verification link is found', async () => {
      vi.mocked(deps.browserHandlers.handleTabWorkflow)
        .mockResolvedValueOnce(makeTextResult({ success: true }))
        .mockResolvedValueOnce(makeTextResult({ success: true }))
        .mockResolvedValueOnce(
          makeTextResult({ success: true, value: 'https://example.com/auth/verify' }),
        );

      const body = parseJson<RegisterAccountResponse>(
        await handlers.handleRegisterAccountFlow({
          registerUrl: 'https://example.com/register',
          fields: { email: 'test@example.com' },
          emailProviderUrl: 'https://mail.example.com',
          verificationLinkPattern: '/auth/verify',
          timeoutMs: 1,
        }),
      );

      expect(body.success).toBe(true);
      expect(body.result.verified).toBe(true);
      expect(body.result.verificationUrl).toBe('https://example.com/auth/verify');
      expect(body.steps).toContain('tab_workflow:alias_open(emailTab, https://mail.example.com)');
      expect(body.steps).toContain('page_navigate(https://example.com/auth/verify)');
    });

    it('blocks insecure http bundle URLs on non-loopback hosts', async () => {
      const body = parseJson<JsBundleSearchResponse>(
        await handlers.handleJsBundleSearch({
          url: 'http://example.com/bundle.js',
          patterns: [{ name: 'test', regex: 'test' }],
          cacheBundle: false,
        }),
      );

      expect(body.success).toBe(false);
      expect(body.error).toContain('insecure HTTP is only allowed');
    });

    it('fails registration when auth extraction result has no text payload', async () => {
      vi.mocked(deps.advancedHandlers.handleNetworkExtractAuth).mockResolvedValueOnce({
        content: [{ type: 'text' }],
      } as ToolHandlerResult);

      const body = parseJson<RegisterAccountResponse>(
        await handlers.handleRegisterAccountFlow({
          registerUrl: 'https://example.com/register',
          fields: { email: 'test@example.com' },
        }),
      );

      expect(body.success).toBe(false);
      expect(body.error).toContain('Failed to extract auth result text');
    });

    it('fails registration when email-provider open result has no text payload', async () => {
      vi.mocked(deps.browserHandlers.handleTabWorkflow)
        .mockResolvedValueOnce(makeTextResult({ success: true }))
        .mockResolvedValueOnce({ content: [{ type: 'text' }] } as ToolHandlerResult);

      const body = parseJson<RegisterAccountResponse>(
        await handlers.handleRegisterAccountFlow({
          registerUrl: 'https://example.com/register',
          fields: { email: 'test@example.com' },
          emailProviderUrl: 'https://mail.example.com',
          timeoutMs: 1,
        }),
      );

      expect(body.success).toBe(false);
      expect(body.error).toContain('Failed to extract open tab result text');
    });

    it('blocks bundles whose DNS resolves to a private IP', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn() as unknown as typeof globalThis.fetch;
      mockLookup.mockResolvedValue({ address: '10.0.0.8' });
      mockIsPrivateHost.mockReturnValue(true);

      try {
        const body = parseJson<JsBundleSearchResponse>(
          await handlers.handleJsBundleSearch({
            url: 'https://cdn.example.com/private.js',
            patterns: [{ name: 'test', regex: 'test' }],
            cacheBundle: false,
          }),
        );

        expect(body.success).toBe(false);
        expect(body.error).toContain('resolved to private IP');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('allows loopback http bundle fetches and rewrites Host header after DNS pinning', async () => {
      const originalFetch = globalThis.fetch;
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => 'const loopback = true;',
        headers: new Map(),
      });
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
      mockIsLoopbackHost.mockReturnValue(true);
      mockLookup.mockResolvedValue({ address: '127.0.0.1' });
      mockIsPrivateHost.mockReturnValue(false);

      try {
        const body = parseJson<JsBundleSearchResponse>(
          await handlers.handleJsBundleSearch({
            url: 'http://localhost:8123/bundle.js',
            patterns: [{ name: 'loopback', regex: 'loopback' }],
            cacheBundle: false,
          }),
        );

        expect(body.success).toBe(true);
        expect(mockFetch).toHaveBeenCalledWith(
          'http://127.0.0.1:8123/bundle.js',
          expect.objectContaining({
            redirect: 'manual',
            headers: expect.objectContaining({
              Host: 'localhost:8123',
            }),
          }),
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('fails when a redirect response omits the Location header', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 302,
        headers: { get: vi.fn(() => null) },
      }) as unknown as typeof globalThis.fetch;
      mockLookup.mockResolvedValue({ address: '1.2.3.4' });

      try {
        const body = parseJson<JsBundleSearchResponse>(
          await handlers.handleJsBundleSearch({
            url: 'https://cdn.example.com/redirect.js',
            patterns: [{ name: 'redirect', regex: 'redirect' }],
            cacheBundle: false,
          }),
        );

        expect(body.success).toBe(false);
        expect(body.error).toContain('Redirect 302 without Location header');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('fails when a redirect target becomes SSRF-blocked', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 302,
        headers: { get: vi.fn(() => 'https://internal.example/private.js') },
      }) as unknown as typeof globalThis.fetch;
      mockLookup.mockResolvedValue({ address: '1.2.3.4' });
      mockIsSsrfTarget.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      try {
        const body = parseJson<JsBundleSearchResponse>(
          await handlers.handleJsBundleSearch({
            url: 'https://cdn.example.com/redirect.js',
            patterns: [{ name: 'redirect', regex: 'redirect' }],
            cacheBundle: false,
          }),
        );

        expect(body.success).toBe(false);
        expect(body.error).toContain('Redirect blocked');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('fails when the fetched bundle exceeds the size limit', async () => {
      const originalFetch = globalThis.fetch;
      const oversizedBundle = 'a'.repeat(21 * 1024 * 1024);
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => oversizedBundle,
        headers: new Map(),
      }) as unknown as typeof globalThis.fetch;
      mockLookup.mockResolvedValue({ address: '1.2.3.4' });

      try {
        const body = parseJson<JsBundleSearchResponse>(
          await handlers.handleJsBundleSearch({
            url: 'https://cdn.example.com/huge.js',
            patterns: [{ name: 'huge', regex: 'aaa' }],
            cacheBundle: false,
          }),
        );

        expect(body.success).toBe(false);
        expect(body.error).toContain('Response too large');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('returns fetch failure details on the cached fetch path', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Map(),
      }) as unknown as typeof globalThis.fetch;
      mockLookup.mockResolvedValue({ address: '1.2.3.4' });

      try {
        const body = parseJson<JsBundleSearchResponse>(
          await handlers.handleJsBundleSearch({
            url: 'https://cdn.example.com/cached-failure.js',
            patterns: [{ name: 'test', regex: 'test' }],
            cacheBundle: true,
          }),
        );

        expect(body.success).toBe(false);
        expect(body.error).toContain('503 Service Unavailable');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('rejects oversized bundles on the cached fetch path', async () => {
      const originalFetch = globalThis.fetch;
      const oversizedBundle = 'b'.repeat(21 * 1024 * 1024);
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => oversizedBundle,
        headers: new Map(),
      }) as unknown as typeof globalThis.fetch;
      mockLookup.mockResolvedValue({ address: '1.2.3.4' });

      try {
        const body = parseJson<JsBundleSearchResponse>(
          await handlers.handleJsBundleSearch({
            url: 'https://cdn.example.com/cached-huge.js',
            patterns: [{ name: 'huge', regex: 'bbb' }],
            cacheBundle: true,
          }),
        );

        expect(body.success).toBe(false);
        expect(body.error).toContain('Response too large');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('filters long base64-like noise blocks when stripNoise is enabled', async () => {
      const originalFetch = globalThis.fetch;
      const longBase64 = 'A'.repeat(260);
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => `prefix ${longBase64} suffix`,
        headers: new Map(),
      }) as unknown as typeof globalThis.fetch;
      mockLookup.mockResolvedValue({ address: '1.2.3.4' });

      try {
        const body = parseJson<JsBundleSearchResponse>(
          await handlers.handleJsBundleSearch({
            url: 'https://cdn.example.com/noise.js',
            patterns: [{ name: 'noise', regex: 'AAAAA+' }],
            cacheBundle: false,
            stripNoise: true,
          }),
        );

        expect(body.success).toBe(true);
        expect(body.results.noise).toHaveLength(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('reports DNS failures when lookup rejects while pinning', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn() as unknown as typeof globalThis.fetch;
      mockLookup.mockRejectedValueOnce(new Error('lookup failed'));

      try {
        const body = parseJson<JsBundleSearchResponse>(
          await handlers.handleJsBundleSearch({
            url: 'https://cdn.example.com/error.js',
            patterns: [{ name: 'test', regex: 'test' }],
            cacheBundle: false,
          }),
        );

        expect(body.success).toBe(false);
        expect(body.error).toContain('DNS resolution failed');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('follows redirects while honoring SSRF guards and fetches the final bundle', async () => {
      const originalFetch = globalThis.fetch;
      const redirectLocation = 'https://cdn.example.com/final.js';
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          status: 302,
          ok: false,
          headers: { get: () => redirectLocation },
        })
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          text: async () => 'redirected content',
          headers: new Map(),
        });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
      mockLookup
        .mockResolvedValueOnce({ address: '1.2.3.4' })
        .mockResolvedValueOnce({ address: '1.2.3.5' });

      try {
        const body = parseJson<JsBundleSearchResponse>(
          await handlers.handleJsBundleSearch({
            url: 'https://cdn.example.com/original.js',
            patterns: [{ name: 'redirected', regex: 'redirected' }],
            cacheBundle: false,
          }),
        );

        expect(body.success).toBe(true);
        expect(body.bundleSize).toBe('redirected content'.length);
        expect(body.results.redirected).toHaveLength(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(body.cached).toBe(false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
