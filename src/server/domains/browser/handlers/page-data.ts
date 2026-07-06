import type { PageController } from '@server/domains/shared/modules/collector';
import { argString, argNumber } from '@server/domains/shared/parse-args';
import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';

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
  getCamoufoxPage?: () => Promise<unknown>;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter(
    (item): item is string => typeof item === 'string' && item.length > 0,
  );
  return strings.length > 0 ? strings : undefined;
}

export class PageDataHandlers {
  constructor(private deps: PageDataHandlersDeps) {}

  private safeOrigin(url: string): string | null {
    try {
      return new URL(url).origin;
    } catch {
      return null;
    }
  }

  private async listCamoufoxFrames() {
    const getCamoufoxPage = this.deps.getCamoufoxPage;
    if (!getCamoufoxPage) {
      throw new Error('Camoufox page is not available');
    }

    const page = (await getCamoufoxPage()) as {
      mainFrame(): {
        url(): string;
      };
      frames(): Array<{
        url(): string;
        name(): string;
        parentFrame(): { url(): string } | null;
      }>;
    };
    const frames = page.frames();
    const mainFrame = page.mainFrame();
    const mainOrigin = this.safeOrigin(mainFrame.url());

    return frames.map((frame, index) => {
      const parentFrame = frame.parentFrame();
      const frameOrigin = this.safeOrigin(frame.url());
      const parentIndex = parentFrame
        ? frames.findIndex((candidate) => candidate === parentFrame)
        : -1;

      return {
        frameId: `frame-${index}`,
        url: frame.url(),
        name: frame.name() || '',
        parentFrameId: parentIndex >= 0 ? `frame-${parentIndex}` : null,
        parentUrl: parentFrame?.url() || null,
        isMainFrame: frame === mainFrame,
        crossOrigin: Boolean(
          frame !== mainFrame && frameOrigin && mainOrigin && frameOrigin !== mainOrigin,
        ),
      };
    });
  }

  async handlePageListFrames(_args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const frames =
        this.deps.getActiveDriver() === 'camoufox'
          ? await this.listCamoufoxFrames()
          : await this.deps.pageController.listFrames();
      return { count: frames.length, frames };
    });
  }

  async handleGetContent(_args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const html = await this.deps.pageController.getContent();
      return { html };
    });
  }

  async handleGetTitle(_args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const title = await this.deps.pageController.getTitle();
      return { title };
    });
  }

  async handleGetUrl(_args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const url = await this.deps.pageController.getURL();
      return { url };
    });
  }

  async handleGetText(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const selector = argString(args, 'selector', '');
      const text = await this.deps.pageController.evaluate(
        `document.querySelector(${JSON.stringify(selector)})?.textContent || ""`,
      );
      return { selector, text };
    });
  }

  async handleGetOuterHtml(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const selector = argString(args, 'selector', '');
      const html = await this.deps.pageController.evaluate(
        `document.querySelector(${JSON.stringify(selector)})?.outerHTML || ""`,
      );
      return { selector, html };
    });
  }

  async handleGetScrollPosition(_args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const pos = (await this.deps.pageController.evaluate(`({
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        maxScrollX: document.documentElement.scrollWidth - window.innerWidth,
        maxScrollY: document.documentElement.scrollHeight - window.innerHeight
      })`)) as { scrollX: number; scrollY: number; maxScrollX: number; maxScrollY: number };
      return pos;
    });
  }

  async handlePageSetCookies(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const cookies = args.cookies as PageCookieInput[];
      await this.deps.pageController.setCookies(cookies);
      return { message: `Set ${cookies.length} cookies` };
    });
  }

  async handlePageGetCookies(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const urls = readStringArray(args.urls);
      const cookies = await this.deps.pageController.getCookies(urls ? { urls } : undefined);
      return { count: cookies.length, cookies };
    });
  }

  async getPageCookieCount(): Promise<number> {
    const cookies = await this.deps.pageController.getCookies();
    return cookies.length;
  }

  async handlePageClearCookies(_args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      await this.deps.pageController.clearCookies();
      return { message: 'Cookies cleared' };
    });
  }

  async handlePageSetViewport(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const width = argNumber(args, 'width', 0);
      const height = argNumber(args, 'height', 0);
      await this.deps.pageController.setViewport(width, height);
      return { viewport: { width, height } };
    });
  }

  async handlePageEmulateDevice(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const device = argString(args, 'device', '') as 'iPhone' | 'iPad' | 'Android';
      await this.deps.pageController.emulateDevice(device);
      return { device };
    });
  }

  async handlePageGetLocalStorage(_args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const storage = await this.deps.pageController.getLocalStorage();
      return { count: Object.keys(storage).length, storage };
    });
  }

  async handlePageSetLocalStorage(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const key = argString(args, 'key', '');
      const value = argString(args, 'value', '');
      await this.deps.pageController.setLocalStorage(key, value);
      return { key };
    });
  }

  async handlePageClearLocalStorage(): Promise<ToolResponse> {
    return handleSafe(async () => {
      await this.deps.pageController.clearLocalStorage();
      return { message: 'localStorage cleared' };
    });
  }

  async handlePageGetSessionStorage(_args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const storage = await this.deps.pageController.getSessionStorage();
      return { count: Object.keys(storage).length, storage };
    });
  }

  async handlePageSetSessionStorage(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const key = argString(args, 'key', '');
      const value = argString(args, 'value', '');
      await this.deps.pageController.setSessionStorage(key, value);
      return { key };
    });
  }

  async handlePageClearSessionStorage(): Promise<ToolResponse> {
    return handleSafe(async () => {
      await this.deps.pageController.clearSessionStorage();
      return { message: 'sessionStorage cleared' };
    });
  }

  async handleBrowserPasskeySeed(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const relyingPartyId = argString(args, 'relyingPartyId', '');
      const credentialId = argString(args, 'credentialId', '');
      const userHandle = argString(args, 'userHandle', '');
      const privateKey = argString(args, 'privateKey', '');
      const publicKey = argString(args, 'publicKey', '');
      const userDisplayName = argString(args, 'userDisplayName', '');
      if (!relyingPartyId || !credentialId || !userHandle || !privateKey) {
        throw new Error('relyingPartyId, credentialId, userHandle and privateKey are required');
      }
      const result = await this.deps.pageController.seedWebAuthnCredential({
        relyingPartyId,
        credentialId,
        userHandle,
        privateKey,
        publicKey: publicKey || undefined,
        userDisplayName: userDisplayName || undefined,
      });
      return { seeded: true, ...result };
    });
  }
}
