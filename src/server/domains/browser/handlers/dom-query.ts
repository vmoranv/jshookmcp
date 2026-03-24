import type { DOMInspector } from '@server/domains/shared/modules';
import { argString, argNumber, argBool } from '@server/domains/shared/parse-args';

interface DOMQueryHandlersDeps {
  domInspector: DOMInspector;
}

export class DOMQueryHandlers {
  constructor(private deps: DOMQueryHandlersDeps) {}

  async handleDOMQuerySelector(args: Record<string, unknown>) {
    const selector = argString(args, 'selector', '');
    const getAttributes = argBool(args, 'getAttributes', true);

    const element = await this.deps.domInspector.querySelector(selector, getAttributes);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(element, null, 2),
        },
      ],
    };
  }

  async handleDOMQueryAll(args: Record<string, unknown>) {
    const selector = argString(args, 'selector', '');
    const limit = argNumber(args, 'limit', 100);

    const result = await this.deps.domInspector.querySelectorAll(selector, limit);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              count: result.elements.length,
              elements: result.elements,
              diagnostics: result.diagnostics,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handleDOMGetStructure(args: Record<string, unknown>) {
    const MAX_DOM_DEPTH = 4;
    const maxDepth = Math.min(argNumber(args, 'maxDepth', 3), MAX_DOM_DEPTH);
    const includeText = argBool(args, 'includeText', true);

    const structure = await this.deps.domInspector.getStructure(maxDepth, includeText);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(structure, null, 2),
        },
      ],
    };
  }

  async handleDOMFindClickable(args: Record<string, unknown>) {
    const filterText = argString(args, 'filterText');

    const result = await this.deps.domInspector.findClickable(filterText);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              count: result.elements.length,
              elements: result.elements,
              diagnostics: result.diagnostics,
            },
            null,
            2
          ),
        },
      ],
    };
  }
}
