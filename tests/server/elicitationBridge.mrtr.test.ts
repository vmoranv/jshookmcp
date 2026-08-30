import { describe, expect, it, vi } from 'vitest';
import { ElicitationBridge } from '@server/ElicitationBridge';
import { R } from '@server/domains/shared/ResponseBuilder';
import { buildTestUrl } from '@tests/shared/test-urls';
import type { McpServer } from '@modelcontextprotocol/server';

function makeBridge(opts: { elicitationSupported?: boolean; elicitResult?: unknown } = {}) {
  const mcpServer = {
    server: {
      getClientCapabilities: vi.fn(() => ({
        elicitation: opts.elicitationSupported ? {} : undefined,
      })),
      elicitInput: vi.fn(async () => opts.elicitResult ?? { action: 'accept', content: {} }),
    },
  } as unknown as McpServer;
  return { bridge: new ElicitationBridge(mcpServer), mcpServer };
}

describe('ElicitationBridge — MRTR (InputRequiredResult) support', () => {
  it('requestState round-trips the payload intact', () => {
    const { bridge } = makeBridge();
    const token = bridge.createRequestState(
      { tool: 'captcha_vision_solve', pageUrl: buildTestUrl('x') },
      { kind: 'captcha_manual', ttlMs: 60_000 },
    );
    expect(token).toMatch(/^v1\./);

    const decoded = bridge.readRequestState<{ tool: string; pageUrl: string }>(token);
    expect(decoded?.kind).toBe('captcha_manual');
    expect(decoded?.data.tool).toBe('captcha_vision_solve');
    expect(decoded?.data.pageUrl).toBe(buildTestUrl('x'));
  });

  it('requestState rejects tampered ciphertext and wrong version prefixes', () => {
    const { bridge } = makeBridge();
    const token = bridge.createRequestState({ a: 1 });
    const [version, iv, tag, ct] = token.split('.');
    expect(version).toBe('v1');

    const flipped = Buffer.from(ct!, 'base64url');
    flipped[0] = flipped[0]! ^ 0xff;
    const tampered = [version, iv, tag, flipped.toString('base64url')].join('.');
    expect(bridge.readRequestState(tampered)).toBeNull();
    expect(bridge.readRequestState('bogus-token')).toBeNull();
    expect(bridge.readRequestState('v2.aaa.bbb.ccc')).toBeNull();
  });

  it('expired requestState tokens are refused', () => {
    const { bridge } = makeBridge();
    const token = bridge.createRequestState({ a: 1 }, { ttlMs: -1 });
    expect(bridge.readRequestState(token)).toBeNull();
  });

  it('buildInputRequiredSuspension packages resultType/inputRequests/requestState', () => {
    const { bridge } = makeBridge();
    const suspension = bridge.buildInputRequiredSuspension(
      {
        message: 'Solve the CAPTCHA',
        requestedSchema: {
          type: 'object',
          properties: { solved: { type: 'boolean' } },
          required: ['solved'],
        },
      },
      { challengeType: 'widget' },
      { kind: 'captcha_manual', instruction: 'resume later' },
    );

    expect(suspension.resultType).toBe('input_required');
    expect(suspension.inputRequests).toHaveLength(1);
    expect(suspension.inputRequests[0]?.type).toBe('form');
    expect(suspension.instruction).toBe('resume later');

    // The embedded state must decode back to the same form + context.
    const decoded = bridge.resumeFromState<{ challengeType?: string }>(
      suspension.requestState,
      'captcha_manual',
    );
    expect(decoded?.formParams.message).toBe('Solve the CAPTCHA');
    expect(decoded?.state.data.challengeType).toBe('widget');
  });

  it('resumeFromState refuses tokens of a different kind', () => {
    const { bridge } = makeBridge();
    const token = bridge.createRequestState(
      { formParams: { message: 'x', requestedSchema: { type: 'object', properties: {} } } },
      { kind: 'other_flow' },
    );
    expect(bridge.resumeFromState(token, 'captcha_manual')).toBeNull();
  });

  it('requestInputAndAwait resumes the executor on accept (elicitation-capable client)', async () => {
    const { bridge } = makeBridge({
      elicitationSupported: true,
      elicitResult: { action: 'accept', content: { solved: true, token: 'T-1' } },
    });

    const response = await bridge.requestInputAndAwait(
      { message: 'go', requestedSchema: { type: 'object', properties: {} } },
      async (responses) => R.ok().set('token', responses.token).json(),
      { stateKind: 'captcha_manual' },
    );

    const parsed = R.parse<Record<string, unknown>>(response);
    expect(parsed.success).toBe(true);
    expect(parsed.token).toBe('T-1');
  });

  it('requestInputAndAwait fails cleanly on decline/dismiss', async () => {
    const { bridge } = makeBridge({
      elicitationSupported: true,
      elicitResult: { action: 'decline' },
    });

    const response = await bridge.requestInputAndAwait(
      { message: 'go', requestedSchema: { type: 'object', properties: {} } },
      async () => R.ok().json(),
    );

    const parsed = R.parse<Record<string, unknown>>(response);
    expect(parsed.success).toBe(false);
    expect(parsed.inputResult).toBe('decline');
  });

  it('requestInputAndAwait suspends with InputRequiredResult when the client cannot elicit', async () => {
    const { bridge } = makeBridge({ elicitationSupported: false });

    const response = await bridge.requestInputAndAwait(
      { message: 'go', requestedSchema: { type: 'object', properties: {} } },
      async () => R.ok().json(),
      { stateKind: 'captcha_manual', instruction: 'resume with resumeToken' },
    );

    expect(bridge.isInputRequiredSuspension(response)).toBe(true);
    const parsed = R.parse<Record<string, unknown>>(response);
    expect(parsed.resultType).toBe('input_required');
    expect(Array.isArray(parsed.inputRequests)).toBe(true);
    expect(typeof parsed.requestState).toBe('string');
    // The executor must NOT have run during suspension.
    expect(parsed.success).toBe(true);
  });

  it('suspension → resume round-trip works end to end', async () => {
    const { bridge } = makeBridge({ elicitationSupported: false });

    const suspended = await bridge.requestInputAndAwait(
      { message: 'solve it', requestedSchema: { type: 'object', properties: {} } },
      async () => R.ok().json(),
      { stateKind: 'captcha_manual' },
    );
    const parsed = R.parse<{ requestState: string }>(suspended);

    const decoded = bridge.resumeFromState(parsed.requestState, 'captcha_manual');
    expect(decoded).not.toBeNull();
    expect(decoded!.formParams.message).toBe('solve it');
  });
});
