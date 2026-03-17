import type { PageController } from '@server/domains/shared/modules';
import type { AICaptchaDetector } from '@server/domains/shared/modules';
import { argNumber, argBool } from '@server/domains/shared/parse-args';
import { logger } from '@utils/logger';

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
    const timeout = argNumber(args, 'timeout', this.deps.captchaTimeout);
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
      this.deps.setAutoDetectCaptcha(argBool(args, 'autoDetectCaptcha', false));
    }
    if (args.autoSwitchHeadless !== undefined) {
      this.deps.setAutoSwitchHeadless(argBool(args, 'autoSwitchHeadless', false));
    }
    if (args.captchaTimeout !== undefined) {
      this.deps.setCaptchaTimeout(argNumber(args, 'captchaTimeout', 0));
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
