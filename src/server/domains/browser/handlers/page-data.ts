import type { PageController } from '../../../../modules/collector/PageController.js';

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
  getCamoufoxPage: () => Promise<unknown>;
}

export class PageDataHandlers {
  constructor(private deps: PageDataHandlersDeps) {}

  async handlePageGetPerformance(_args: Record<string, unknown>) {
    const metrics = await this.deps.pageController.getPerformanceMetrics();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              metrics,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handlePageSetCookies(args: Record<string, unknown>) {
    const cookies = args.cookies as PageCookieInput[];

    await this.deps.pageController.setCookies(cookies);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: `Set ${cookies.length} cookies`,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handlePageGetCookies(_args: Record<string, unknown>) {
    const cookies = await this.deps.pageController.getCookies();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              count: cookies.length,
              cookies,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handlePageClearCookies(_args: Record<string, unknown>) {
    await this.deps.pageController.clearCookies();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: 'Cookies cleared',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handlePageSetViewport(args: Record<string, unknown>) {
    const width = args.width as number;
    const height = args.height as number;

    await this.deps.pageController.setViewport(width, height);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              viewport: { width, height },
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handlePageEmulateDevice(args: Record<string, unknown>) {
    const device = args.device as 'iPhone' | 'iPad' | 'Android';

    await this.deps.pageController.emulateDevice(device);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              device,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handlePageGetLocalStorage(_args: Record<string, unknown>) {
    const storage = await this.deps.pageController.getLocalStorage();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              count: Object.keys(storage).length,
              storage,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handlePageSetLocalStorage(args: Record<string, unknown>) {
    const key = args.key as string;
    const value = args.value as string;

    await this.deps.pageController.setLocalStorage(key, value);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              key,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handlePageGetAllLinks(_args: Record<string, unknown>) {
    const links = await this.deps.pageController.getAllLinks();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              count: links.length,
              links,
            },
            null,
            2
          ),
        },
      ],
    };
  }
}
