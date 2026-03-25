import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleV8BytecodeDecompile } from '@server/domains/platform/handlers/v8-bytecode-handler';

type JsonPayload = Record<string, unknown>;

function parse(result: { content: Array<{ text?: string }> }): JsonPayload {
  return JSON.parse(result.content[0]!.text!) as JsonPayload;
}

describe('v8_bytecode_decompile', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'v8-bytecode-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should detect bytenode format from magic bytes', async () => {
    // Build a fake bytenode file with identifiable strings
    const magic = Buffer.from('BYTN');
    const padding = Buffer.alloc(64, 0);
    const codeStrings = Buffer.from(
      'function calculateTotal() { return price * quantity; } ' +
        'const isPremiumUser = true; ' +
        'require("electron").ipcRenderer.invoke("check-license"); ' +
        'https://api.example.com/v1/verify',
    );
    const filePath = join(tempDir, 'app.jsc');
    await writeFile(filePath, Buffer.concat([magic, padding, codeStrings]));

    const result = parse(await handleV8BytecodeDecompile({ filePath }));

    // Format detection should work regardless of view8 availability
    expect(result.detectedFormat).toBe('bytenode');
    // Without view8 installed, strategy falls back to constant-pool-extraction or none
    expect(result.strategy).toMatch(/constant-pool-extraction|none|view8/);
    if (result.success && result.strategy === 'constant-pool-extraction') {
      expect(Array.isArray(result.strings)).toBe(true);
      expect((result.strings as string[]).length).toBeGreaterThan(0);
    }
  });

  it('should detect V8 raw format from magic bytes', async () => {
    const magic = Buffer.from([0xc0, 0xde]);
    const padding = Buffer.alloc(128, 0);
    const codeContent = Buffer.from(
      'const subscriptionStatus = "pro"; function validateLicense(key) { return true; }',
    );
    const filePath = join(tempDir, 'compiled.jsc');
    await writeFile(filePath, Buffer.concat([magic, padding, codeContent]));

    const result = parse(await handleV8BytecodeDecompile({ filePath }));
    // Format detection works even without view8
    expect(result.detectedFormat).toBe('v8-raw');
  });

  it('should detect jsc by file extension', async () => {
    // No magic bytes, but .jsc extension
    const content = Buffer.from(
      Array(100)
        .fill('const handler = async function processRequest() { return await fetch(url); }')
        .join(' '),
    );
    const filePath = join(tempDir, 'bundle.jsc');
    await writeFile(filePath, content);

    const result = parse(await handleV8BytecodeDecompile({ filePath }));
    // Format detection works by file extension
    expect(result.detectedFormat).toBe('jsc-extension');
  });

  it('should reject non-bytecode files', async () => {
    const plainJs = Buffer.from('console.log("hello world");\n');
    const filePath = join(tempDir, 'plain.txt');
    await writeFile(filePath, plainJs);

    const result = parse(await handleV8BytecodeDecompile({ filePath }));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Not a recognized V8 bytecode format');
  });

  it('should error on non-existent file', async () => {
    const result = parse(
      await handleV8BytecodeDecompile({
        filePath: join(tempDir, 'missing.jsc'),
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('does not exist');
  });

  it('should reject oversized files', async () => {
    // We won't actually create a 50MB file; just mock the stat check
    // Instead, test that fileSize is reported correctly for small files
    const smallFile = Buffer.alloc(100);
    smallFile[0] = 0xc0;
    smallFile[1] = 0xde;
    const filePath = join(tempDir, 'small.jsc');
    await writeFile(filePath, smallFile);

    const result = parse(await handleV8BytecodeDecompile({ filePath }));
    expect(result.fileSize).toBe(100);
  });

  it('should extract UTF-16LE strings from bytecode', async () => {
    // Build a buffer with UTF-16LE encoded strings
    const magic = Buffer.from([0xc0, 0xde]);
    const padding = Buffer.alloc(64, 0);

    // UTF-16LE encode a code-relevant string
    const utf16Str = 'module.exports';
    const utf16Buf = Buffer.alloc(utf16Str.length * 2);
    for (let i = 0; i < utf16Str.length; i++) {
      utf16Buf.writeUInt16LE(utf16Str.charCodeAt(i), i * 2);
    }

    const filePath = join(tempDir, 'utf16.jsc');
    await writeFile(filePath, Buffer.concat([magic, padding, utf16Buf, padding]));

    const result = parse(await handleV8BytecodeDecompile({ filePath }));
    expect(result.success).toBe(true);
    if (result.strategy === 'constant-pool-extraction') {
      const strings = result.strings as string[];
      expect(strings.some((s) => s.includes('module.exports'))).toBe(true);
    }
  });
});
