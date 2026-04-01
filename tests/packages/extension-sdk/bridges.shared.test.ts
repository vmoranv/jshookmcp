import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import {
  toTextResponse,
  toErrorResponse,
  parseStringArg,
  toDisplayPath,
  resolveOutputDirectory,
  checkExternalCommand,
  runProcess,
  assertLoopbackUrl,
  normalizeBaseUrl,
  buildUrl,
  requestJson,
} from '../../../packages/extension-sdk/src/bridges/shared';

// Mock child_process and fetch
vi.mock('node:child_process', () => ({
  execFile: vi.fn((cmd, args, opts, cb) => {
    // NodeJS promisify uses the callback
    if (cmd === 'node' && args[0] === '-v') {
      cb(null, { stdout: 'v20.0.0\n', stderr: '' });
    } else if (cmd === 'node-stderr') {
      cb(null, { stdout: '', stderr: 'v21.0.0\n' });
    } else if (cmd === 'node-empty') {
      cb(null, { stdout: '', stderr: '' });
    } else if (cmd === 'string-error') {
      cb('String error out');
    } else {
      cb(new Error('Command failed'));
    }
  }),
  spawn: vi.fn((cmd, _args, _opts) => {
    const EventEmitter = require('node:events');
    const child: any = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn((signal) => {
      // Simulate that kill forcefully closes the process
      setTimeout(() => child.emit('close', null, signal), 5);
    });

    // Simulate async execution
    setTimeout(() => {
      if (cmd === 'echo') {
        child.stdout.emit('data', Buffer.from('hello'));
        child.emit('close', 0, null);
      } else if (cmd === 'fail') {
        child.stderr.emit('data', Buffer.from('failed'));
        child.emit('close', 1, null);
      } else if (cmd === 'error') {
        child.emit('error', new Error('spawn failed'));
        // Emit close too to test 'settled'
        child.emit('close', 1, null);
      } else if (cmd === 'error-with-stderr') {
        child.stderr.emit('data', Buffer.from('existing err'));
        child.emit('error', new Error('spawn failed again'));
      } else if (cmd === 'hang') {
        // do nothing, wait for child.kill
      } else if (cmd === 'large') {
        child.stdout.emit('data', Buffer.from('a'.repeat(20)));
        child.stdout.emit('data', Buffer.from('c'.repeat(20)));
        child.stderr.emit('data', Buffer.from('b'.repeat(20)));
        child.stderr.emit('data', Buffer.from('d'.repeat(20)));
        child.emit('close', 0, null);
      }
    }, 10);
    return child;
  }),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    mkdir: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock fetch globally
const originalFetch = global.fetch;
beforeEach(() => {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    if (url.includes('json-endpoint')) {
      return {
        status: 200,
        text: async () => '{"data":"test"}',
      };
    }
    if (url.includes('text-endpoint')) {
      return {
        status: 500,
        text: async () => 'Internal Error',
      };
    }
    if (url.includes('empty-endpoint')) {
      return {
        status: 204,
        text: async () => '',
      };
    }
    throw new Error('Network error');
  });
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.clearAllMocks();
});

describe('bridges/shared', () => {
  describe('toTextResponse / toErrorResponse', () => {
    it('formats text response', () => {
      expect(toTextResponse({ a: 1 })).toEqual({
        content: [{ type: 'text', text: '{\n  "a": 1\n}' }],
      });
    });

    it('formats error response', () => {
      expect(toErrorResponse('myTool', new Error('Oops'), { b: 2 })).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: false, tool: 'myTool', error: 'Oops', b: 2 }, null, 2),
          },
        ],
      });
      expect(toErrorResponse('myTool', 'String error')).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { success: false, tool: 'myTool', error: 'String error' },
              null,
              2,
            ),
          },
        ],
      });
    });
  });

  describe('parseStringArg', () => {
    it('parses valid strings', () => {
      expect(parseStringArg({ a: ' test ' }, 'a')).toBe('test');
      expect(parseStringArg({ a: '   ' }, 'a')).toBeUndefined();
      expect(parseStringArg({ b: 123 }, 'b')).toBeUndefined();
    });

    it('throws if required', () => {
      expect(() => parseStringArg({}, 'c', true)).toThrow('c must be a non-empty string');
    });
  });

  describe('toDisplayPath', () => {
    it('returns . for current dir', () => {
      expect(toDisplayPath(process.cwd())).toBe('.');
    });

    it('returns absolute if outside cwd', () => {
      const outside = path.resolve(process.cwd(), '../outside').replace(/\\/g, '/');
      expect(toDisplayPath(outside)).toBe(outside);
    });

    it('returns relative if inside cwd', () => {
      const inside = path.resolve(process.cwd(), 'inside/file.txt');
      expect(toDisplayPath(inside)).toBe('inside/file.txt');
    });
  });

  describe('resolveOutputDirectory', async () => {
    it('uses requestedDir', async () => {
      const res = await resolveOutputDirectory('mytool', 'target', './my-dir');
      expect(res.absolutePath).toContain('my-dir');
    });

    it('generates path in artifacts dir', async () => {
      const res = await resolveOutputDirectory('mytool', 'target-name');
      expect(res.absolutePath).toContain('artifacts');
      expect(res.absolutePath).toContain('mytool');
      expect(res.absolutePath).toContain('target-name-');
    });
  });

  describe('checkExternalCommand', () => {
    it('returns success if available (stdout)', async () => {
      const res = await checkExternalCommand('node', ['-v'], 'Node');
      expect(JSON.parse(res.content[0].text)).toEqual({
        success: true,
        tool: 'Node',
        available: true,
        version: 'v20.0.0',
      });
    });

    it('returns success if available (stderr)', async () => {
      const res = await checkExternalCommand('node-stderr', ['-v'], 'NodeStderr');
      expect(JSON.parse(res.content[0].text)).toEqual({
        success: true,
        tool: 'NodeStderr',
        available: true,
        version: 'v21.0.0',
      });
    });

    it('returns success with empty version', async () => {
      const res = await checkExternalCommand('node-empty', ['-v'], 'NodeEmpty');
      expect(JSON.parse(res.content[0].text)).toEqual({
        success: true,
        tool: 'NodeEmpty',
        available: true,
        version: '',
      });
    });

    it('returns error if unavailable with exception', async () => {
      const res = await checkExternalCommand('missing', ['-v'], 'Missing', 'Install it');
      expect(JSON.parse(res.content[0].text)).toEqual({
        success: true,
        tool: 'Missing',
        available: false,
        reason: 'Command failed',
        installHint: 'Install it',
      });
    });

    it('returns error if unavailable with string error', async () => {
      const res = await checkExternalCommand('string-error', ['-v'], 'StringMissing');
      expect(JSON.parse(res.content[0].text)).toEqual({
        success: true,
        tool: 'StringMissing',
        available: false,
        reason: 'String error out',
      });
    });
  });

  describe('runProcess', () => {
    it('runs successfully', async () => {
      const res = await runProcess('echo', ['hello']);
      expect(res.ok).toBe(true);
      expect(res.stdout).toBe('hello');
      expect(res.exitCode).toBe(0);
    });

    it('handles stderr and exit code 1', async () => {
      const res = await runProcess('fail', []);
      expect(res.ok).toBe(false);
      expect(res.stderr).toBe('failed');
      expect(res.exitCode).toBe(1);
    });

    it('handles spawn error', async () => {
      const res = await runProcess('error', []);
      expect(res.ok).toBe(false);
      expect(res.stderr).toContain('spawn failed');
    });

    it('handles spawn error with existing stderr', async () => {
      const res = await runProcess('error-with-stderr', []);
      expect(res.ok).toBe(false);
      expect(res.stderr).toContain('existing err\nSpawn error: spawn failed again');
    });

    it('handles timeout', async () => {
      const res = await runProcess('hang', [], { timeoutMs: 50 });
      expect(res.ok).toBe(false);
      // Wait for process resolution
      await new Promise((r) => setTimeout(r, 60));
    });

    it('truncates large output', async () => {
      const res = await runProcess('large', [], { maxStdoutBytes: 5, maxStderrBytes: 5 });
      expect(res.stdout).toBe('aaaaa');
      expect(res.stderr).toBe('bbbbb');
      expect(res.truncated).toBe(true);
    });
  });

  describe('assertLoopbackUrl', () => {
    it('allows loopback', () => {
      expect(assertLoopbackUrl('http://127.0.0.1/')).toBe('http://127.0.0.1/');
      expect(assertLoopbackUrl('http://localhost:8080')).toBe('http://localhost:8080/');
      expect(assertLoopbackUrl('http://[::1]/')).toBe('http://[::1]/');
    });

    it('blocks non-loopback', () => {
      expect(() => assertLoopbackUrl('http://google.com')).toThrow();
      expect(() => assertLoopbackUrl('ftp://localhost')).toThrow();
      expect(() => assertLoopbackUrl('not-a-url')).toThrow();
    });
  });

  describe('normalizeBaseUrl', () => {
    it('normalizes base url', () => {
      expect(normalizeBaseUrl('http://localhost:8080/foo/bar')).toBe('http://localhost:8080');
    });
  });

  describe('buildUrl', () => {
    it('builds full URL', () => {
      expect(buildUrl('http://localhost', 'api/v1', { a: 1, b: '' })).toBe(
        'http://localhost/api/v1?a=1',
      );
      expect(buildUrl('http://localhost/', '/api/v1')).toBe('http://localhost/api/v1');
    });
  });

  describe('requestJson', () => {
    it('parses valid json', async () => {
      const res = await requestJson('http://json-endpoint', 'POST', { myBody: true });
      expect(global.fetch).toHaveBeenCalled();
      expect(res.status).toBe(200);
      expect(res.data).toEqual({ data: 'test' });
    });

    it('falls back on text', async () => {
      const res = await requestJson('http://text-endpoint');
      expect(res.status).toBe(500);
      expect(res.data).toEqual({ text: 'Internal Error' });
    });

    it('handles empty text', async () => {
      const res = await requestJson('http://empty-endpoint');
      expect(res.status).toBe(204);
      expect(res.data).toEqual({});
      expect(res.text).toBe('');
    });
  });
});
