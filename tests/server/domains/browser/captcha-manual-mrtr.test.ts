import { describe, expect, it, vi } from 'vitest';
import { handleCaptchaVisionSolve } from '@server/domains/browser/handlers/captcha-solver';
import { ElicitationBridge } from '@server/ElicitationBridge';
import { R } from '@server/domains/shared/ResponseBuilder';
import { buildTestUrl } from '@tests/shared/test-urls';
import type { CodeCollector } from '@server/domains/shared/modules/collector';
import type { McpServer } from '@modelcontextprotocol/server';

function parse(res: Parameters<typeof R.parse>[0]): Record<string, unknown> {
  return R.parse<Record<string, unknown>>(res);
}

function makeCollector(pageUrl: string): CodeCollector {
  return {
    getActivePage: vi.fn(async () => ({ url: () => pageUrl })),
  } as unknown as CodeCollector;
}

function makeBridge(elicitationSupported: boolean, elicitResult?: unknown): ElicitationBridge {
  const mcpServer = {
    server: {
      getClientCapabilities: vi.fn(() => ({
        elicitation: elicitationSupported ? {} : undefined,
      })),
      elicitInput: vi.fn(async () => elicitResult ?? { action: 'accept', content: {} }),
    },
  } as unknown as McpServer;
  return new ElicitationBridge(mcpServer);
}

describe('handleCaptchaVisionSolve — manual mode MRTR linkage (plan Task 3.2)', () => {
  it('suspends with InputRequiredResult when the client cannot elicit inline', async () => {
    const bridge = makeBridge(false);
    const res = parse(
      await handleCaptchaVisionSolve(
        { mode: 'manual', challengeType: 'widget', siteKey: 'sk-1' },
        makeCollector(buildTestUrl('protected', { path: '/login' })),
        bridge,
      ),
    );

    expect(res.success).toBe(true);
    expect(res.resultType).toBe('input_required');
    expect(Array.isArray(res.inputRequests)).toBe(true);
    expect(typeof res.requestState).toBe('string');
    expect(String(res.instruction)).toContain('resumeToken');

    // The encrypted state carries the challenge context for the resuming call.
    const decoded = bridge.resumeFromState<{ challengeType?: string; pageUrl?: string }>(
      res.requestState as string,
      'captcha_manual',
    );
    expect(decoded?.state.data.challengeType).toBe('widget');
    expect(decoded?.state.data.pageUrl).toBe(buildTestUrl('protected', { path: '/login' }));
  });

  it('resumes a suspension when called back with a valid resumeToken', async () => {
    const bridge = makeBridge(false);
    const suspended = parse(
      await handleCaptchaVisionSolve(
        { mode: 'manual', challengeType: 'widget' },
        makeCollector(buildTestUrl('protected', { path: '/login' })),
        bridge,
      ),
    );

    const resumed = parse(
      await handleCaptchaVisionSolve(
        {
          mode: 'manual',
          resumeToken: suspended.requestState,
          resumeResponses: { solved: true, token: 'cf-turnstile-response' },
        },
        makeCollector(buildTestUrl('protected', { path: '/login' })),
        bridge,
      ),
    );

    expect(resumed.success).toBe(true);
    expect(resumed.resumed).toBe(true);
    expect(resumed.solved).toBe(true);
    expect(resumed.token).toBe('cf-turnstile-response');
  });

  it('rejects resumption when the user reports the CAPTCHA unsolved', async () => {
    const bridge = makeBridge(false);
    const suspended = parse(
      await handleCaptchaVisionSolve(
        { mode: 'manual' },
        makeCollector(buildTestUrl('protected', { path: '/login' })),
        bridge,
      ),
    );

    const resumed = parse(
      await handleCaptchaVisionSolve(
        {
          mode: 'manual',
          resumeToken: suspended.requestState,
          resumeResponses: { solved: false },
        },
        makeCollector(buildTestUrl('protected', { path: '/login' })),
        bridge,
      ),
    );

    expect(resumed.success).toBe(false);
  });

  it('refuses invalid or foreign-kind resumeTokens', async () => {
    const bridge = makeBridge(false);
    const res = parse(
      await handleCaptchaVisionSolve(
        { mode: 'manual', resumeToken: 'v1.tampered.token.here' },
        makeCollector(buildTestUrl('protected', { path: '/login' })),
        bridge,
      ),
    );
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('resumeToken');
  });

  it('uses inline elicitation when the client supports it and resumes with user responses', async () => {
    const bridge = makeBridge(true, {
      action: 'accept',
      content: { solved: true, token: 'inline-token' },
    });
    const res = parse(
      await handleCaptchaVisionSolve(
        { mode: 'manual', challengeType: 'image' },
        makeCollector(buildTestUrl('protected', { path: '/login' })),
        bridge,
      ),
    );

    expect(res.success).toBe(true);
    expect(res.resumed).toBe(true);
    expect(res.token).toBe('inline-token');
    expect(res.resultType).toBeUndefined();
  });

  it('keeps the legacy manual response when no elicitation bridge is available', async () => {
    const res = parse(
      await handleCaptchaVisionSolve(
        { mode: 'manual', challengeType: 'image' },
        makeCollector(buildTestUrl('protected', { path: '/login' })),
      ),
    );

    expect(res.success).toBe(true);
    expect(res.mode).toBe('manual');
    expect(res.instruction).toContain('manually');
    expect(res.resultType).toBeUndefined();
  });
});
