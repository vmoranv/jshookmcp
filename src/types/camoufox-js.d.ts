/**
 * Type declarations for camoufox-js
 *
 * This is a minimal type stub for the camoufox-js package.
 * The actual package provides browser automation capabilities with anti-detection features.
 */

declare module 'camoufox-js' {
  export interface CamoufoxOptions {
    /** Operating system to emulate */
    os?: string;
    /** Run in headless mode (true/false) or virtual display mode ('virtual') */
    headless?: boolean | 'virtual';
    /** Enable GeoIP spoofing */
    geoip?: boolean;
    /** Enable humanization features (true/false or number for level) */
    humanize?: boolean | number;
    /** Proxy configuration */
    proxy?: {
      server: string;
      username?: string;
      password?: string;
    };
    /** Block images */
    block_images?: boolean;
    /** Block WebRTC */
    block_webrtc?: boolean;
    /** Additional options */
    [key: string]: any;
  }

  export interface CamoufoxServerOptions extends CamoufoxOptions {
    /** Port to listen on */
    port?: number;
    /** WebSocket path */
    ws_path?: string;
  }

  export interface CamoufoxBrowser {
    /** Browser instance methods */
    newPage(): Promise<CamoufoxPage>;
    close(): Promise<void>;
    /** Check if browser is still connected */
    isConnected(): boolean;
    [key: string]: any;
  }

  export interface CamoufoxPage {
    /** Page instance methods */
    goto(url: string, options?: any): Promise<any>;
    close(): Promise<void>;
    /** Get browser context */
    context(): {
      newCDPSession(page: CamoufoxPage): Promise<unknown>;
    };
    [key: string]: any;
  }

  export interface CamoufoxServer {
    /** Get WebSocket endpoint */
    wsEndpoint(): string;
    /** Close the server */
    close(): Promise<void>;
    [key: string]: any;
  }

  /**
   * Launch a Camoufox browser instance
   */
  export function Camoufox(options?: CamoufoxOptions): Promise<CamoufoxBrowser>;

  /**
   * Launch a Camoufox server instance
   */
  export function launchServer(options?: CamoufoxServerOptions): Promise<CamoufoxServer>;

  const _default: {
    Camoufox: typeof Camoufox;
    launchServer: typeof launchServer;
  };

  export default _default;
}
