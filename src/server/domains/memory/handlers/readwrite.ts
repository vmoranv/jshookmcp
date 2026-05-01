/**
 * ReadWriteHandlers — memory reads, writes, freeze, undo/redo.
 */
import type { MemoryController } from '@native/MemoryController';

function toTextResponse(payload: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function toErrorResponse(tool: string, error: unknown) {
  return toTextResponse({
    success: false,
    tool,
    error: error instanceof Error ? error.message : String(error),
  });
}

export class ReadWriteHandlers {
  constructor(private readonly memCtrl: MemoryController) {}

  async handleWriteValue(args: Record<string, unknown>) {
    try {
      const entry = await this.memCtrl.writeValue(
        args.pid as number,
        args.address as string,
        args.value as string,
        args.valueType as string,
      );
      return toTextResponse({
        success: true,
        ...entry,
        hint: "Use memory_write_history with action='undo' to revert.",
      });
    } catch (error) {
      return toErrorResponse('memory_write_value', error);
    }
  }

  async handleFreeze(args: Record<string, unknown>) {
    try {
      const entry = await this.memCtrl.freeze(
        args.pid as number,
        args.address as string,
        args.value as string,
        args.valueType as string,
        args.intervalMs as number | undefined,
      );
      return toTextResponse({
        success: true,
        ...entry,
        hint: `Frozen. Use memory_freeze with action="unfreeze" and freezeId "${entry.id}" to stop.`,
      });
    } catch (error) {
      return toErrorResponse('memory_freeze', error);
    }
  }

  async handleUnfreeze(args: Record<string, unknown>) {
    try {
      return toTextResponse({
        success: true,
        unfrozen: await this.memCtrl.unfreeze(args.freezeId as string),
      });
    } catch (error) {
      return toErrorResponse('memory_freeze', error);
    }
  }

  async handleDump(args: Record<string, unknown>) {
    try {
      const hexDump = await this.memCtrl.dumpMemoryHex(
        args.pid as number,
        args.address as string,
        (args.size as number) ?? 256,
      );
      return toTextResponse({ success: true, dump: hexDump });
    } catch (error) {
      return toErrorResponse('memory_dump', error);
    }
  }

  async handleWriteUndo(_args: Record<string, unknown>) {
    try {
      const entry = await this.memCtrl.undo();
      return toTextResponse({ success: true, undone: entry !== null, entry });
    } catch (error) {
      return toErrorResponse('memory_write_history', error);
    }
  }

  async handleWriteRedo(_args: Record<string, unknown>) {
    try {
      const entry = await this.memCtrl.redo();
      return toTextResponse({ success: true, redone: entry !== null, entry });
    } catch (error) {
      return toErrorResponse('memory_write_history', error);
    }
  }
}
