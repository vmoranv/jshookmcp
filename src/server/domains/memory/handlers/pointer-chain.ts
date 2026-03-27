/**
 * PointerChainHandlers — pointer chain scan, validate, resolve, export.
 */
import type { PointerChainEngine } from '@native/PointerChainEngine';
import type { PointerChain } from '@native/PointerChainEngine.types';

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

export class PointerChainHandlers {
  constructor(private readonly ptrEngine: PointerChainEngine) {}

  async handlePointerChainScan(args: Record<string, unknown>) {
    try {
      const result = await this.ptrEngine.scan(args.pid as number, args.targetAddress as string, {
        maxDepth: args.maxDepth as number | undefined,
        maxOffset: args.maxOffset as number | undefined,
        staticOnly: args.staticOnly as boolean | undefined,
        modules: args.modules as string[] | undefined,
        maxResults: args.maxResults as number | undefined,
      });
      return toTextResponse({
        success: true,
        ...result,
        hint:
          result.totalFound > 0
            ? `Found ${result.totalFound} pointer chains. Static chains survive process restarts.`
            : 'No pointer chains found. Try increasing maxDepth or maxOffset.',
      });
    } catch (error) {
      return toErrorResponse('memory_pointer_chain_scan', error);
    }
  }

  async handlePointerChainValidate(args: Record<string, unknown>) {
    try {
      const chains = JSON.parse(args.chains as string) as PointerChain[];
      const results = await this.ptrEngine.validateChains(args.pid as number, chains);
      return toTextResponse({
        success: true,
        results,
        validCount: results.filter((r) => r.isValid).length,
        totalChecked: chains.length,
      });
    } catch (error) {
      return toErrorResponse('memory_pointer_chain_validate', error);
    }
  }

  async handlePointerChainResolve(args: Record<string, unknown>) {
    try {
      const chain = JSON.parse(args.chain as string) as PointerChain;
      const resolved = await this.ptrEngine.resolveChain(args.pid as number, chain);
      return toTextResponse({
        success: true,
        chainId: chain.id,
        resolvedAddress: resolved,
        isResolvable: resolved !== null,
      });
    } catch (error) {
      return toErrorResponse('memory_pointer_chain_resolve', error);
    }
  }

  async handlePointerChainExport(args: Record<string, unknown>) {
    try {
      const chains = JSON.parse(args.chains as string) as PointerChain[];
      return toTextResponse({
        success: true,
        exportedData: this.ptrEngine.exportChains(chains),
        chainCount: chains.length,
      });
    } catch (error) {
      return toErrorResponse('memory_pointer_chain_export', error);
    }
  }
}
