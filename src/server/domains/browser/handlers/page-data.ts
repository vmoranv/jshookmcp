import type { PageController } from '@server/domains/shared/modules';
import { argString, argNumber } from '@server/domains/shared/parse-args';
import { R } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/domains/shared/ResponseBuilder';

interface PageCookieInput {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

interface PageDataHandlersDeps {
  pageController: PageController;
  getActiveDriver: () => 'chrome' | 'camoufox';
}

export class PageDataHandlers {
  constructor(private deps: PageDataHandlersDeps) {}

  async handleGetContent(_args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const html = await this.deps.pageController.getContent();
      return R.ok().build({ html });
    } catch (e) {
      return R.fail(e).build();
    }
  }

  async handleGetTitle(_args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const title = await this.deps.pageController.getTitle();
      return R.ok().build({ title });
    } catch (e) {
      return R.fail(e).build();
    }
  }

  async handleGetUrl(_args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const url = await this.deps.pageController.getURL();
      return R.ok().build({ url });
    } catch (e) {
      return R.fail(e).build();
    }
  }

  async handleGetText(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const selector = argString(args, 'selector', '');
      const text = await this.deps.pageController.evaluate(
        `document.querySelector(${JSON.stringify(selector)})?.textContent || ""`,
      );
      return R.ok().build({ selector, text });
    } catch (e) {
      return R.fail(e).build();
    }
  }

  async handleGetOuterHtml(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const selector = argString(args, 'selector', '');
      const html = await this.deps.pageController.evaluate(
        `document.querySelector(${JSON.stringify(selector)})?.outerHTML || ""`,
      );
      return R.ok().build({ selector, html });
    } catch (e) {
      return R.fail(e).build();
    }
  }

  async handleGetScrollPosition(_args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const pos = (await this.deps.pageController.evaluate(`({
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        maxScrollX: document.documentElement.scrollWidth - window.innerWidth,
        maxScrollY: document.documentElement.scrollHeight - window.innerHeight
      })`)) as { scrollX: number; scrollY: number; maxScrollX: number; maxScrollY: number };

      return R.ok().build(pos);
    } catch (e) {
      return R.fail(e).build();
    }
  }

  async handlePageSetCookies(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const cookies = args.cookies as PageCookieInput[];
      await this.deps.pageController.setCookies(cookies);
      return R.ok().build({ message: `Set ${cookies.length} cookies` });
    } catch (e) {
      return R.fail(e).build();
    }
  }

  async handlePageGetCookies(_args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const cookies = await this.deps.pageController.getCookies();
      return R.ok().build({ count: cookies.length, cookies });
    } catch (e) {
      return R.fail(e).build();
    }
  }

  async handlePageClearCookies(_args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      await this.deps.pageController.clearCookies();
      return R.ok().build({ message: 'Cookies cleared' });
    } catch (e) {
      return R.fail(e).build();
    }
  }

  async handlePageSetViewport(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const width = argNumber(args, 'width', 0);
      const height = argNumber(args, 'height', 0);
      await this.deps.pageController.setViewport(width, height);
      return R.ok().build({ viewport: { width, height } });
    } catch (e) {
      return R.fail(e).build();
    }
  }

  async handlePageEmulateDevice(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const device = argString(args, 'device', '') as 'iPhone' | 'iPad' | 'Android';
      await this.deps.pageController.emulateDevice(device);
      return R.ok().build({ device });
    } catch (e) {
      return R.fail(e).build();
    }
  }

  async handlePageGetLocalStorage(_args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const storage = await this.deps.pageController.getLocalStorage();
      return R.ok().build({ count: Object.keys(storage).length, storage });
    } catch (e) {
      return R.fail(e).build();
    }
  }

  async handlePageSetLocalStorage(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const key = argString(args, 'key', '');
      const value = argString(args, 'value', '');
      await this.deps.pageController.setLocalStorage(key, value);
      return R.ok().build({ key });
    } catch (e) {
      return R.fail(e).build();
    }
  }
}
