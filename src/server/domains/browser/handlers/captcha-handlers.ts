import type { PageController } from '../../../../modules/collector/PageController.js';
import type { AICaptchaDetector } from '../../../../modules/captcha/AICaptchaDetector.js';
import { logger } from '../../../../utils/logger.js';

interface CaptchaHandlersDeps {
  pageController: PageController;
  captchaDetector: AICaptchaDetector;
  autoDetectCaptcha: boolean;
  autoSwitchHeadless: boolean;
  captchaTimeout: number;
  setAutoDetectCaptcha: (value: boolean) => void;
  setAutoSwitchHeadless: (value: boolean) => void;
  setCaptchaTimeout: (value: number) => void;
}

export class CaptchaHandlers {
  constructor(private deps: CaptchaHandlersDeps) {}

  async handleCaptchaDetect(_args: Record<string, unknown>) {
    const page = await this.deps.pageController.getPage();
    const result = await this.deps.captchaDetector.detect(page);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              captcha_detected: result.detected,
              captcha_info: result,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handleCaptchaWait(args: Record<string, unknown>) {
    const timeout = (args.timeout as number) || this.deps.captchaTimeout;
    const page = await this.deps.pageController.getPage();

    logger.info('Waiting for CAPTCHA to be solved...');
    const completed = await this.deps.captchaDetector.waitForCompletion(page, timeout);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: completed,
              message: completed ? 'CAPTCHA solved' : 'CAPTCHA wait timed out',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handleCaptchaConfig(args: Record<string, unknown>) {
    if (args.autoDetectCaptcha !== undefined) {
      this.deps.setAutoDetectCaptcha(args.autoDetectCaptcha as boolean);
    }
    if (args.autoSwitchHeadless !== undefined) {
      this.deps.setAutoSwitchHeadless(args.autoSwitchHeadless as boolean);
    }
    if (args.captchaTimeout !== undefined) {
      this.deps.setCaptchaTimeout(args.captchaTimeout as number);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              config: {
                autoDetectCaptcha: this.deps.autoDetectCaptcha,
                autoSwitchHeadless: this.deps.autoSwitchHeadless,
                captchaTimeout: this.deps.captchaTimeout,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }
}
