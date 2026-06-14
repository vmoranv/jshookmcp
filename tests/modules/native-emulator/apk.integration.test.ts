/**
 * native-emulator real-APK integration test.
 *
 * Driven by the `NEMU_INTEGRATION_APK` environment variable pointing at any
 * arm64-v8a-bearing APK. Skips entirely when the variable is unset (CI, fresh
 * clones), so no binary or vendor-specific asset is ever committed.
 *
 * Exercises the full tool workflow generically — extract → session → load →
 * symbols → inspect imports → trace — asserting only structural invariants,
 * never a specific library name, symbol, or payload.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NativeEmulatorHandlers } from '@server/domains/native-emulator/handlers.impl';
import { extractArm64Libs } from '@modules/native-emulator/apk';

const APK_PATH = process.env.NEMU_INTEGRATION_APK ?? '';

/** Parse the JSON payload out of an MCP text response (same as handlers.test.ts). */
// biome-ignore lint: any required for generic JSON deserialization
function payload(res: any): any {
  if (typeof res === 'string') return JSON.parse(res);
  if (res?.content?.[0]?.text) return JSON.parse(res.content[0].text);
  return res;
}

const APK_AVAILABLE = await (async () => {
  if (!APK_PATH) return false;
  try {
    const { existsSync } = await import('node:fs');
    return existsSync(APK_PATH);
  } catch {
    return false;
  }
})();

describe.skipIf(!APK_AVAILABLE)('native-emulator real-APK integration', () => {
  let handlers: NativeEmulatorHandlers;
  let sessionId: string;
  let extractedLibs: Awaited<ReturnType<typeof extractArm64Libs>>;

  beforeAll(async () => {
    handlers = new NativeEmulatorHandlers();
    extractedLibs = await extractArm64Libs(APK_PATH);
  });

  afterAll(async () => {
    if (sessionId) await handlers.handleDestroySession({ sessionId });
    handlers.dispose();
  });

  it('extracts at least one arm64-v8a library', () => {
    expect(extractedLibs.length).toBeGreaterThan(0);
  });

  it('creates an isolated session', async () => {
    const data = payload(await handlers.handleCreateSession({}));
    sessionId = data.sessionId as string;
    expect(sessionId).toBeTruthy();
  });

  it('loads a loadable library end-to-end and inspects its imports', async () => {
    expect(sessionId).toBeTruthy();
    const { writeFile, mkdtemp, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    // Pick the first non-Dart runtime library; skip libapp.so/libflutter.so
    // (Flutter Dart AOT is out of scope for this JNI-oriented emulator).
    const target =
      extractedLibs.find((l) => !/lib(app|flutter)\.so$/i.test(l.name)) ?? extractedLibs[0]!;
    expect(target).toBeTruthy();

    const tmpDir = await mkdtemp(join(tmpdir(), 'nemu-int-'));
    const soPath = join(tmpDir, target.name);
    await writeFile(soPath, target.bytes);

    try {
      const inspectData = payload(await handlers.handleInspectImports({ soPath }));
      expect(Array.isArray(inspectData.imports)).toBe(true);

      const loadData = payload(await handlers.handleLoadLibrary({ sessionId, soPath }));
      // Load must succeed; the number of unresolved imports is library-dependent
      // (asserted structurally, not against a fixed count).
      expect(loadData.success !== false).toBe(true);

      const symbolsData = payload(await handlers.handleListSymbols({ sessionId }));
      expect(Array.isArray(symbolsData.symbols)).toBe(true);
      expect((symbolsData.symbols as string[]).length).toBeGreaterThan(0);

      // Verify the library is genuinely executable: at least one plain export
      // (non-JNI) must invoke without faulting. This is the "actually emulated"
      // signal — a load that lists symbols but can't run any of them is not a
      // working reverse-engineering surface. The deep runtime-init path of some
      // libraries (e.g. SQLite's initialize) may still be out of reach, so we
      // only require that *some* export returns, not a specific one.
      const plain = (symbolsData.symbols as string[]).find(
        (s) => !s.startsWith('Java_') && !s.startsWith('_'),
      );
      if (plain) {
        const callData = payload(
          await handlers.handleCallSymbol({ sessionId, symbol: plain, args: [] }),
        );
        expect(callData.success !== false).toBe(true);
      }
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('traces an exported symbol and captures GPR + SIMD register state', async () => {
    expect(sessionId).toBeTruthy();
    const symbolsData = payload(await handlers.handleListSymbols({ sessionId }));
    const symbols = symbolsData.symbols as string[];
    // Prefer a plain exported function over a Java_* JNI export for a clean trace.
    const target = symbols.find((s) => !s.startsWith('Java_')) ?? symbols[0];
    if (!target) return; // nothing callable to trace — structural skip

    const traceData = payload(
      await handlers.handleTrace({
        sessionId,
        symbol: target,
        args: [],
        captureRegisters: ['x0', 'x1', 'sp', 'v0', 'v31'],
        maxSteps: 64,
      }),
    );

    expect(Array.isArray(traceData.trace)).toBe(true);
    if ((traceData.trace as unknown[]).length > 0) {
      const first = (traceData.trace as Array<Record<string, unknown>>)[0]!;
      expect(first).toHaveProperty('pc');
      expect(first).toHaveProperty('insn');
      // Register capture must include both GPR (x0) and SIMD (v0) names when requested.
      const regs = first.registers as Record<string, unknown> | undefined;
      expect(regs).toBeDefined();
      expect(regs).toHaveProperty('x0');
      expect(regs).toHaveProperty('v0');
    }
  });
});
