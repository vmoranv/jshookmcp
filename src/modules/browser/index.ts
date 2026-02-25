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
} from './UnifiedBrowserManager.js';

// Chrome Browser Manager
export { BrowserModeManager, type BrowserModeConfig } from './BrowserModeManager.js';

// Camoufox Browser Manager
export { CamoufoxBrowserManager, type CamoufoxBrowserConfig } from './CamoufoxBrowserManager.js';

// Browser Discovery
export { BrowserDiscovery, type BrowserInfo, type BrowserSignature } from './BrowserDiscovery.js';
