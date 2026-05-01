import type { Page } from 'rebrowser-puppeteer-core';

export type BrowserCookie = Awaited<ReturnType<Page['cookies']>>[number];

export interface SessionProfileCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  size?: number;
  httpOnly?: boolean;
  secure?: boolean;
  session?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  sourceScheme?: 'Unset' | 'NonSecure' | 'Secure';
}

export interface SessionProfileClientHints {
  secChUa?: string;
  secChUaMobile?: string;
  secChUaPlatform?: string;
  secChUaPlatformVersion?: string;
  secChUaArch?: string;
  secChUaFullVersion?: string;
  secChUaFullVersionList?: string;
  secChUaModel?: string;
  secChUaBitness?: string;
  secChUaWow64?: string;
}

export interface SessionProfile {
  cookies: SessionProfileCookie[];
  userAgent?: string;
  acceptLanguage?: string;
  referer?: string;
  clientHints?: SessionProfileClientHints;
  platform?: string;
  origin?: string;
  collectedAt: number;
  ttlSec: number;
}
