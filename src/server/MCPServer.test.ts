import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  return {
    mcpInstances: [] as any[],
    getToolsForProfile: vi.fn(),
    getToolsByDomains: vi.fn(),
    parseToolDomains: vi.fn(),
    getToolDomain: vi.fn(),
    getProfileDomains: vi.fn(),
    createToolHandlerMap: vi.fn(),
    tokenBudget: {
      recordToolCall: vi.fn(),
      setTrackingEnabled: vi.fn(),
    },
    cacheInit: vi.fn(async () => undefined),
    detailedShutdown: vi.fn(),
  };
});

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  class BaseMockMcpServer {
    public tools: Array<{ name: string; handler: (...args: any[]) => Promise<any> }> = [];
    public connect = vi.fn(async () => undefined);
    public close = vi.fn(async () => undefined);
    public sendToolListChanged = vi.fn(async () => undefined);

    tool(...args: any[]) {
      const name = args[0];
      const handler = args.at(-1);
      this.tools.push({ name, handler });
      return { remove: vi.fn() };
    }
  }

  return {
    McpServer: class extends BaseMockMcpServer {
      constructor(...args: any[]) {
        super(...args);
        mocks.mcpInstances.push(this);
      }
    },
  };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class StdioServerTransport {},
}));

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: class StreamableHTTPServerTransport {
    handleRequest = vi.fn();
  },
}));

vi.mock('../utils/cache.js', () => ({
  CacheManager: class CacheManager {
    init = mocks.cacheInit;
  },
}));

vi.mock('../utils/TokenBudgetManager.js', () => ({
  TokenBudgetManager: {
    getInstance: () => mocks.tokenBudget,
  },
}));

vi.mock('../utils/UnifiedCacheManager.js', () => ({
  UnifiedCacheManager: {
    getInstance: () => ({ registerCache: vi.fn() }),
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    setLevel: vi.fn(),
  },
}));

vi.mock('./ToolCatalog.js', () => ({
  getToolsForProfile: mocks.getToolsForProfile,
  getToolsByDomains: mocks.getToolsByDomains,
  parseToolDomains: mocks.parseToolDomains,
  getToolDomain: mocks.getToolDomain,
  getProfileDomains: mocks.getProfileDomains,
}));

vi.mock('./ToolHandlerMap.js', () => ({
  createToolHandlerMap: mocks.createToolHandlerMap,
}));

vi.mock('../utils/DetailedDataManager.js', () => ({
  DetailedDataManager: {
    getInstance: () => ({ shutdown: mocks.detailedShutdown }),
  },
}));

import { MCPServer } from './MCPServer.js';

describe('MCPServer', () => {
  const baseConfig = {
    llm: {
      provider: 'openai',
      openai: { apiKey: '', model: 'x' },
      anthropic: { apiKey: '', model: 'y' },
    },
    puppeteer: { headless: true, timeout: 1000 },
    mcp: { name: 'test-server', version: '1.0.0' },
    cache: { enabled: true, dir: '.cache', ttl: 60 },
    performance: { maxConcurrentAnalysis: 1, maxCodeSizeMB: 1 },
  } as any;

  beforeEach(() => {
    mocks.mcpInstances.length = 0;
    vi.clearAllMocks();

    process.env.MCP_TRANSPORT = 'stdio';
    delete process.env.MCP_TOOL_PROFILE;
    delete process.env.MCP_TOOL_DOMAINS;

    mocks.parseToolDomains.mockImplementation((raw?: string) => (raw ? ['browser'] : null));
    mocks.getToolsForProfile.mockReturnValue([
      { name: 'tool_alpha', description: 'alpha', inputSchema: { properties: { x: {} } } },
      { name: 'tool_beta', description: 'beta', inputSchema: {} },
    ]);
    mocks.getToolsByDomains.mockReturnValue([
      { name: 'domain_tool', description: 'domain', inputSchema: {} },
    ]);
    mocks.getToolDomain.mockReturnValue('browser');
    mocks.getProfileDomains.mockReturnValue(['browser']);
    mocks.createToolHandlerMap.mockReturnValue({
      tool_alpha: vi.fn(async (args: unknown) => ({
        content: [{ type: 'text', text: `alpha:${JSON.stringify(args)}` }],
      })),
      tool_beta: vi.fn(async () => ({ content: [{ type: 'text', text: 'beta' }] })),
      domain_tool: vi.fn(async () => ({ content: [{ type: 'text', text: 'domain' }] })),
    });
  });

  afterEach(() => {
    delete process.env.MCP_TRANSPORT;
    delete process.env.MCP_TOOL_PROFILE;
    delete process.env.MCP_TOOL_DOMAINS;
  });

  it('registers selected tools plus meta tools on construction', () => {
    new MCPServer(baseConfig);
    const mcp = mocks.mcpInstances[0];
    const names = mcp.tools.map((t: { name: string }) => t.name);

    expect(names).toContain('tool_alpha');
    expect(names).toContain('tool_beta');
    expect(names).toContain('boost_profile');
    expect(names).toContain('unboost_profile');
  });

  it('resolves tool profile from environment when explicitly provided', () => {
    process.env.MCP_TOOL_PROFILE = 'full';
    new MCPServer(baseConfig);
    expect(mocks.getToolsForProfile).toHaveBeenCalledWith('full');
  });

  it('starts with stdio transport by default and initializes cache', async () => {
    const server = new MCPServer(baseConfig);
    await server.start();

    const mcp = mocks.mcpInstances[0];
    expect(mocks.cacheInit).toHaveBeenCalledOnce();
    expect(mcp.connect).toHaveBeenCalledOnce();
  });

  it('enterDegradedMode disables tracking only once', () => {
    const server = new MCPServer(baseConfig);

    server.enterDegradedMode('first issue');
    server.enterDegradedMode('second issue');

    expect(mocks.tokenBudget.setTrackingEnabled).toHaveBeenCalledTimes(1);
    expect(mocks.tokenBudget.setTrackingEnabled).toHaveBeenCalledWith(false);
  });

  it('registered tool execution records token usage', async () => {
    new MCPServer(baseConfig);
    const mcp = mocks.mcpInstances[0];
    const alpha = mcp.tools.find((t: { name: string }) => t.name === 'tool_alpha');

    const response = await alpha.handler({ x: 7 });
    expect(response.content[0].text).toContain('alpha');
    expect(mocks.tokenBudget.recordToolCall).toHaveBeenCalledWith('tool_alpha', { x: 7 }, response);
  });

  it('close shuts down detailed manager and mcp server', async () => {
    const server = new MCPServer(baseConfig);
    await server.close();
    const mcp = mocks.mcpInstances[0];

    expect(mocks.detailedShutdown).toHaveBeenCalledOnce();
    expect(mcp.close).toHaveBeenCalledOnce();
  });
});

