/**
 * native-emulator manifest — shape, registration wiring, and lazy ensure().
 *
 * Guards the contract the registry relies on: the manifest declares the right
 * domain/depKey/profile, every tool name maps to a real handler method, and
 * ensure() returns a singleton cached on the context.
 */
import { describe, expect, it } from 'vitest';

import manifest from '@server/domains/native-emulator/manifest';
import { NativeEmulatorHandlers } from '@server/domains/native-emulator/handlers';
import { nativeEmulatorTools } from '@server/domains/native-emulator/definitions';
import type { MCPServerContext } from '@server/MCPServer.context';

/**
 * Minimal context covering only what ensure() touches (the domain-instance
 * store). Cast through unknown once, here, instead of sprinkling `as any` at
 * each call site.
 */
function makeCtx(): MCPServerContext {
  const store = new Map<string, unknown>();
  const ctx = {
    getDomainInstance<T>(key: string): T | undefined {
      return store.get(key) as T | undefined;
    },
    setDomainInstance(key: string, value: unknown): void {
      store.set(key, value);
    },
  };
  return ctx as unknown as MCPServerContext;
}

describe('native-emulator manifest', () => {
  it('declares the expected domain identity and profile', () => {
    expect(manifest.kind).toBe('domain-manifest');
    expect(manifest.domain).toBe('native-emulator');
    expect(manifest.depKey).toBe('nativeEmulatorHandlers');
    expect(manifest.profiles).toEqual(['full']);
  });

  it('registers one binding per defined tool', () => {
    expect(manifest.registrations).toHaveLength(nativeEmulatorTools.length);
    const registeredNames = manifest.registrations.map((r) => r.tool.name).toSorted();
    const definedNames = nativeEmulatorTools.map((t) => t.name).toSorted();
    expect(registeredNames).toEqual(definedNames);
  });

  it('every tool name carries the nemu_ prefix', () => {
    for (const t of nativeEmulatorTools) {
      expect(t.name.startsWith('nemu_')).toBe(true);
    }
  });

  it('ensure() returns a NativeEmulatorHandlers and caches it as a singleton', async () => {
    const ctx = makeCtx();
    const first = await manifest.ensure(ctx);
    const second = await manifest.ensure(ctx);
    expect(first).toBeInstanceOf(NativeEmulatorHandlers);
    expect(second).toBe(first); // cached, not re-created
    first.dispose();
  });

  it('binds every registration to a method that exists on the handler', async () => {
    const ctx = makeCtx();
    const handlers = await manifest.ensure(ctx);
    for (const reg of manifest.registrations) {
      const bound = reg.bind({ nativeEmulatorHandlers: handlers });
      expect(typeof bound).toBe('function');
    }
    handlers.dispose();
  });

  it('declares a workflow rule that matches a native/JNI emulation task', () => {
    expect(manifest.workflowRule).toBeDefined();
    const matched = manifest.workflowRule!.patterns.some((re) =>
      re.test('emulate a native .so to recover the JNI signing algorithm'),
    );
    expect(matched).toBe(true);
  });
});
