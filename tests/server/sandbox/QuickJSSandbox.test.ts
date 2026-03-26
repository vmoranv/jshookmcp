import { describe, it, expect } from 'vitest';
import { QuickJSSandbox } from '@server/sandbox/QuickJSSandbox';

describe('QuickJSSandbox', () => {
  const sandbox = new QuickJSSandbox();

  it('executes simple JavaScript and returns result', async () => {
    const result = await sandbox.execute('1 + 2');
    expect(result.ok).toBe(true);
    expect(result.output).toBe(3);
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns string results', async () => {
    const result = await sandbox.execute('"hello" + " " + "world"');
    expect(result.ok).toBe(true);
    expect(result.output).toBe('hello world');
  });

  it('returns object results', async () => {
    const result = await sandbox.execute('({ a: 1, b: "two" })');
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ a: 1, b: 'two' });
  });

  it('enforces timeout and returns timedOut=true', async () => {
    const result = await sandbox.execute('while(true) {}', { timeoutMs: 50 });
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(40);
  });

  it('enforces memory limit and returns error', async () => {
    // Try to allocate way more memory than 256KB allows
    const result = await sandbox.execute(
      'var arr = []; for (var i = 0; i < 100000; i++) arr.push("x".repeat(1000)); arr.length',
      { memoryLimitBytes: 256 * 1024 },
    );
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(false);
  });

  it('captures console.log output in logs array', async () => {
    const result = await sandbox.execute('console.log("hello"); console.log("world"); 42');
    expect(result.ok).toBe(true);
    expect(result.output).toBe(42);
    expect(result.logs).toEqual(['hello', 'world']);
  });

  it('captures console.warn and console.error in logs', async () => {
    const result = await sandbox.execute('console.warn("w"); console.error("e"); true');
    expect(result.ok).toBe(true);
    expect(result.logs).toEqual(['w', 'e']);
  });

  it('isolates sandbox — no access to Node.js APIs', async () => {
    const result = await sandbox.execute('typeof require');
    expect(result.ok).toBe(true);
    expect(result.output).toBe('undefined');
  });

  it('isolates sandbox — no access to process', async () => {
    const result = await sandbox.execute('typeof process');
    expect(result.ok).toBe(true);
    expect(result.output).toBe('undefined');
  });

  it('handles syntax errors gracefully', async () => {
    const result = await sandbox.execute('function(');
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.timedOut).toBe(false);
  });

  it('handles runtime errors gracefully', async () => {
    const result = await sandbox.execute('undefinedVar.prop');
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.timedOut).toBe(false);
  });

  it('injects globals into sandbox scope', async () => {
    const result = await sandbox.execute('myValue + 10', {
      globals: { myValue: 32 },
    });
    expect(result.ok).toBe(true);
    expect(result.output).toBe(42);
  });

  it('injects complex globals (objects/arrays)', async () => {
    const result = await sandbox.execute('data.items.length', {
      globals: { data: { items: [1, 2, 3] } },
    });
    expect(result.ok).toBe(true);
    expect(result.output).toBe(3);
  });

  it('provides helpers.base64 in sandbox', async () => {
    const result = await sandbox.execute('helpers.base64.encode("hello")');
    expect(result.ok).toBe(true);
    expect(result.output).toBe('aGVsbG8=');
  });

  it('provides helpers.json.safeParse in sandbox', async () => {
    const result = await sandbox.execute('JSON.stringify(helpers.json.safeParse(\'{"a":1}\'))');
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.output as string);
    expect(parsed.ok).toBe(true);
    expect(parsed.value).toEqual({ a: 1 });
  });

  it('has no state leakage between calls', async () => {
    await sandbox.execute('var leaked = 42;');
    const result = await sandbox.execute('typeof leaked');
    expect(result.ok).toBe(true);
    expect(result.output).toBe('undefined');
  });
});
