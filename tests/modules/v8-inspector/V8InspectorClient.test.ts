import { describe, expect, it, vi } from 'vitest';
import { V8InspectorClient } from '../../../src/modules/v8-inspector/V8InspectorClient';

type SessionSendHandler = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

function createSession(sendHandler: SessionSendHandler) {
  return {
    send: vi.fn(sendHandler),
    on: vi.fn(),
    off: vi.fn(),
    detach: vi.fn().mockResolvedValue(undefined),
  };
}

function createClient(sendHandler: SessionSendHandler) {
  const session = createSession(sendHandler);
  const page = {
    createCDPSession: vi.fn().mockResolvedValue(session),
  };
  const getPage = vi.fn().mockResolvedValue(page);
  const client = new V8InspectorClient(getPage);
  return { client, getPage, page, session };
}

describe('V8InspectorClient.getHeapUsage', () => {
  it('uses Runtime.getHeapUsage when available and fills limit from performance.memory', async () => {
    const { client } = createClient(async (method) => {
      if (method === 'HeapProfiler.enable') {
        return {};
      }
      if (method === 'Runtime.getHeapUsage') {
        return { usedSize: 128, totalSize: 256 };
      }
      if (method === 'Runtime.evaluate') {
        return {
          result: {
            value: {
              jsHeapSizeUsed: 128,
              jsHeapSizeTotal: 256,
              jsHeapSizeLimit: 512,
            },
          },
        };
      }
      throw new Error(`Unexpected method ${method}`);
    });

    await expect(client.getHeapUsage()).resolves.toEqual({
      jsHeapSizeUsed: 128,
      jsHeapSizeTotal: 256,
      jsHeapSizeLimit: 512,
    });
  });

  it('falls back to Performance.getMetrics when Runtime.getHeapUsage is unavailable', async () => {
    const { client } = createClient(async (method) => {
      if (method === 'HeapProfiler.enable') {
        return {};
      }
      if (method === 'Runtime.getHeapUsage' || method === 'HeapProfiler.getHeapUsage') {
        throw new Error(`${method} unavailable`);
      }
      if (method === 'Performance.getMetrics') {
        return {
          metrics: [
            { name: 'JSHeapUsedSize', value: 321 },
            { name: 'JSHeapTotalSize', value: 654 },
          ],
        };
      }
      if (method === 'Runtime.evaluate') {
        return {
          result: {
            value: {
              jsHeapSizeLimit: 999,
            },
          },
        };
      }
      throw new Error(`Unexpected method ${method}`);
    });

    await expect(client.getHeapUsage()).resolves.toEqual({
      jsHeapSizeUsed: 321,
      jsHeapSizeTotal: 654,
      jsHeapSizeLimit: 999,
    });
  });

  it('parses nested Runtime.evaluate values when other heap usage probes fail', async () => {
    const { client } = createClient(async (method) => {
      if (method === 'HeapProfiler.enable') {
        return {};
      }
      if (
        method === 'Runtime.getHeapUsage' ||
        method === 'HeapProfiler.getHeapUsage' ||
        method === 'Performance.getMetrics'
      ) {
        throw new Error(`${method} unavailable`);
      }
      if (method === 'Runtime.evaluate') {
        return {
          result: {
            value: {
              jsHeapSizeUsed: 11,
              jsHeapSizeTotal: 22,
              jsHeapSizeLimit: 33,
            },
          },
        };
      }
      throw new Error(`Unexpected method ${method}`);
    });

    await expect(client.getHeapUsage()).resolves.toEqual({
      jsHeapSizeUsed: 11,
      jsHeapSizeTotal: 22,
      jsHeapSizeLimit: 33,
    });
  });

  it('throws when no heap usage metrics are available', async () => {
    const { client } = createClient(async (method) => {
      if (method === 'HeapProfiler.enable') {
        return {};
      }
      if (
        method === 'Runtime.getHeapUsage' ||
        method === 'HeapProfiler.getHeapUsage' ||
        method === 'Performance.getMetrics' ||
        method === 'Runtime.evaluate'
      ) {
        throw new Error(`${method} unavailable`);
      }
      throw new Error(`Unexpected method ${method}`);
    });

    await expect(client.getHeapUsage()).rejects.toThrow(
      'V8InspectorClient: heap usage metrics unavailable',
    );
  });
});

describe('V8InspectorClient.getObjectByObjectId', () => {
  it('inspects runtime object ids via Runtime.getProperties', async () => {
    const { client, session } = createClient(async (method) => {
      if (method === 'Runtime.getProperties') {
        return {
          result: [
            { name: 'marker', value: { type: 'string', value: 'runtime-audit' } },
            { name: 'count', value: { type: 'number', value: 2 } },
          ],
          internalProperties: [{ name: '[[Prototype]]', value: { type: 'object' } }],
        };
      }
      throw new Error(`Unexpected method ${method}`);
    });

    await expect(client.getObjectByObjectId('runtime-object-id')).resolves.toEqual({
      kind: 'runtime-object',
      properties: [
        { name: 'marker', value: { type: 'string', value: 'runtime-audit' } },
        { name: 'count', value: { type: 'number', value: 2 } },
      ],
      internalProperties: [{ name: '[[Prototype]]', value: { type: 'object' } }],
      privateProperties: [],
    });
    expect(session.send).toHaveBeenCalledWith('Runtime.getProperties', {
      objectId: 'runtime-object-id',
      ownProperties: true,
      accessorPropertiesOnly: false,
      generatePreview: true,
    });
  });

  it('falls back to HeapProfiler.getObjectByHeapObjectId when runtime inspection fails', async () => {
    const { client, session } = createClient(async (method) => {
      if (method === 'Runtime.getProperties') {
        throw new Error('not a runtime object id');
      }
      if (method === 'HeapProfiler.getObjectByHeapObjectId') {
        return { result: { type: 'object', description: 'HeapObject' } };
      }
      throw new Error(`Unexpected method ${method}`);
    });

    await expect(client.getObjectByObjectId('1:42')).resolves.toEqual({
      result: { type: 'object', description: 'HeapObject' },
    });
    expect(session.send).toHaveBeenCalledWith('HeapProfiler.getObjectByHeapObjectId', {
      objectId: '1:42',
    });
  });
});
