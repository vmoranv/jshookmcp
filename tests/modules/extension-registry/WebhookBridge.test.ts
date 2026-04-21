import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebhookBridge } from '@modules/extension-registry/WebhookBridge';

describe('WebhookBridge', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'jshook-webhook-'));
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it('registers webhooks, de-duplicates events, and persists them to disk', async () => {
    const bridge = new WebhookBridge(tempDir);

    const id = await bridge.registerWebhook('https://example.com/hook', [
      'event:a',
      'event:a',
      '  ',
      '*',
    ]);

    const stored = bridge.listWebhooks();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id,
      url: 'https://example.com/hook',
      active: true,
      events: ['event:a', '*'],
    });

    const disk = JSON.parse(await readFile(path.join(tempDir, 'webhooks.json'), 'utf8')) as Array<{
      id: string;
      url: string;
      events: string[];
      active: boolean;
    }>;
    expect(disk[0]).toMatchObject({
      id,
      url: 'https://example.com/hook',
      active: true,
      events: ['event:a', '*'],
    });
  });

  it('loads valid webhook records from disk and ignores malformed entries', async () => {
    await writeFile(
      path.join(tempDir, 'webhooks.json'),
      JSON.stringify([
        { id: 'a', url: 'https://valid.example/hook', events: ['build'], active: true },
        { id: 'b', url: 123, events: ['bad'], active: true },
        null,
      ]),
      'utf8',
    );

    const bridge = new WebhookBridge(tempDir);

    expect(bridge.listWebhooks()).toEqual([
      {
        id: 'a',
        url: 'https://valid.example/hook',
        events: ['build'],
        active: true,
      },
    ]);
  });

  it('sends events only to matching active webhooks and supports wildcard subscriptions', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    vi.stubGlobal('fetch', fetchMock);

    const bridge = new WebhookBridge(tempDir);
    await bridge.registerWebhook('https://match.example/hook', ['build']);
    await bridge.registerWebhook('https://wildcard.example/hook', ['*']);
    await bridge.registerWebhook('https://skip.example/hook', ['deploy']);

    await bridge.sendEvent('build', { ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const calledUrls = fetchMock.mock.calls.map((call) => call[0]);
    expect(calledUrls).toEqual(
      expect.arrayContaining(['https://match.example/hook', 'https://wildcard.example/hook']),
    );
    expect(calledUrls).not.toContain('https://skip.example/hook');

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(requestInit.body)) as {
      event: string;
      payload: { ok: boolean };
      timestamp: string;
    };
    expect(payload.event).toBe('build');
    expect(payload.payload).toEqual({ ok: true });
    expect(typeof payload.timestamp).toBe('string');
  });

  it('throws when a webhook delivery returns a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
    });
    vi.stubGlobal('fetch', fetchMock);

    const bridge = new WebhookBridge(tempDir);
    await bridge.registerWebhook('https://broken.example/hook', ['build']);

    await expect(bridge.sendEvent('build', { ok: false })).rejects.toThrow(
      'Webhook delivery failed for https://broken.example/hook: 502 Bad Gateway',
    );
  });

  it('registers and updates external callbacks by endpoint id', () => {
    const bridge = new WebhookBridge(tempDir);

    bridge.registerExternalCallback('endpoint-1', 'https://initial.example/hook');
    expect(bridge.listWebhooks()).toEqual([
      {
        id: 'endpoint-1',
        url: 'https://initial.example/hook',
        events: ['*'],
        active: true,
      },
    ]);

    bridge.registerExternalCallback('endpoint-1', 'https://updated.example/hook');
    expect(bridge.listWebhooks()).toEqual([
      {
        id: 'endpoint-1',
        url: 'https://updated.example/hook',
        events: ['*'],
        active: true,
      },
    ]);
  });
});
