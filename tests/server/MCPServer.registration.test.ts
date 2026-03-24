import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  logger: {
    info: vi.fn(),
  },
  getToolsForProfile: vi.fn(),
  getToolsByDomains: vi.fn(),
  parseToolDomains: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@utils/logger', () => ({
  logger: mocks.logger,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/ToolCatalog', () => ({
  getToolsForProfile: mocks.getToolsForProfile,
  getToolsByDomains: mocks.getToolsByDomains,
  parseToolDomains: mocks.parseToolDomains,
}));

import { resolveToolsForRegistration } from '@server/MCPServer.registration';

describe('MCPServer.registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    mocks.getToolsForProfile.mockReturnValue([{ name: 'browser_launch' }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    mocks.getToolsByDomains.mockReturnValue([{ name: 'network_enable' }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    mocks.parseToolDomains.mockReturnValue(null);
  });

  it('uses explicit domains when provided and falls back invalid profiles to search tier', () => {
    vi.stubEnv('MCP_TOOL_PROFILE', 'invalid');
    vi.stubEnv('MCP_TOOL_DOMAINS', 'browser,network');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    mocks.parseToolDomains.mockReturnValue(['browser', 'network']);

    const result = resolveToolsForRegistration();

    expect(result).toEqual({
      tools: [{ name: 'network_enable' }],
      profile: 'search',
    });
    expect(mocks.getToolsByDomains).toHaveBeenCalledWith(['browser', 'network']);
    expect(mocks.getToolsForProfile).not.toHaveBeenCalled();
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'Tool registration mode=domains [browser,network], count=1',
    );
  });

  it('keeps a valid explicit profile when domains are used', () => {
    vi.stubEnv('MCP_TOOL_PROFILE', 'full');
    vi.stubEnv('MCP_TOOL_DOMAINS', 'browser,network');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    mocks.parseToolDomains.mockReturnValue(['browser', 'network']);

    const result = resolveToolsForRegistration();

    expect(result.profile).toBe('full');
    expect(mocks.getToolsByDomains).toHaveBeenCalledWith(['browser', 'network']);
    expect(mocks.getToolsForProfile).not.toHaveBeenCalled();
  });

  it('respects an explicit valid profile when domains are not set', () => {
    vi.stubEnv('MCP_TRANSPORT', 'HTTP');
    vi.stubEnv('MCP_TOOL_PROFILE', 'workflow');

    const result = resolveToolsForRegistration();

    expect(result).toEqual({
      tools: [{ name: 'browser_launch' }],
      profile: 'workflow',
    });
    expect(mocks.getToolsForProfile).toHaveBeenCalledWith('workflow');
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'Tool registration mode=workflow, transport=http, count=1',
    );
  });

  it('defaults to the search profile when no valid override is present', () => {
    vi.stubEnv('MCP_TOOL_PROFILE', 'FULL ');

    const result = resolveToolsForRegistration();

    expect(result.profile).toBe('full');
    expect(mocks.getToolsForProfile).toHaveBeenCalledWith('full');
  });
});
