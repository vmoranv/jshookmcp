import { describe, expect, it, vi, beforeEach } from 'vitest';
import manifest from '@server/domains/workflow/manifest';
import { workflowToolDefinitions } from '@server/domains/workflow/definitions';
import { macroTools } from '@server/domains/workflow/macro/definitions';
import type { MCPServerContext } from '@server/domains/shared/registry';
import { WorkflowHandlers } from '@server/domains/workflow/index';
import { MacroToolHandlers } from '@server/domains/workflow/macro';

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

  it('keeps merged macro tools full-only', () => {
    const macroRegistrations = manifest.registrations.filter((registration) =>
      ['run_macro', 'list_macros'].includes(registration.tool.name),
    );

    expect(macroRegistrations).toHaveLength(2);
    for (const registration of macroRegistrations) {
      expect(registration.profiles).toEqual(['full']);
    }
  });

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
    vi.spyOn(WorkflowHandlers.prototype, 'handleReverseSession').mockResolvedValue(
      undefined as any,
    );
    vi.spyOn(WorkflowHandlers.prototype, 'handleWorkflowRunInspect').mockResolvedValue(
      undefined as any,
    );
    vi.spyOn(MacroToolHandlers.prototype, 'handleRunMacro').mockResolvedValue(undefined as any);
    vi.spyOn(MacroToolHandlers.prototype, 'handleListMacros').mockResolvedValue(undefined as any);

    mockContext = {
      handlerDeps: {
        browserHandlers: {} as any,
        advancedHandlers: {} as any,
      },
    } as unknown as MCPServerContext;
  });

  describe('ensure()', () => {
    it('creates and returns workflowHandlers if not present in context', async () => {
      const handlers = await manifest.ensure(mockContext);
      expect(handlers).toBeDefined();
      expect(mockContext.workflowHandlers).toBe(handlers);
    });

    it('returns existing workflowHandlers from context', async () => {
      const existingHandlers = new WorkflowHandlers({} as any);
      mockContext.workflowHandlers = existingHandlers;

      const handlers = await manifest.ensure(mockContext);
      expect(handlers).toBe(existingHandlers);
      // Wait, WorkflowHandlers constructor is called once above, we should check it wasn't called AGAIN
      // Actually we clear mocks before each. But we called `new WorkflowHandlers()` here. So it was called.
      // Let's just check equality.
    });
  });

  describe('registrations', () => {
    it('binds all defined tools correctly', async () => {
      const handlers = await manifest.ensure(mockContext);

      for (const reg of manifest.registrations) {
        expect(reg.tool).toBeDefined();

        // Find corresponding definition (workflow or macro)
        const allDefs = [...workflowToolDefinitions, ...macroTools];
        const def = allDefs.find((d) => d.name === reg.tool.name);
        expect(def).toBeDefined();

        const methodNameMap: Record<string, string> = {
          page_script_register: 'handlePageScriptRegister',
          page_script_run: 'handlePageScriptRun',
          api_probe_batch: 'handleApiProbeBatch',
          js_bundle_search: 'handleJsBundleSearch',
          list_extension_workflows: 'handleListExtensionWorkflows',
          run_extension_workflow: 'handleRunExtensionWorkflow',
          reverse_session: 'handleReverseSession',
          workflow_run_inspect: 'handleWorkflowRunInspect',
          run_macro: 'handleRunMacro',
          list_macros: 'handleListMacros',
        };

        const methodName = methodNameMap[reg.tool.name];
        expect(methodName).toBeDefined();

        const args = { anyArg: 'value' };
        const macroHandlers = mockContext.macroHandlers as any;
        const depContainer = {
          workflowHandlers: handlers as any,
          macroHandlers: macroHandlers as any,
        };
        await reg.bind(depContainer)(args as any);

        // Check the right handler was called
        const isMacroTool = reg.tool.name === 'run_macro' || reg.tool.name === 'list_macros';
        if (isMacroTool) {
          // @ts-ignore
          expect(macroHandlers[methodName]).toHaveBeenCalled();
        } else {
          // @ts-ignore - indexing mock object
          expect(handlers[methodName]).toHaveBeenCalled();
        }
      }
    });
  });

  it('keeps reverse_session exposed through workflow as a full-only registration', () => {
    const reverseRegistration = manifest.registrations.find(
      (registration) => registration.tool.name === 'reverse_session',
    );

    expect(workflowToolDefinitions.map((tool) => tool.name)).toContain('reverse_session');
    expect(reverseRegistration?.profiles).toEqual(['full']);
    expect(manifest.workflowRule?.tools).toContain('reverse_session');
    expect(manifest.domain).toBe('workflow');
  });
});
