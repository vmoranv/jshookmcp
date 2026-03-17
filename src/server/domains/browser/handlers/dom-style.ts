import type { DOMInspector } from '@server/domains/shared/modules';
import { argString } from '@server/domains/shared/parse-args';

interface DOMStyleHandlersDeps {
  domInspector: DOMInspector;
}

export class DOMStyleHandlers {
  constructor(private deps: DOMStyleHandlersDeps) {}

  async handleDOMGetComputedStyle(args: Record<string, unknown>) {
    const selector = argString(args, 'selector', '');

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
    const selector = argString(args, 'selector', '');

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
