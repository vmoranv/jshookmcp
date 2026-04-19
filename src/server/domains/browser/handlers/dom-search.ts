import type { DOMInspector } from '@server/domains/shared/modules';
import { argString } from '@server/domains/shared/parse-args';
import { R } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/domains/shared/ResponseBuilder';

interface DOMSearchHandlersDeps {
  domInspector: DOMInspector;
}

export class DOMSearchHandlers {
  constructor(private deps: DOMSearchHandlersDeps) {}

  async handleDOMFindByText(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const text = argString(args, 'text', '');
      const tag = argString(args, 'tag');

      const elements = await this.deps.domInspector.findByText(text, tag);

      return R.ok().build({
        count: elements.length,
        elements,
      });
    } catch (e) {
      return R.fail(e).build();
    }
  }

  async handleDOMGetXPath(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const selector = argString(args, 'selector', '');
      const xpath = await this.deps.domInspector.getXPath(selector);

      return R.ok().build({
        selector,
        xpath,
      });
    } catch (e) {
      return R.fail(e).build();
    }
  }
}
