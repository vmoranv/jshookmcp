import type { DOMInspector } from '../../../../modules/collector/DOMInspector.js';

interface DOMSearchHandlersDeps {
  domInspector: DOMInspector;
}

export class DOMSearchHandlers {
  constructor(private deps: DOMSearchHandlersDeps) {}

  async handleDOMFindByText(args: Record<string, unknown>) {
    const text = args.text as string;
    const tag = args.tag as string | undefined;

    const elements = await this.deps.domInspector.findByText(text, tag);

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

  async handleDOMGetXPath(args: Record<string, unknown>) {
    const selector = args.selector as string;

    const xpath = await this.deps.domInspector.getXPath(selector);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              selector,
              xpath,
            },
            null,
            2
          ),
        },
      ],
    };
  }
}
