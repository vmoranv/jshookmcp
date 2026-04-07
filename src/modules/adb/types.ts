/**
 * ADB module type definitions.
 *
 * Used by ADBConnector and ChromeDevToolsOverADB.
 */

/** Connected Android device information. */
export interface ADBDevice {
  serial: string;
  name: string;
  state: 'device' | 'offline' | 'unauthorized' | 'connecting';
  model: string;
  product: string;
  device: string;
  transportId?: string;
  sdkVersion?: string;
  abi?: string;
}

/** Result of an ADB shell command execution. */
export interface ADBShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
}

/** APK information extracted from a device. */
export interface APKInfo {
  packageName: string;
  versionName: string;
  versionCode: string;
  minSdk?: string;
  targetSdk?: string;
  permissions: string[];
  activities: string[];
  services: string[];
  receivers: string[];
  usesFeatures?: string[];
  applicationLabel?: string;
}

/** ADB port forwarding entry. */
export interface ADBForwardEntry {
  serial: string;
  local: string;
  remote: string;
}

/** CDP target discovered via ADB port forwarding. */
export interface CDPTarget {
  id: string;
  title: string;
  url: string;
  type: string;
  webSocketDebuggerUrl: string;
  faviconUrl?: string;
}
