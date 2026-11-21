/**
 * Shared Camoufox launch/server configuration extraction.
 *
 * Both `browser_camoufox_server_launch` and the Camoufox launch flow accept the
 * same config surface. Keeping one extractor prevents the two tools from
 * silently drifting when a new Camoufox option is added.
 */
import type { CamoufoxBrowserConfig } from '@modules/browser/CamoufoxBrowserManager';
import {
  argBool,
  argEnum,
  argObject,
  argString,
  argStringArray,
} from '@server/domains/shared/parse-args';

export function extractCamoufoxConfig(args: Record<string, unknown>): CamoufoxBrowserConfig {
  const addons = argStringArray(args, 'addons');
  const excludeAddons = argStringArray(args, 'excludeAddons');
  const fonts = argStringArray(args, 'fonts');
  return {
    headless: argBool(args, 'headless', true),
    os: argEnum(args, 'os', new Set(['windows', 'macos', 'linux'] as const), 'windows'),
    geoip: argBool(args, 'geoip', false),
    humanize: argBool(args, 'humanize', false),
    proxy: argString(args, 'proxy') || undefined,
    blockImages: argBool(args, 'blockImages', false),
    blockWebrtc: argBool(args, 'blockWebrtc', false),
    blockWebgl: argBool(args, 'blockWebgl', false),
    locale: argString(args, 'locale') || undefined,
    addons: addons.length > 0 ? addons : undefined,
    fonts: fonts.length > 0 ? fonts : undefined,
    excludeAddons: excludeAddons.length > 0 ? excludeAddons : undefined,
    customFontsOnly: argBool(args, 'customFontsOnly', false),
    screen: argObject(args, 'screen') as { width: number; height: number } | undefined,
    window: argObject(args, 'window') as { width: number; height: number } | undefined,
    fingerprint: argObject(args, 'fingerprint'),
    webglConfig: argObject(args, 'webglConfig'),
    firefoxUserPrefs: argObject(args, 'firefoxUserPrefs'),
    mainWorldEval: argBool(args, 'mainWorldEval', true),
    enableCache: argBool(args, 'enableCache', false),
  };
}
