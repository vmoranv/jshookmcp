import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const isSsrfTargetMock = vi.fn(async () => false);

vi.mock('@src/server/domains/network/replay', () => ({
  isSsrfTarget: vi.fn(async () => isSsrfTargetMock()),
}));

import { GraphQLToolHandlers } from '@server/domains/graphql/handlers';



describe('GraphQLToolHandlers', () => {
  const page = {
    evaluate: vi.fn(),
    evaluateOnNewDocument: vi.fn(),
    setRequestInterception: vi.fn(),
    on: vi.fn(),
  };
  const collector = {
    getActivePage: vi.fn(async () => page),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  } as any;

  let handlers: GraphQLToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new GraphQLToolHandlers(collector);
  });

  it('returns error for invalid call-graph regex', async () => {
    const response = await handlers.handleCallGraphAnalyze({ filterPattern: '[' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(response);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect((response as any).isError).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('Invalid filterPattern regex');
  });

  it('validates required arguments for script_replace_persist', async () => {
    const response = await handlers.handleScriptReplacePersist({ replacement: 'x' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(response);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect((response as any).isError).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('Missing required argument: url');
  });

  it('validates regex mode url in script_replace_persist', async () => {
    const response = await handlers.handleScriptReplacePersist({
      url: '[',
      replacement: 'x',
      matchType: 'regex',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(response);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect((response as any).isError).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('Invalid regex');
  });

  it('registers script replacement rule and installs interception', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(
      await handlers.handleScriptReplacePersist({
        url: '/main.js',
        replacement: 'console.log(1)',
        matchType: 'contains',
      })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.activeRuleCount).toBe(1);
    expect(page.setRequestInterception).toHaveBeenCalledWith(true);
    expect(page.on).toHaveBeenCalledWith('request', expect.any(Function));
    expect(page.evaluateOnNewDocument).toHaveBeenCalledOnce();
  });

  it('blocks introspection for SSRF targets', async () => {
    isSsrfTargetMock.mockResolvedValueOnce(true);
    const response = await handlers.handleGraphqlIntrospect({
      endpoint: 'http://127.0.0.1/graphql',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(response);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect((response as any).isError).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('Blocked');
  });

  it('replays graphql query and returns response metadata', async () => {
    page.evaluate.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      responseText: '{"data":{"ok":true}}',
      responseJson: { data: { ok: true } },
      responseHeaders: { 'content-type': 'application/json' },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(
      await handlers.handleGraphqlReplay({
        endpoint: 'https://vmoranv.github.io/jshookmcp/api/graphql',
        query: 'query Test { ok }',
        variables: { id: 1 },
      })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.responseHeaders['content-type']).toBe('application/json');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.response).toEqual({ data: { ok: true } });
  });
});
