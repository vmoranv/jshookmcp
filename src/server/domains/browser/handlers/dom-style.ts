import type { DOMInspector } from '@server/domains/shared/modules';
import { argString } from '@server/domains/shared/parse-args';
import { R } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/domains/shared/ResponseBuilder';

interface DOMStyleHandlersDeps {
  domInspector: DOMInspector;
}

export class DOMStyleHandlers {
  constructor(private deps: DOMStyleHandlersDeps) {}

  async handleDOMGetComputedStyle(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const selector = argString(args, 'selector', '');
      const styles = await this.deps.domInspector.getComputedStyle(selector);

      return R.ok().build({
        selector,
        styles,
      });
    } catch (e) {
      return R.fail(e).build();
    }
  }

  async handleDOMIsInViewport(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const selector = argString(args, 'selector', '');
      const inViewport = await this.deps.domInspector.isInViewport(selector);

      return R.ok().build({
        selector,
        inViewport,
      });
    } catch (e) {
      return R.fail(e).build();
    }
  }
}
