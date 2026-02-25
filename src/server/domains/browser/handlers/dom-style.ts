import type { DOMInspector } from '../../../../modules/collector/DOMInspector.js';

interface DOMStyleHandlersDeps {
  domInspector: DOMInspector;
}

export class DOMStyleHandlers {
  constructor(private deps: DOMStyleHandlersDeps) {}

  async handleDOMGetComputedStyle(args: Record<string, unknown>) {
    const selector = args.selector as string;

    const styles = await this.deps.domInspector.getComputedStyle(selector);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              selector,
              styles,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handleDOMIsInViewport(args: Record<string, unknown>) {
    const selector = args.selector as string;

    const inViewport = await this.deps.domInspector.isInViewport(selector);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              selector,
              inViewport,
            },
            null,
            2
          ),
        },
      ],
    };
  }
}
