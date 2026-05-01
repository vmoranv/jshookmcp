import type { Page } from 'rebrowser-puppeteer-core';
import type {
  SessionProfile,
  SessionProfileClientHints,
  SessionProfileCookie,
} from '@internal-types/SessionProfile';
import { logger } from '@utils/logger';

export interface ExportSessionProfileOptions {
  referer?: string;
  ttlSec?: number;
  origin?: string;
}

export class SessionProfileManager {
  private static instance: SessionProfileManager | null = null;
  private cachedProfile: SessionProfile | null = null;
  private static readonly DEFAULT_TTL_SEC = 1800;

  static getInstance(): SessionProfileManager {
    if (!SessionProfileManager.instance) {
      SessionProfileManager.instance = new SessionProfileManager();
    }
    return SessionProfileManager.instance;
  }

  async exportFromPage(
    page: Page,
    options: ExportSessionProfileOptions = {},
  ): Promise<SessionProfile> {
    const cookies = await page.cookies();
    const pageMeta = await page.evaluate(() => {
      const nav = navigator as Navigator & {
        userAgentData?: {
          brands?: Array<{ brand: string; version: string }>;
          mobile?: boolean;
          platform?: string;
        };
      };
      const uaData = nav.userAgentData;
      const clientHints: SessionProfileClientHints = {
        secChUa: Array.isArray(uaData?.brands)
          ? uaData.brands.map((b) => `"${b.brand}";v="${b.version}"`).join(', ')
          : undefined,
        secChUaMobile:
          typeof uaData?.mobile === 'boolean' ? (uaData.mobile ? '?1' : '?0') : undefined,
        secChUaPlatform: uaData?.platform ? `"${uaData.platform}"` : undefined,
      };
      return {
        userAgent: nav.userAgent,
        platform: nav.platform,
        acceptLanguage: nav.language,
        referer: document.referrer || undefined,
        clientHints,
      };
    });

    const origin = options.origin ?? this.safeOrigin(page.url());
    const ttlSec = options.ttlSec ?? SessionProfileManager.DEFAULT_TTL_SEC;
    const profile: SessionProfile = {
      cookies: cookies.map(
        (c): SessionProfileCookie => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          expires: c.expires,
          size: c.size,
          httpOnly: c.httpOnly,
          secure: c.secure,
          session: c.session,
          sameSite: c.sameSite,
          sourceScheme: c.sourceScheme,
        }),
      ),
      userAgent: pageMeta.userAgent,
      acceptLanguage: pageMeta.acceptLanguage,
      referer: options.referer ?? pageMeta.referer,
      clientHints: pageMeta.clientHints,
      platform: pageMeta.platform,
      origin,
      collectedAt: Date.now(),
      ttlSec,
    };

    this.cachedProfile = profile;
    logger.info(
      `Session profile exported: cookies=${profile.cookies.length}, origin=${profile.origin ?? 'unknown'}, ttlSec=${profile.ttlSec}`,
    );
    return profile;
  }

  serialize(profile: SessionProfile): string {
    return JSON.stringify(profile);
  }

  deserialize(raw: string): SessionProfile {
    const parsed = JSON.parse(raw) as Partial<SessionProfile>;
    return {
      cookies: Array.isArray(parsed.cookies) ? parsed.cookies : [],
      userAgent: parsed.userAgent,
      acceptLanguage: parsed.acceptLanguage,
      referer: parsed.referer,
      clientHints: parsed.clientHints,
      platform: parsed.platform,
      origin: parsed.origin,
      collectedAt: typeof parsed.collectedAt === 'number' ? parsed.collectedAt : Date.now(),
      ttlSec:
        typeof parsed.ttlSec === 'number' && parsed.ttlSec > 0
          ? parsed.ttlSec
          : SessionProfileManager.DEFAULT_TTL_SEC,
    };
  }

  setProfile(profile: SessionProfile): void {
    this.cachedProfile = profile;
  }

  getProfile(): SessionProfile | null {
    return this.cachedProfile;
  }

  getValidProfile(now = Date.now()): SessionProfile | null {
    if (!this.cachedProfile || this.isExpired(this.cachedProfile, now)) {
      return null;
    }
    return this.cachedProfile;
  }

  isExpired(profile: SessionProfile, now = Date.now()): boolean {
    return profile.collectedAt + profile.ttlSec * 1000 <= now;
  }

  clearProfile(): void {
    this.cachedProfile = null;
  }

  static resetInstance(): void {
    SessionProfileManager.instance = null;
  }

  private safeOrigin(url: string): string | undefined {
    if (!url || url === 'about:blank') return undefined;
    try {
      return new URL(url).origin;
    } catch {
      return undefined;
    }
  }
}
