import { beforeEach, describe, expect, it, vi } from 'vitest';

const isSsrfTargetMock = vi.fn(async () => false);

vi.mock('../../../../src/server/domains/network/replay.js', () => ({
  isSsrfTarget: (...args: any[]) => isSsrfTargetMock(...args),
}));

import { GraphQLToolHandlers } from '../../../../src/server/domains/graphql/handlers.js';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('GraphQLToolHandlers', () => {
  const page = {
    evaluate: vi.fn(),
    evaluateOnNewDocument: vi.fn(),
    setRequestInterception: vi.fn(),
    on: vi.fn(),
  };
  const collector = {
    getActivePage: vi.fn(async () => page),
  } as any;

  let handlers: GraphQLToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new GraphQLToolHandlers(collector);
  });

  it('returns error for invalid call-graph regex', async () => {
    const response = await handlers.handleCallGraphAnalyze({ filterPattern: '[' });
    const body = parseJson(response);
    expect(response.isError).toBe(true);
    expect(body.error).toContain('Invalid filterPattern regex');
  });

  it('validates required arguments for script_replace_persist', async () => {
    const response = await handlers.handleScriptReplacePersist({ replacement: 'x' });
    const body = parseJson(response);
    expect(response.isError).toBe(true);
    expect(body.error).toContain('Missing required argument: url');
  });

  it('validates regex mode url in script_replace_persist', async () => {
    const response = await handlers.handleScriptReplacePersist({
      url: '[',
      replacement: 'x',
      matchType: 'regex',
    });
    const body = parseJson(response);
    expect(response.isError).toBe(true);
    expect(body.error).toContain('Invalid regex');
  });

  it('registers script replacement rule and installs interception', async () => {
    const body = parseJson(
      await handlers.handleScriptReplacePersist({
        url: '/main.js',
        replacement: 'console.log(1)',
        matchType: 'contains',
      })
    );

    expect(body.success).toBe(true);
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
    const body = parseJson(response);
    expect(response.isError).toBe(true);
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

    const body = parseJson(
      await handlers.handleGraphqlReplay({
        endpoint: 'https://api.example.com/graphql',
        query: 'query Test { ok }',
        variables: { id: 1 },
      })
    );
    expect(body.success).toBe(true);
    expect(body.status).toBe(200);
    expect(body.responseHeaders['content-type']).toBe('application/json');
    expect(body.response).toEqual({ data: { ok: true } });
  });
});

