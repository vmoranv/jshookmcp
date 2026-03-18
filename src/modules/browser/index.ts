/**
 * Browser Module Exports
 *
 * This module provides unified browser management capabilities supporting:
 * - Chrome (via rebrowser-puppeteer-core)
 * - Camoufox (Firefox via camoufox-js)
 */

// Unified Browser Manager (primary interface)
export {
  UnifiedBrowserManager,
  type BrowserDriver,
  type HeadlessMode,
  type ProxyConfig,
  type UnifiedBrowserConfig,
  type IBrowserManager,
  type BrowserStatus,
} from '@modules/browser/UnifiedBrowserManager';

// Chrome Browser Manager
export { BrowserModeManager, type BrowserModeConfig } from '@modules/browser/BrowserModeManager';

// Camoufox Browser Manager
export {
  CamoufoxBrowserManager,
  type CamoufoxBrowserConfig,
} from '@modules/browser/CamoufoxBrowserManager';

// Browser Discovery
export {
  BrowserDiscovery,
  type BrowserInfo,
  type BrowserSignature,
} from '@modules/browser/BrowserDiscovery';
