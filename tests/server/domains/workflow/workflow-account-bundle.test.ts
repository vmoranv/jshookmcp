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

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
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
    } as any,
  };
}

describe('WorkflowHandlersAccountBundle', () => {
  let deps: WorkflowHandlersDeps;
  let handlers: WorkflowHandlersAccountBundle;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsSsrfTarget.mockResolvedValue(false);
    deps = createDeps();
    handlers = new WorkflowHandlersAccountBundle(deps);
  });

  // ── handleRegisterAccountFlow ──────────────────────────────────

  describe('handleRegisterAccountFlow', () => {
    it('performs registration flow without email verification', async () => {
      const body = parseJson(
        await handlers.handleRegisterAccountFlow({
          registerUrl: 'https://example.com/register',
          fields: { email: 'test@example.com', password: 'password123' },
        })
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
        })
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
        })
      );
    });

    it('tracks registered email from email field', async () => {
      const body = parseJson(
        await handlers.handleRegisterAccountFlow({
          registerUrl: 'https://example.com/register',
          fields: { email: 'user@test.com', name: 'Test User' },
        })
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
      (deps.browserHandlers.handlePageType as any).mockRejectedValueOnce(
        new Error('Element not found')
      );

      const body = parseJson(
        await handlers.handleRegisterAccountFlow({
          registerUrl: 'https://example.com/register',
          fields: { missing_field: 'value' },
        })
      );

      expect(body.success).toBe(true);
      expect(body.warnings).toBeDefined();
      expect(body.warnings.some((w: string) => w.includes('fill failed'))).toBe(true);
    });

    it('handles checkbox selectors', async () => {
      (deps.browserHandlers.handlePageEvaluate as any).mockResolvedValue(
        makeTextResult({ value: true })
      );

      const body = parseJson(
        await handlers.handleRegisterAccountFlow({
          registerUrl: 'https://example.com/register',
          fields: {},
          checkboxSelectors: ['#terms', '#newsletter'],
        })
      );

      expect(body.success).toBe(true);
      expect(body.steps).toContain('page_click(#terms)');
      expect(body.steps).toContain('page_click(#newsletter)');
      expect(deps.browserHandlers.handlePageEvaluate).toHaveBeenCalledTimes(2);
    });

    it('parses checkbox selectors from JSON string', async () => {
      (deps.browserHandlers.handlePageEvaluate as any).mockResolvedValue(
        makeTextResult({ value: true })
      );

      const body = parseJson(
        await handlers.handleRegisterAccountFlow({
          registerUrl: 'https://example.com/register',
          fields: {},
          checkboxSelectors: JSON.stringify(['#terms']),
        })
      );

      expect(body.success).toBe(true);
      expect(body.steps).toContain('page_click(#terms)');
    });

    it('records checkbox click failures as warnings', async () => {
      (deps.browserHandlers.handlePageEvaluate as any).mockRejectedValueOnce(
        new Error('Checkbox not found')
      );

      const body = parseJson(
        await handlers.handleRegisterAccountFlow({
          registerUrl: 'https://example.com/register',
          fields: {},
          checkboxSelectors: ['#missing-checkbox'],
        })
      );

      expect(body.success).toBe(true);
      expect(body.warnings.some((w: string) => w.includes('Checkbox'))).toBe(true);
    });

    it('returns error when overall flow fails', async () => {
      (deps.advancedHandlers.handleNetworkEnable as any).mockRejectedValue(
        new Error('CDP not connected')
      );

      const body = parseJson(
        await handlers.handleRegisterAccountFlow({
          registerUrl: 'https://example.com/register',
          fields: {},
        })
      );

      expect(body.success).toBe(false);
      expect(body.error).toContain('CDP not connected');
    });

    it('includes auth findings from network extraction', async () => {
      (deps.advancedHandlers.handleNetworkExtractAuth as any).mockResolvedValue(
        makeTextResult({ found: 1, findings: [{ type: 'cookie', confidence: 0.8 }] })
      );

      const body = parseJson(
        await handlers.handleRegisterAccountFlow({
          registerUrl: 'https://example.com/register',
          fields: {},
        })
      );

      expect(body.result.authFindings).toHaveLength(1);
      expect(body.result.authFindings[0].type).toBe('cookie');
    });

    it('uses empty array for checkbox selectors when not provided', async () => {
      const body = parseJson(
        await handlers.handleRegisterAccountFlow({
          registerUrl: 'https://example.com/register',
          fields: {},
        })
      );

      expect(body.success).toBe(true);
      // No evaluate calls for checkboxes
      expect(deps.browserHandlers.handlePageEvaluate).not.toHaveBeenCalled();
    });
  });

  // ── handleJsBundleSearch ───────────────────────────────────────

  describe('handleJsBundleSearch', () => {
    it('returns error when url is missing', async () => {
      const body = parseJson(
        await handlers.handleJsBundleSearch({ patterns: [{ name: 'test', regex: 'test' }] })
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('url and patterns are required');
    });

    it('returns error when patterns array is empty', async () => {
      const body = parseJson(
        await handlers.handleJsBundleSearch({
          url: 'https://cdn.example.com/bundle.js',
          patterns: [],
        })
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('url and patterns are required');
    });

    it('returns error when patterns is missing', async () => {
      const body = parseJson(
        await handlers.handleJsBundleSearch({ url: 'https://cdn.example.com/bundle.js' })
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('url and patterns are required');
    });

    it('blocks SSRF targets', async () => {
      mockIsSsrfTarget.mockResolvedValue(true);

      const body = parseJson(
        await handlers.handleJsBundleSearch({
          url: 'http://169.254.169.254/latest',
          patterns: [{ name: 'test', regex: 'test' }],
        })
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
      }) as any;

      mockLookup.mockResolvedValue({ address: '1.2.3.4' });

      try {
        const body = parseJson(
          await handlers.handleJsBundleSearch({
            url: 'https://cdn.example.com/bundle.js',
            patterns: [{ name: 'bad_regex', regex: '[invalid' }],
            cacheBundle: false,
          })
        );

        expect(body.success).toBe(true);
        expect(body.results.bad_regex[0].context).toContain('Invalid regex');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('returns fetch error for network failures', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as any;
      mockLookup.mockResolvedValue({ address: '1.2.3.4' });

      try {
        const body = parseJson(
          await handlers.handleJsBundleSearch({
            url: 'https://cdn.example.com/bundle.js',
            patterns: [{ name: 'test', regex: 'test' }],
            cacheBundle: false,
          })
        );

        expect(body.success).toBe(false);
        expect(body.error).toContain('Fetch error');
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
      }) as any;
      mockLookup.mockResolvedValue({ address: '1.2.3.4' });

      try {
        const body = parseJson(
          await handlers.handleJsBundleSearch({
            url: 'https://cdn.example.com/bundle.js',
            patterns: [{ name: 'test', regex: 'test' }],
            cacheBundle: false,
          })
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
      }) as any;
      mockLookup.mockResolvedValue({ address: '1.2.3.4' });

      try {
        const body = parseJson(
          await handlers.handleJsBundleSearch({
            url: 'https://cdn.example.com/bundle.js',
            patterns: JSON.stringify([{ name: 'fn_search', regex: 'function\\s+\\w+' }]),
            cacheBundle: false,
          })
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
      }) as any;
      mockLookup.mockResolvedValue({ address: '1.2.3.4' });

      try {
        const body = parseJson(
          await handlers.handleJsBundleSearch({
            url: 'https://cdn.example.com/bundle.js',
            patterns: [{ name: 'api_keys', regex: 'apiKey\\s*=\\s*"[^"]*"' }],
            cacheBundle: false,
          })
        );

        expect(body.success).toBe(true);
        expect(body.bundleSize).toBe(bundleContent.length);
        expect(body.results.api_keys).toHaveLength(1);
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
      }) as any;
      mockLookup.mockResolvedValue({ address: '1.2.3.4' });

      try {
        const body = parseJson(
          await handlers.handleJsBundleSearch({
            url: 'https://cdn.example.com/bundle.js',
            patterns: [{ name: 'all_aaa', regex: 'aaa' }],
            maxMatches: 2,
            cacheBundle: false,
          })
        );

        expect(body.success).toBe(true);
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
      globalThis.fetch = mockFetch as any;
      mockLookup.mockResolvedValue({ address: '1.2.3.4' });

      try {
        // First call populates cache
        await handlers.handleJsBundleSearch({
          url: 'https://cdn.example.com/bundle.js',
          patterns: [{ name: 'test', regex: 'test' }],
          cacheBundle: true,
        });

        // Second call should use cache
        const body = parseJson(
          await handlers.handleJsBundleSearch({
            url: 'https://cdn.example.com/bundle.js',
            patterns: [{ name: 'test', regex: 'test' }],
            cacheBundle: true,
          })
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
      }) as any;
      mockLookup.mockResolvedValue({ address: '1.2.3.4' });

      try {
        const body = parseJson(
          await handlers.handleJsBundleSearch({
            url: 'https://cdn.example.com/bundle.js',
            patterns: [
              { name: 'p1', regex: 'a' },
              { name: 'p2', regex: 'b' },
            ],
            cacheBundle: false,
          })
        );

        expect(body.bundleUrl).toBe('https://cdn.example.com/bundle.js');
        expect(body.patternsSearched).toBe(2);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
