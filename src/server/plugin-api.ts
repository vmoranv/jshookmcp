/**
 * Public API surface for plugins.
 * Plugins should import from this module instead of reaching into internal paths.
 */
export type { DomainManifest, ToolHandlerDeps } from './registry/contracts.js';
export type { PluginContract, PluginLifecycleContext } from './plugins/PluginContract.js';
export type { ToolArgs } from './types.js';
export { getPluginBooleanConfig, getPluginBoostTier } from './extensions/plugin-config.js';
export { loadPluginEnv } from './extensions/plugin-env.js';
