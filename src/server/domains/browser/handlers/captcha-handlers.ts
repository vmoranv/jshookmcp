import type { PageController } from '@server/domains/shared/modules';
import type { AICaptchaDetector } from '@server/domains/shared/modules';
import { argNumber, argBool } from '@server/domains/shared/parse-args';
import { logger } from '@utils/logger';
import { R } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/domains/shared/ResponseBuilder';

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

  async handleCaptchaDetect(_args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const page = await this.deps.pageController.getPage();
      const result = await this.deps.captchaDetector.detect(page);

      return R.ok().build({
        captcha_detected: result.detected,
        captcha_info: result,
      });
    } catch (e) {
      return R.fail(e).build();
    }
  }

  async handleCaptchaWait(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const timeout = argNumber(args, 'timeout', this.deps.captchaTimeout);
      const page = await this.deps.pageController.getPage();

      logger.info('Waiting for CAPTCHA to be solved...');
      const completed = await this.deps.captchaDetector.waitForCompletion(page, timeout);

      if (!completed) {
        return R.fail('CAPTCHA wait timed out').build();
      }

      return R.ok().build({ message: 'CAPTCHA solved' });
    } catch (e) {
      return R.fail(e).build();
    }
  }

  async handleCaptchaConfig(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      if (args.autoDetectCaptcha !== undefined) {
        this.deps.setAutoDetectCaptcha(argBool(args, 'autoDetectCaptcha', false));
      }
      if (args.autoSwitchHeadless !== undefined) {
        this.deps.setAutoSwitchHeadless(argBool(args, 'autoSwitchHeadless', false));
      }
      if (args.captchaTimeout !== undefined) {
        this.deps.setCaptchaTimeout(argNumber(args, 'captchaTimeout', 0));
      }

      return R.ok().build({
        config: {
          autoDetectCaptcha: this.deps.autoDetectCaptcha,
          autoSwitchHeadless: this.deps.autoSwitchHeadless,
          captchaTimeout: this.deps.captchaTimeout,
        },
      });
    } catch (e) {
      return R.fail(e).build();
    }
  }
}
