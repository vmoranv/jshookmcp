import {
  handleHeapSnapshotCapture,
  handleHeapSearch,
} from '@server/domains/v8-inspector/handlers/heap-snapshot';
import { handleBytecodeExtract } from '@server/domains/v8-inspector/handlers/bytecode-extract';
import { handleJitInspect } from '@server/domains/v8-inspector/handlers/jit-inspect';

interface PageControllerLike {
  getPage(): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPageControllerLike(value: unknown): value is PageControllerLike {
  return isRecord(value) && typeof value['getPage'] === 'function';
}

export class V8InspectorHandlers {
  private lastSnapshot: string | null = null;

  constructor(private readonly pageController?: unknown) {}

  async handleHeapSnapshotCapture(args: Record<string, unknown>): Promise<unknown> {
    return handleHeapSnapshotCapture(args, {
      getPage: () => this.getPage(),
      getSnapshot: () => this.lastSnapshot,
      setSnapshot: (snapshot) => {
        this.lastSnapshot = snapshot;
      },
    });
  }

  async handleHeapSearch(args: Record<string, unknown>): Promise<unknown> {
    return handleHeapSearch(args, {
      getPage: () => this.getPage(),
      getSnapshot: () => this.lastSnapshot,
      setSnapshot: (snapshot) => {
        this.lastSnapshot = snapshot;
      },
    });
  }

  async handleBytecodeExtract(args: Record<string, unknown>): Promise<unknown> {
    return handleBytecodeExtract(args, {
      getPage: () => this.getPage(),
    });
  }

  async handleJitInspect(args: Record<string, unknown>): Promise<unknown> {
    return handleJitInspect(args, {
      getPage: () => this.getPage(),
    });
  }

  private async getPage(): Promise<unknown> {
    if (!isPageControllerLike(this.pageController)) {
      throw new Error('PageController is not available.');
    }
    return this.pageController.getPage();
  }
}
