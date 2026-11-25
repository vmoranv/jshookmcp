/**
 * Regression tests: ObfuscationMapLocator must close the yauzl archive before
 * settling on both the success and failure paths.
 */
import { Readable } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const zipState = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock('yauzl', () => ({ open: zipState.open }));

import { locateObfuscationMap } from '@modules/dart-inspector/ObfuscationMapLocator';

interface FakeZip {
  handlers: Map<string, (arg?: unknown) => void>;
  close: ReturnType<typeof vi.fn>;
  readEntry: ReturnType<typeof vi.fn>;
  openReadStream: ReturnType<typeof vi.fn>;
}

function makeFakeZip(opts: {
  entryName: string;
  onOpenRead: (cb: (err: Error | null, stream?: Readable) => void) => void;
}): FakeZip {
  const handlers = new Map<string, (arg?: unknown) => void>();
  const zip: FakeZip = {
    handlers,
    close: vi.fn(),
    readEntry: vi.fn(),
    openReadStream: vi.fn((_entry: unknown, cb: (err: Error | null, stream?: Readable) => void) =>
      opts.onOpenRead(cb),
    ),
  };
  zip.readEntry.mockImplementation(() => {
    const handler = handlers.get('entry');
    if (handler) handler({ fileName: opts.entryName });
  });
  const on = vi.fn((event: string, handler: (arg?: unknown) => void) => {
    handlers.set(event, handler);
    return zip;
  });
  (zip as unknown as { on: typeof on }).on = on;
  return zip;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ObfuscationMapLocator — zip fd lifecycle', () => {
  it('closes the archive before resolving on the success path', async () => {
    const zip = makeFakeZip({
      entryName: 'assets/flutter_assets/obfuscation.json',
      onOpenRead: (cb) => cb(null, Readable.from([Buffer.from('{"a":"b"}')])),
    });
    zipState.open.mockImplementation(
      (_path: string, _opts: unknown, cb: (err: Error | null, z: FakeZip) => void) => cb(null, zip),
    );

    const result = await locateObfuscationMap({ apkPath: 'test.apk' });
    expect(result).not.toBeNull();
    expect(result?.source).toContain('obfuscation.json');
    expect(zip.close).toHaveBeenCalledTimes(1);
  });

  it('closes the archive before rejecting when the entry stream cannot be opened', async () => {
    const zip = makeFakeZip({
      entryName: 'obfuscation.json',
      onOpenRead: (cb) => cb(new Error('stream failed')),
    });
    zipState.open.mockImplementation(
      (_path: string, _opts: unknown, cb: (err: Error | null, z: FakeZip) => void) => cb(null, zip),
    );

    await expect(locateObfuscationMap({ apkPath: 'test.apk' })).rejects.toMatchObject({
      name: 'ToolError',
      code: 'RUNTIME',
    });
    expect(zip.close).toHaveBeenCalledTimes(1);
  });
});
