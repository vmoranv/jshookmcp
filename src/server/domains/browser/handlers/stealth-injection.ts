import type { PageController } from '@server/domains/shared/modules';
import { StealthScripts } from '@server/domains/shared/modules';
import { argString } from '@server/domains/shared/parse-args';

interface StealthInjectionHandlersDeps {
  pageController: PageController;
  getActiveDriver: () => 'chrome' | 'camoufox';
}

export class StealthInjectionHandlers {
  constructor(private deps: StealthInjectionHandlersDeps) {}

  async handleStealthInject(_args: Record<string, unknown>) {
    if (this.deps.getActiveDriver() === 'camoufox') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                driver: 'camoufox',
                message:
                  'Camoufox uses C++ engine-level fingerprint spoofing — JS-layer stealth scripts are not needed and have been skipped.',
              },
              null,
              2
            ),
          },
        ],
      };
    }

    const page = await this.deps.pageController.getPage();
    await StealthScripts.injectAll(page);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: 'Stealth scripts injected successfully',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handleStealthSetUserAgent(args: Record<string, unknown>) {
    const platform = argString(args, 'platform', 'windows') as 'windows' | 'mac' | 'linux';
    const page = await this.deps.pageController.getPage();

    await StealthScripts.setRealisticUserAgent(page, platform);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              platform,
              message: `User-Agent set for ${platform}`,
            },
            null,
            2
          ),
        },
      ],
    };
  }
}
