/** Device/viewport emulation and WebAuthn credential seeding for a managed page. */
import type { CodeCollector } from '@modules/collector/CodeCollector';
import { logger } from '@utils/logger';

export type EmulatedDevice = 'iPhone' | 'iPad' | 'Android';

export class PageEmulationController {
  private readonly collector: CodeCollector;

  constructor(collector: CodeCollector) {
    this.collector = collector;
  }

  async setViewport(width: number, height: number): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.setViewport({ width, height });
    logger.info(`Viewport set to ${width}x${height}`);
  }

  async emulateDevice(deviceName: string): Promise<EmulatedDevice> {
    const page = await this.collector.getActivePage();

    const devices = {
      iPhone: {
        viewport: { width: 375, height: 812, isMobile: true },
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15',
      },
      iPad: {
        viewport: { width: 768, height: 1024, isMobile: true },
        userAgent: 'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X) AppleWebKit/605.1.15',
      },
      Android: {
        viewport: { width: 360, height: 640, isMobile: true },
        userAgent: 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/91.0.4472.120',
      },
    };

    const normalized = String(deviceName || '')
      .trim()
      .toLowerCase();
    let resolvedDevice: EmulatedDevice | null = null;
    if (normalized.includes('iphone')) {
      resolvedDevice = 'iPhone';
    } else if (normalized.includes('ipad')) {
      resolvedDevice = 'iPad';
    } else if (normalized.includes('android') || normalized.includes('pixel')) {
      resolvedDevice = 'Android';
    }

    if (!resolvedDevice) {
      throw new Error(
        `Unsupported device "${deviceName}". Supported values include: iPhone, iPad, Android (aliases like "iPhone ` +
          `13" are accepted).`,
      );
    }

    const device = devices[resolvedDevice];
    await page.setViewport(device.viewport);
    await page.setUserAgent(device.userAgent);

    logger.info(`Emulating ${resolvedDevice} (input: ${deviceName})`);
    return resolvedDevice;
  }

  async seedWebAuthnCredential(options: {
    relyingPartyId: string;
    credentialId: string;
    userHandle: string;
    privateKey: string;
    publicKey?: string;
    userDisplayName?: string;
  }): Promise<{ authenticatorId: string; credentialId: string }> {
    const page = await this.collector.getActivePage();
    const cdp = await page.createCDPSession();
    try {
      await cdp.send('WebAuthn.enable', { enableUI: true });
      const authResult = (await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: {
          protocol: 'ctap2',
          transport: 'internal',
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
        },
      })) as { authenticatorId: string };
      await cdp.send('WebAuthn.addCredential', {
        authenticatorId: authResult.authenticatorId,
        credential: {
          credentialId: options.credentialId,
          isResidentCredential: true,
          privateKey: options.privateKey,
          signCount: 0,
          rpId: options.relyingPartyId,
          userHandle: options.userHandle,
          userDisplayName: options.userDisplayName ?? 'jshook user',
          ...(options.publicKey ? { publicKey: options.publicKey } : {}),
        },
      });
      logger.info(`Seeded WebAuthn credential for ${options.relyingPartyId}`);
      return { authenticatorId: authResult.authenticatorId, credentialId: options.credentialId };
    } finally {
      await cdp.detach().catch(() => {});
    }
  }
}
