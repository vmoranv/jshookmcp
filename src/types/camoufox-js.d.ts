/**
 * Type declarations for camoufox-js 0.10.2
 *
 * Minimal type stub covering the public API surface:
 *   - Camoufox() / launchServer() with full LaunchOptions
 *   - fingerprints module: generateFingerprint(), fromBrowserforge()
 *   - ip module: publicIP(), ProxyHelper
 *   - locale module: Locale, Geolocation, getGeolocation()
 *   - addons module: DefaultAddons, addDefaultAddons()
 */

declare module 'camoufox-js' {
  export interface LaunchOptions {
    os?: string;
    headless?: boolean | 'virtual';
    geoip?: boolean;
    humanize?: boolean | number;
    proxy?: { server: string; username?: string; password?: string } | string;
    block_images?: boolean;
    block_webrtc?: boolean;
    block_webgl?: boolean;
    locale?: string;
    addons?: string[];
    fonts?: string[];
    exclude_addons?: string[];
    custom_fonts_only?: boolean;
    screen?: { width: number; height: number };
    window?: { width: number; height: number };
    fingerprint?: Record<string, unknown>;
    webgl_config?: Record<string, unknown>;
    firefox_user_prefs?: Record<string, unknown>;
    main_world_eval?: boolean;
    enable_cache?: boolean;
    /** @deprecated Use LaunchOptions fields directly */
    [key: string]: unknown;
  }

  export interface CamoufoxServerOptions extends LaunchOptions {
    port?: number;
    ws_path?: string;
  }

  export interface CamoufoxBrowser {
    newPage(): Promise<CamoufoxPage>;
    close(): Promise<void>;
    isConnected(): boolean;
    [key: string]: unknown;
  }

  export interface CamoufoxPage {
    goto(url: string, options?: unknown): Promise<unknown>;
    close(): Promise<void>;
    context(): {
      newCDPSession(page: CamoufoxPage): Promise<unknown>;
    };
    [key: string]: unknown;
  }

  export interface CamoufoxServer {
    wsEndpoint(): string;
    close(): Promise<void>;
    [key: string]: unknown;
  }

  export function Camoufox(options?: LaunchOptions): Promise<CamoufoxBrowser>;
  export function launchServer(options?: CamoufoxServerOptions): Promise<CamoufoxServer>;

  const _default: {
    Camoufox: typeof Camoufox;
    launchServer: typeof launchServer;
  };

  export default _default;
}

declare module 'camoufox-js/fingerprints' {
  export function generateFingerprint(
    os?: string,
    browser?: string,
  ): Promise<Record<string, unknown>>;
  export function fromBrowserforge(fp: Record<string, unknown>): Record<string, unknown>;
  export const SUPPORTED_OS: string[];
}

declare module 'camoufox-js/ip' {
  export class ProxyHelper {
    constructor(proxy: string);
    server: string;
    username?: string;
    password?: string;
  }
  export function publicIP(proxy?: string): Promise<string>;
  export function validateIP(ip: string): boolean;
  export function validIPv4(ip: string): boolean;
  export function validIPv6(ip: string): boolean;
}

declare module 'camoufox-js/locale' {
  export class Locale {
    constructor(locale: string);
    toString(): string;
  }
  export class Geolocation {
    latitude: number;
    longitude: number;
    accuracy: number;
  }
  export function getGeolocation(locale: string): Promise<Geolocation>;
}

declare module 'camoufox-js/addons' {
  export const DefaultAddons: string[];
  export function addDefaultAddons(addons: string[]): string[];
}
