/**
 * ADB Bridge domain — type definitions.
 */

import type { ADBDevice, ADBShellResult, APKInfo, CDPTarget } from '@modules/adb/types';

export type { ADBDevice, ADBShellResult, APKInfo, CDPTarget };

export interface ADBBridgeDomainDependencies {
  // ADB Bridge is pure Node.js, no browser dependencies for core tools
  // WebView tools may reference browser domain for CDP session management
}
