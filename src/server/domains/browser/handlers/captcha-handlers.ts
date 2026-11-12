import type { PageController } from '@server/domains/shared/modules/collector';
import type { AICaptchaDetector } from '@server/domains/shared/modules';
import { argNumber, argBool } from '@server/domains/shared/parse-args';
import { logger } from '@utils/logger';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/domains/shared/ResponseBuilder';

interface CaptchaHandlersDeps {
  pageController: PageController;
  captchaDetector: AICaptchaDetector;
  /** Live getters — snapshot values would make captcha_config report stale state. */
  getAutoDetectCaptcha: () => boolean;
  getAutoSwitchHeadless: () => boolean;
  getCaptchaTimeout: () => number;
  setAutoDetectCaptcha: (value: boolean) => void;
  setAutoSwitchHeadless: (value: boolean) => void;
  setCaptchaTimeout: (value: number) => void;
}

export class CaptchaHandlers {
  private deps: CaptchaHandlersDeps;
  constructor(deps: CaptchaHandlersDeps) {
    this.deps = deps;
  }

  async handleCaptchaDetect(_args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const page = await this.deps.pageController.getPage();
      const result = await this.deps.captchaDetector.detect(page);
      return { captcha_detected: result.detected, captcha_info: result };
    });
  }

  async handleCaptchaWait(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const timeout = argNumber(args, 'timeout', this.deps.getCaptchaTimeout());
      const page = await this.deps.pageController.getPage();
      logger.info('Waiting for CAPTCHA to be solved...');
      const completed = await this.deps.captchaDetector.waitForCompletion(page, timeout);
      if (!completed) throw new Error('CAPTCHA wait timed out');
      return { message: 'CAPTCHA solved' };
    });
  }

  async handleCaptchaConfig(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
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
        config: {
          autoDetectCaptcha: this.deps.getAutoDetectCaptcha(),
          autoSwitchHeadless: this.deps.getAutoSwitchHeadless(),
          captchaTimeout: this.deps.getCaptchaTimeout(),
        },
      };
    });
  }
}
