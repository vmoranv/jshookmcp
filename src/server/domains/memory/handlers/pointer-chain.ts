import type { PointerChainEngine } from '@native/PointerChainEngine';
import type { PointerChain } from '@native/PointerChainEngine.types';
import type { UnifiedProcessManager } from '@server/domains/shared/modules/native';
import type { MCPServerContext } from '@server/MCPServer.context';
import { resolveMemoryDomainPid } from '@server/domains/memory/pid-resolver';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { argBool, argNumber, argStringArray } from '@server/domains/shared/parse-args';
import { parseJsonArg, validateHexAddress } from './validation';

const TOOL_POINTER_CHAIN = 'memory_pointer_chain';

export class PointerChainHandlers {
  constructor(
    private readonly ptrEngine: PointerChainEngine,
    private readonly processManager?: UnifiedProcessManager,
    private readonly ctx?: MCPServerContext,
  ) {}

  private async resolvePid(value: unknown): Promise<number> {
    if (!this.processManager) {
      return value as number;
    }
    return await resolveMemoryDomainPid(value, this.processManager, this.ctx);
  }

  async handlePointerChainScan(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const targetAddress = validateHexAddress(args.targetAddress, 'targetAddress');
      const result = await this.ptrEngine.scan(pid, targetAddress, {
        maxDepth: argNumber(args, 'maxDepth'),
        maxOffset: argNumber(args, 'maxOffset'),
        staticOnly: argBool(args, 'staticOnly', false),
        modules: argStringArray(args, 'modules'),
        maxResults: argNumber(args, 'maxResults'),
      });
      return {
        ...result,
        hint:
          result.totalFound > 0
            ? `Found ${result.totalFound} pointer chains. Static chains survive process restarts.`
            : 'No pointer chains found. Try increasing maxDepth or maxOffset.',
      };
    });
  }

  async handlePointerChainValidate(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const chains = parseJsonArg<PointerChain[]>(args.chains, 'chains', TOOL_POINTER_CHAIN);
      if (!Array.isArray(chains)) {
        throw new Error(
          `${TOOL_POINTER_CHAIN}: argument "chains" must be a JSON array of PointerChain objects, got: ${JSON.stringify(args.chains)}`,
        );
      }
      const results = await this.ptrEngine.validateChains(pid, chains);
      return {
        results,
        validCount: results.filter((r) => r.isValid).length,
        totalChecked: chains.length,
      };
    });
  }

  async handlePointerChainResolve(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const chain = parseJsonArg<PointerChain>(args.chain, 'chain', TOOL_POINTER_CHAIN);
      const resolved = await this.ptrEngine.resolveChain(pid, chain);
      return {
        chainId: chain.id,
        resolvedAddress: resolved,
        isResolvable: resolved !== null,
      };
    });
  }

  async handlePointerChainExport(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const chains = parseJsonArg<PointerChain[]>(args.chains, 'chains', TOOL_POINTER_CHAIN);
      if (!Array.isArray(chains)) {
        throw new Error(
          `${TOOL_POINTER_CHAIN}: argument "chains" must be a JSON array of PointerChain objects, got: ${JSON.stringify(args.chains)}`,
        );
      }
      return {
        exportedData: this.ptrEngine.exportChains(chains),
        chainCount: chains.length,
      };
    });
  }
}
