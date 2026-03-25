import type { PluginLifecycleContext } from '@server/plugins/PluginContract';

function normalizeSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function envCandidates(pluginId: string, key: string): string[] {
  const pluginSegment = normalizeSegment(pluginId);
  const keySegment = normalizeSegment(key);
  return [`PLUGIN_${pluginSegment}_${keySegment}`, `PLUGINS_${pluginSegment}_${keySegment}`];
}

function parseBoolean(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const value = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return undefined;
}

export function getPluginBooleanConfig(
  ctx: PluginLifecycleContext,
  pluginId: string,
  key: string,
  fallback: boolean,
): boolean {
  for (const candidate of envCandidates(pluginId, key)) {
    const parsed = parseBoolean(process.env[candidate]);
    if (parsed !== undefined) return parsed;
  }

  return ctx.getConfig<boolean>(`plugins.${pluginId}.${key}`, fallback);
}

export type BoostTier = 'search' | 'workflow' | 'full';
const VALID_BOOST_TIERS: ReadonlySet<BoostTier> = new Set<BoostTier>([
  'search',
  'workflow',
  'full',
]);

/**
 * Resolve the minimum boost tier at which a plugin's tools are auto-registered.
 * Checks PLUGIN_<ID>_BOOST_DOMAIN, then MCP_DEFAULT_PLUGIN_BOOST_TIER, then 'full'.
 */
export function getPluginBoostTier(pluginId: string): BoostTier {
  for (const candidate of envCandidates(pluginId, 'BOOST_DOMAIN')) {
    const raw = process.env[candidate]?.trim().toLowerCase();
    if (raw && VALID_BOOST_TIERS.has(raw as BoostTier)) return raw as BoostTier;
  }

  const globalDefault = process.env.MCP_DEFAULT_PLUGIN_BOOST_TIER?.trim().toLowerCase();
  if (globalDefault && VALID_BOOST_TIERS.has(globalDefault as BoostTier))
    return globalDefault as BoostTier;

  return 'full';
}
