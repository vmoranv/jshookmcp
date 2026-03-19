/**
 * Public API surface for plugins.
 * Plugins should import from this module instead of reaching into internal paths.
 *
 * @deprecated Prefer importing from '@jshookmcp/extension-sdk/plugin' directly.
 */
export type { ExtensionBuilder, PluginLifecycleContext } from '@server/plugins/PluginContract';
export type { ToolArgs } from '@server/types';
export { getPluginBooleanConfig, getPluginBoostTier } from '@server/extensions/plugin-config';
export { loadPluginEnv } from '@server/extensions/plugin-env';
export { createExtension, jsonResponse, errorResponse } from '@server/plugins/PluginContract';

