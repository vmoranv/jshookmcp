import { describe, expect, it, vi, beforeEach } from 'vitest';
import manifest from '@server/domains/workflow/manifest';
import { workflowToolDefinitions } from '@server/domains/workflow/definitions';
import type { MCPServerContext } from '@server/domains/shared/registry';
import { WorkflowHandlers } from '@server/domains/workflow/index';

// Mock dependencies
vi.mock('@server/domains/shared/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@server/domains/shared/registry')>();
  return {
    ...actual,
    bindByDepKey: (_key: string, fn: any) => fn,
    ensureBrowserCore: vi.fn(),
  };
});

describe('Workflow Domain Manifest', () => {
  let mockContext: MCPServerContext;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock class methods instead of module to avoid re-export issues
    vi.spyOn(WorkflowHandlers.prototype, 'handlePageScriptRegister').mockResolvedValue(
      undefined as any,
    );
    vi.spyOn(WorkflowHandlers.prototype, 'handlePageScriptRun').mockResolvedValue(undefined as any);
    vi.spyOn(WorkflowHandlers.prototype, 'handleApiProbeBatch').mockResolvedValue(undefined as any);
    vi.spyOn(WorkflowHandlers.prototype, 'handleJsBundleSearch').mockResolvedValue(
      undefined as any,
    );
    vi.spyOn(WorkflowHandlers.prototype, 'handleListExtensionWorkflows').mockResolvedValue(
      undefined as any,
    );
    vi.spyOn(WorkflowHandlers.prototype, 'handleRunExtensionWorkflow').mockResolvedValue(
      undefined as any,
    );

    mockContext = {
      handlerDeps: {
        browserHandlers: {} as any,
        advancedHandlers: {} as any,
      },
    } as unknown as MCPServerContext;
  });

  describe('ensure()', () => {
    it('creates and returns workflowHandlers if not present in context', async () => {
      const handlers = await await manifest.ensure(mockContext);
      expect(handlers).toBeDefined();
      expect(mockContext.workflowHandlers).toBe(handlers);
    });

    it('returns existing workflowHandlers from context', async () => {
      const existingHandlers = new WorkflowHandlers({} as any);
      mockContext.workflowHandlers = existingHandlers;

      const handlers = await await manifest.ensure(mockContext);
      expect(handlers).toBe(existingHandlers);
      // Wait, WorkflowHandlers constructor is called once above, we should check it wasn't called AGAIN
      // Actually we clear mocks before each. But we called `new WorkflowHandlers()` here. So it was called.
      // Let's just check equality.
    });
  });

  describe('registrations', () => {
    it('binds all defined tools correctly', async () => {
      const handlers = await await manifest.ensure(mockContext);

      for (const reg of manifest.registrations) {
        expect(reg.tool).toBeDefined();

        // Find corresponding definition
        const def = workflowToolDefinitions.find((d) => d.name === reg.tool.name);
        expect(def).toBeDefined();

        // Execute the bound function and verify it calls the right handler method
        // Extract the method name from the reg array by mapping tool names to method names
        const methodNameMap: Record<string, string> = {
          page_script_register: 'handlePageScriptRegister',
          page_script_run: 'handlePageScriptRun',
          api_probe_batch: 'handleApiProbeBatch',
          js_bundle_search: 'handleJsBundleSearch',
          list_extension_workflows: 'handleListExtensionWorkflows',
          run_extension_workflow: 'handleRunExtensionWorkflow',
        };

        const methodName = methodNameMap[reg.tool.name];
        expect(methodName).toBeDefined();

        const args = { anyArg: 'value' };
        // @ts-ignore
        await reg.bind(handlers, args);

        // @ts-ignore - indexing mock object
        expect(handlers[methodName]).toHaveBeenCalled();
      }
    });
  });
});
