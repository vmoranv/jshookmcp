import type { DOMInspector } from '../../../../modules/collector/DOMInspector.js';

interface DOMQueryHandlersDeps {
  domInspector: DOMInspector;
}

export class DOMQueryHandlers {
  constructor(private deps: DOMQueryHandlersDeps) {}

  async handleDOMQuerySelector(args: Record<string, unknown>) {
    const selector = args.selector as string;
    const getAttributes = (args.getAttributes as boolean) ?? true;

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
    const selector = args.selector as string;
    const limit = (args.limit as number) ?? 100;

    const elements = await this.deps.domInspector.querySelectorAll(selector, limit);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              count: elements.length,
              elements,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handleDOMGetStructure(args: Record<string, unknown>) {
    const maxDepth = (args.maxDepth as number) ?? 3;
    const includeText = (args.includeText as boolean) ?? true;

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
    const filterText = args.filterText as string | undefined;

    const clickable = await this.deps.domInspector.findClickable(filterText);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              count: clickable.length,
              elements: clickable,
            },
            null,
            2
          ),
        },
      ],
    };
  }
}
