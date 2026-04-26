import type {
  CdpSessionLike,
  ExtensionTarget,
  TextToolResponse,
} from '@server/domains/sourcemap/handlers.impl.sourcemap-parse-base';
import { SourcemapToolHandlersCommon } from '@server/domains/sourcemap/handlers.impl.sourcemap-common';
import {
  attachToFlatTarget,
  detachFromFlatTarget,
  type FlatSessionParentLike,
} from '@modules/browser/flat-target-session';

export class SourcemapToolHandlersExtension extends SourcemapToolHandlersCommon {
  async handleExtensionListInstalled(_args: Record<string, unknown>): Promise<TextToolResponse> {
    const page = await this.collector.getActivePage();
    const session = (await page.createCDPSession()) as unknown as CdpSessionLike;

    try {
      const targets = await this.getExtensionTargets(session);
      const result = targets.map((target) => ({
        extensionId: target.extensionId,
        name: target.name,
        type: target.type,
        url: target.url,
      }));
      return this.json(result);
    } catch (error) {
      return this.fail('extension_list_installed', error);
    } finally {
      await this.safeDetach(session);
    }
  }

  async handleExtensionExecuteInContext(args: Record<string, unknown>): Promise<TextToolResponse> {
    const extensionId = this.requiredStringArg(args.extensionId, 'extensionId');
    const code = this.requiredStringArg(args.code, 'code');
    const returnByValue = this.parseBooleanArg(args.returnByValue, true);

    const page = await this.collector.getActivePage();
    const session = (await page.createCDPSession()) as unknown as FlatSessionParentLike;
    let attachedSession: CdpSessionLike | null = null;

    try {
      const targets = await this.getExtensionTargets(session, extensionId);
      if (targets.length === 0) {
        throw new Error(`No background target found for extension: ${extensionId}`);
      }

      const preferred = this.pickPreferredExtensionTarget(targets);
      attachedSession = (await attachToFlatTarget(
        session,
        preferred.targetId,
      )) as unknown as CdpSessionLike;

      const evaluation = await this.evaluateInAttachedTarget(attachedSession, code, returnByValue);

      return this.json({
        extensionId,
        target: {
          type: preferred.type,
          url: preferred.url,
          name: preferred.name,
        },
        result: evaluation.result,
        exceptionDetails: evaluation.exceptionDetails,
      });
    } catch (error) {
      return this.fail('extension_execute_in_context', error);
    } finally {
      if (attachedSession) {
        await detachFromFlatTarget(session, attachedSession).catch(() => undefined);
      }
      await this.safeDetach(session);
    }
  }

  protected async getExtensionTargets(
    session: CdpSessionLike,
    expectedExtensionId?: string,
  ): Promise<ExtensionTarget[]> {
    const response = this.asRecord(await session.send('Target.getTargets'));
    const targetInfos = Array.isArray(response.targetInfos) ? response.targetInfos : [];

    const allowedTypes = new Set(['service_worker', 'background_page']);
    const result: ExtensionTarget[] = [];

    for (const item of targetInfos) {
      const record = this.asRecord(item);
      const targetId = this.asString(record.targetId);
      const type = this.asString(record.type);
      const url = this.asString(record.url);

      if (!targetId || !type || !url) {
        continue;
      }

      if (!allowedTypes.has(type)) {
        continue;
      }

      const extensionId = this.extractExtensionId(url);
      if (!extensionId) {
        continue;
      }

      if (expectedExtensionId && extensionId !== expectedExtensionId) {
        continue;
      }

      const title = this.asString(record.title) ?? '';
      result.push({
        targetId,
        extensionId,
        name: title || extensionId,
        type: type as 'service_worker' | 'background_page',
        url,
      });
    }

    result.sort((left, right) => {
      const leftScore = left.type === 'service_worker' ? 0 : 1;
      const rightScore = right.type === 'service_worker' ? 0 : 1;
      if (leftScore !== rightScore) {
        return leftScore - rightScore;
      }
      return left.extensionId.localeCompare(right.extensionId);
    });

    return result;
  }

  protected pickPreferredExtensionTarget(targets: ExtensionTarget[]): ExtensionTarget {
    const serviceWorker = targets.find((target) => target.type === 'service_worker');
    return serviceWorker ?? targets[0]!;
  }

  protected extractExtensionId(url: string): string | null {
    const match = url.match(/^chrome-extension:\/\/([a-p]{32})(?:\/|$)/i);
    return match?.[1] ?? null;
  }

  protected async evaluateInAttachedTarget(
    session: CdpSessionLike,
    code: string,
    returnByValue: boolean,
  ): Promise<{ result: unknown; exceptionDetails: unknown }> {
    const response = this.asRecord(
      await session.send('Runtime.evaluate', {
        expression: code,
        returnByValue,
        awaitPromise: true,
      }),
    );
    const resultEnvelope = this.asRecord(response.result);

    return {
      result:
        returnByValue && resultEnvelope.value !== undefined
          ? resultEnvelope.value
          : Object.keys(resultEnvelope).length > 0
            ? resultEnvelope
            : null,
      exceptionDetails: response.exceptionDetails !== undefined ? response.exceptionDetails : null,
    };
  }
}
