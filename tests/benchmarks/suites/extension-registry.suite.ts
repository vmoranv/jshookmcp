/**
 * Extension-registry domain benchmark (offline, in-memory).
 *
 * The six registry tools are pure with respect to a `PluginRegistry` instance:
 * no network, no live browser, no subprocess. We root a real PluginRegistry and
 * a real WebhookBridge in an OS temp dir (no repo writes) and drive the full
 * install → list → info → execute → reload → uninstall lifecycle through the
 * real `ExtensionRegistryHandlers` methods.
 *
 * Ground truth (homemade fixtures, deterministic):
 *  - register() lowercases/sanitizes the id, listInstalled() sorts by name,
 *    getInstalled() returns the stored manifest, loadPlugin() dynamically
 *    imports the file:// entry and caches its callable exports, unregister()
 *    unloads and removes the plugin.
 *  - the fixture plugin exports `sum`, `echo` and a `default` object with
 *    `greet` and `version`; resolveContext() resolves named/default/nested
 *    contexts and returns their value as `result`.
 *  - `webhook` is intentionally OMITTED: handleWebhook* call
 *    WebhookServer.start() (binds a real port) and are env-gated, so they are
 *    not honestly offline-testable here.
 *
 * Every case re-installs its fixture via handleInstall() at the start, so each
 * is self-contained and order-independent (the scorecard re-executes suites).
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PluginRegistry, WebhookBridge } from '@modules/extension-registry';
import { ExtensionRegistryHandlers } from '@server/domains/extension-registry/handlers.impl';
import { body, expectSuccess, type BenchSuite } from '../harness';

// One OS-temp sandbox holds both the plugin module and the registry data. The
// registry writes plugins.json / modules/ here — never inside the repository.
const sandbox = mkdtempSync(join(tmpdir(), 'jshook-bench-extreg-'));

const pluginModulePath = join(sandbox, 'bench-plugin.mjs');
writeFileSync(
  pluginModulePath,
  [
    'export const sum = ({ a, b }) => a + b;',
    'export const echo = (input) => input;',
    'export default {',
    '  greet: ({ who }) => `hello ${who}`,',
    '  version: () => "1.2.3",',
    '};',
  ].join('\n'),
  'utf8',
);
const pluginEntry = pathToFileURL(pluginModulePath).href;

// A shared registry + webhook bridge rooted in the temp dir. The webhook bridge
// reads a fresh empty webhooks.json (no subscriptions), so emitEvent() never
// performs a fetch — it stays fully offline. No event bus is threaded in.
const registry = new PluginRegistry(join(sandbox, 'registry'));
const webhook = new WebhookBridge(join(sandbox, 'webhooks'));
const handlers = new ExtensionRegistryHandlers(registry, webhook);

// Install manifest used by every case. The id contains uppercase/spaces to
// exercise PluginRegistry.sanitizeId(); the stable expected id is derived from
// the same normalization rules.
const INSTALL_ARGS = {
  id: 'Bench Fixture Plugin',
  name: 'Bench Fixture Plugin',
  version: '1.2.3',
  entry: pluginEntry,
  permissions: ['network', 'storage'],
} as const;
const PLUGIN_ID = 'bench-fixture-plugin';

async function install(): Promise<void> {
  await handlers.handleInstall(INSTALL_ARGS);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export const extensionRegistrySuite: BenchSuite = {
  name: 'extension-registry',
  domain: 'extension-registry',
  description:
    'Extension registry install→list→info→execute→reload→uninstall lifecycle against a temp-dir PluginRegistry; id sanitization, sorted listing, dynamic context execution, export-key reporting, and removal',
  cases: [
    {
      name: 'extension_install/sanitize-id-and-persist-manifest',
      tool: 'extension_install',
      origin: 'homemade',
      reference:
        'install must sanitize the mixed-case/spaced id to "bench-fixture-plugin", return success with that pluginId, and echo the stored manifest (version, entry, permissions)',
      run: () => handlers.handleInstall(INSTALL_ARGS),
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.pluginId !== PLUGIN_ID)
          return `pluginId must be sanitized to ${PLUGIN_ID}, got ${String(b.pluginId)}`;
        const manifest = (b.manifest ?? {}) as Record<string, unknown>;
        if (manifest.id !== PLUGIN_ID)
          return `stored manifest.id must equal ${PLUGIN_ID}, got ${String(manifest.id)}`;
        if (manifest.version !== '1.2.3') return `version mismatch: ${String(manifest.version)}`;
        if (manifest.entry !== pluginEntry) return `entry mismatch: ${String(manifest.entry)}`;
        const perms = asStringArray(manifest.permissions);
        if (perms.length !== 2 || !perms.includes('network') || !perms.includes('storage'))
          return `permissions not preserved: ${JSON.stringify(perms)}`;
        return true;
      },
    },
    {
      name: 'extension_list_installed/sorted-and-status',
      tool: 'extension_list_installed',
      origin: 'homemade',
      reference:
        'listInstalled() must include the freshly installed plugin with status "unloaded" (install does not import code), reflect its permissions, and be sorted by name',
      run: async () => {
        await install();
        return handlers.handleListInstalled();
      },
      validate: (v) => {
        const b = expectSuccess(v);
        const plugins: Array<Record<string, unknown>> = Array.isArray(b.plugins)
          ? (b.plugins as Array<Record<string, unknown>>)
          : [];
        const fixture = plugins.find((p) => p.id === PLUGIN_ID);
        if (!fixture) return `installed plugin missing from list: ${JSON.stringify(plugins)}`;
        if (fixture.status !== 'unloaded')
          return `fresh install must be unloaded, got ${String(fixture.status)}`;
        if (fixture.version !== '1.2.3') return `listed version mismatch`;
        const perms = asStringArray(fixture.permissions);
        if (perms.length !== 2) return `listed permissions mismatch: ${JSON.stringify(perms)}`;
        const names = plugins.map((p) => String(p.name));
        const sorted = names.toSorted((x, y) => x.localeCompare(y));
        if (JSON.stringify(names) !== JSON.stringify(sorted))
          return `plugins not sorted by name: ${JSON.stringify(names)}`;
        return true;
      },
    },
    {
      name: 'extension_info/manifest-without-import',
      tool: 'extension_info',
      origin: 'homemade',
      reference:
        'info must return the stored manifest for the plugin id (id/name/version/entry/permissions) without loading the module, and reject an unknown id with a Plugin-not-found failure',
      run: async () => {
        await install();
        const found = body(await handlers.handleInfoTool({ pluginId: PLUGIN_ID }));
        const missing = body(await handlers.handleInfoTool({ pluginId: 'no-such-plugin' }));
        return { found, missing };
      },
      validate: (v) => {
        const b = body(v);
        const found = b.found as Record<string, unknown>;
        const missing = b.missing as Record<string, unknown>;
        if (found.success !== true || found.pluginId !== PLUGIN_ID)
          return `info lookup failed: ${JSON.stringify(found).slice(0, 220)}`;
        const manifest = (found.manifest ?? {}) as Record<string, unknown>;
        if (manifest.id !== PLUGIN_ID || manifest.name !== 'Bench Fixture Plugin')
          return `info manifest mismatch: ${JSON.stringify(manifest).slice(0, 220)}`;
        if (manifest.version !== '1.2.3' || manifest.entry !== pluginEntry)
          return `info manifest version/entry mismatch`;
        if (missing.success !== false || !/plugin not found/i.test(String(missing.error)))
          return `unknown id must fail with Plugin not found: ${JSON.stringify(missing).slice(0, 220)}`;
        return true;
      },
    },
    {
      name: 'extension_execute_in_context/named-default-nested-and-prototype-guard',
      tool: 'extension_execute_in_context',
      origin: 'homemade',
      reference:
        'execute must resolve a named function export (sum → 7), the "default" nested context (greet → "hello bench"), roundtrip args via echo, and must NOT resolve "constructor" through Object prototype (hasOwn guard → failure)',
      run: async () => {
        await install();
        const sum = body(
          await handlers.handleExecuteInContextTool({
            pluginId: PLUGIN_ID,
            contextName: 'sum',
            args: { a: 3, b: 4 },
          }),
        );
        const greet = body(
          await handlers.handleExecuteInContextTool({
            pluginId: PLUGIN_ID,
            contextName: 'greet',
            args: { who: 'bench' },
          }),
        );
        const echo = body(
          await handlers.handleExecuteInContextTool({
            pluginId: PLUGIN_ID,
            contextName: 'echo',
            args: { token: 'xyz-789', n: 5 },
          }),
        );
        const guard = body(
          await handlers.handleExecuteInContextTool({
            pluginId: PLUGIN_ID,
            contextName: 'constructor',
            args: {},
          }),
        );
        return { sum, greet, echo, guard };
      },
      validate: (v) => {
        const b = body(v);
        const sum = b.sum as Record<string, unknown>;
        const greet = b.greet as Record<string, unknown>;
        const echo = b.echo as Record<string, unknown>;
        const guard = b.guard as Record<string, unknown>;
        if (sum.success !== true || sum.result !== 7)
          return `sum(3,4) must be 7: ${JSON.stringify(sum).slice(0, 220)}`;
        if (
          sum.contextName !== 'sum' ||
          (sum.manifest as Record<string, unknown>)?.id !== PLUGIN_ID
        )
          return `execute must echo contextName and manifest: ${JSON.stringify(sum).slice(0, 220)}`;
        if (greet.success !== true || greet.result !== 'hello bench')
          return `nested default.greet must be "hello bench": ${JSON.stringify(greet).slice(0, 220)}`;
        const echoed = echo.result as Record<string, unknown> | undefined;
        if (echo.success !== true || echoed?.token !== 'xyz-789' || echoed?.n !== 5)
          return `echo must roundtrip args: ${JSON.stringify(echo).slice(0, 220)}`;
        if (guard.success !== false || !/not found/i.test(String(guard.error)))
          return `"constructor" must not resolve via prototype: ${JSON.stringify(guard).slice(0, 220)}`;
        return true;
      },
    },
    {
      name: 'extension_reload/reimports-and-reports-export-keys',
      tool: 'extension_reload',
      origin: 'homemade',
      reference:
        'reload must unload then re-import the plugin, keeping the same pluginId/manifest, and report the sorted set of exported context keys (default, echo, sum); a second reload is idempotent',
      run: async () => {
        await install();
        // Load once so the first reload performs a genuine re-import.
        await handlers.handleExecuteInContextTool({
          pluginId: PLUGIN_ID,
          contextName: 'sum',
          args: { a: 1, b: 1 },
        });
        const first = body(await handlers.handleReloadTool({ pluginId: PLUGIN_ID }));
        const second = body(await handlers.handleReloadTool({ pluginId: PLUGIN_ID }));
        const afterReload = body(
          await handlers.handleExecuteInContextTool({
            pluginId: PLUGIN_ID,
            contextName: 'sum',
            args: { a: 10, b: 5 },
          }),
        );
        const missing = body(await handlers.handleReloadTool({ pluginId: 'no-such-plugin' }));
        return { first, second, afterReload, missing };
      },
      validate: (v) => {
        const b = body(v);
        const first = b.first as Record<string, unknown>;
        const second = b.second as Record<string, unknown>;
        const afterReload = b.afterReload as Record<string, unknown>;
        const missing = b.missing as Record<string, unknown>;
        const expectedKeys = ['default', 'echo', 'sum'];
        for (const [label, r] of [
          ['first', first],
          ['second', second],
        ] as const) {
          if (r.success !== true || r.pluginId !== PLUGIN_ID)
            return `${label} reload failed: ${JSON.stringify(r).slice(0, 220)}`;
          const keys = asStringArray(r.exportedKeys);
          if (JSON.stringify(keys) !== JSON.stringify(expectedKeys))
            return `${label} exportedKeys must be sorted [default,echo,sum]: ${JSON.stringify(keys)}`;
          const manifest = (r.manifest ?? {}) as Record<string, unknown>;
          if (manifest.id !== PLUGIN_ID || manifest.name !== 'Bench Fixture Plugin')
            return `${label} reload must preserve manifest: ${JSON.stringify(manifest).slice(0, 220)}`;
        }
        if (afterReload.success !== true || afterReload.result !== 15)
          return `reload must keep the plugin executable (sum 10+5=15): ${JSON.stringify(afterReload).slice(0, 220)}`;
        if (missing.success !== false)
          return `reload of unknown id must fail: ${JSON.stringify(missing).slice(0, 220)}`;
        return true;
      },
    },
    {
      name: 'extension_uninstall/removes-and-breaks-info',
      tool: 'extension_uninstall',
      origin: 'homemade',
      reference:
        'uninstall must echo the pluginId, remove the plugin from listInstalled(), make a subsequent info lookup fail with "Plugin not found", and be idempotent (a second uninstall still succeeds)',
      run: async () => {
        await install();
        const uninstall = body(await handlers.handleUninstallTool({ pluginId: PLUGIN_ID }));
        const list = body(await handlers.handleListInstalledTool());
        const info = body(await handlers.handleInfoTool({ pluginId: PLUGIN_ID }));
        const again = body(await handlers.handleUninstallTool({ pluginId: PLUGIN_ID }));
        return { uninstall, list, info, again };
      },
      validate: (v) => {
        const b = body(v);
        const uninstall = b.uninstall as Record<string, unknown>;
        const list = b.list as Record<string, unknown>;
        const info = b.info as Record<string, unknown>;
        const again = b.again as Record<string, unknown>;
        if (uninstall.success !== true || uninstall.pluginId !== PLUGIN_ID)
          return `uninstall failed: ${JSON.stringify(uninstall).slice(0, 220)}`;
        const remaining: Array<Record<string, unknown>> = Array.isArray(list.plugins)
          ? (list.plugins as Array<Record<string, unknown>>)
          : [];
        if (remaining.some((p) => p.id === PLUGIN_ID))
          return `uninstalled plugin still listed: ${JSON.stringify(remaining)}`;
        if (info.success !== false || !/plugin not found/i.test(String(info.error)))
          return `info after uninstall must fail: ${JSON.stringify(info).slice(0, 220)}`;
        if (again.success !== true || again.pluginId !== PLUGIN_ID)
          return `second uninstall must be idempotent: ${JSON.stringify(again).slice(0, 220)}`;
        return true;
      },
    },
  ],
};
