import type { DOMInspector } from '@server/domains/shared/modules';
import { argString, argNumber, argBool } from '@server/domains/shared/parse-args';
import { R } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/domains/shared/ResponseBuilder';

interface DOMQueryHandlersDeps {
  domInspector: DOMInspector;
}

export class DOMQueryHandlers {
  constructor(private deps: DOMQueryHandlersDeps) {}

  async handleDOMQuerySelector(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const selector = argString(args, 'selector', '');
      const getAttributes = argBool(args, 'getAttributes', true);

      const element = await this.deps.domInspector.querySelector(selector, getAttributes);
      return R.ok()
        .merge((element as any) || {})
        .build();
    } catch (e) {
      return R.fail(e).build();
    }
  }

  async handleDOMQueryAll(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const selector = argString(args, 'selector', '');
      const limit = argNumber(args, 'limit', 100);

      const result = await this.deps.domInspector.querySelectorAll(selector, limit);

      return R.ok().build({
        count: result.elements.length,
        elements: result.elements,
        diagnostics: result.diagnostics,
      });
    } catch (e) {
      return R.fail(e).build();
    }
  }

  async handleDOMGetStructure(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const MAX_DOM_DEPTH = 4;
      const maxDepth = Math.min(argNumber(args, 'maxDepth', 3), MAX_DOM_DEPTH);
      const includeText = argBool(args, 'includeText', true);

      const structure = await this.deps.domInspector.getStructure(maxDepth, includeText);
      return R.ok()
        .merge((structure as any) || {})
        .build();
    } catch (e) {
      return R.fail(e).build();
    }
  }

  async handleDOMFindClickable(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const filterText = argString(args, 'filterText');

      const result = await this.deps.domInspector.findClickable(filterText);

      return R.ok().build({
        count: result.elements.length,
        elements: result.elements,
        diagnostics: result.diagnostics,
      });
    } catch (e) {
      return R.fail(e).build();
    }
  }
}
