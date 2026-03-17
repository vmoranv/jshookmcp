import type { DOMInspector } from '@server/domains/shared/modules';
import { argString } from '@server/domains/shared/parse-args';

interface DOMSearchHandlersDeps {
  domInspector: DOMInspector;
}

export class DOMSearchHandlers {
  constructor(private deps: DOMSearchHandlersDeps) {}

  async handleDOMFindByText(args: Record<string, unknown>) {
    const text = argString(args, 'text', '');
    const tag = argString(args, 'tag');

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
    const selector = argString(args, 'selector', '');

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
