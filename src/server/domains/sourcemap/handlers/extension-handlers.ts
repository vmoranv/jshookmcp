/**
 * Extension-related sub-handler for sourcemap domain.
 */

import type {
  CdpSessionLike,
  ExtensionTarget,
  TextToolResponse,
  SourcemapSharedState,
} from './shared';
import {
  attachToFlatTarget,
  detachFromFlatTarget,
  type FlatSessionParentLike,
} from '@modules/browser/flat-target-session';
import type { CDPSessionLike as BrowserCDPSessionLike } from '@modules/browser/CDPSessionLike';
import {
  asRecord,
  asString,
  requiredStringArg,
  parseBooleanArg,
  safeDetach,
  json,
  fail,
} from './shared';

export class ExtensionHandlers {
  private state: SourcemapSharedState;

  constructor(state: SourcemapSharedState) {
    this.state = state;
  }

  async handleExtensionListInstalled(_args: Record<string, unknown>): Promise<TextToolResponse> {
    const page = await this.state.collector.getActivePage();
    const session = (await page.createCDPSession()) as unknown as CdpSessionLike;
    try {
      const targets = await this.getExtensionTargets(session);
      const result = targets.map((target) => ({
        extensionId: target.extensionId,
        name: target.name,
        type: target.type,
        url: target.url,
      }));
      return json(result);
    } catch (error) {
      return fail('extension_list_installed', error);
    } finally {
      await safeDetach(session);
    }
  }

  async handleExtensionExecuteInContext(args: Record<string, unknown>): Promise<TextToolResponse> {
    const extensionId = requiredStringArg(args.extensionId, 'extensionId');
    const code = requiredStringArg(args.code, 'code');
    const returnByValue = parseBooleanArg(args.returnByValue, true);

    const page = await this.state.collector.getActivePage();
    const session = (await page.createCDPSession()) as unknown as FlatSessionParentLike;
    let attachedSession: BrowserCDPSessionLike | null = null;

    try {
      const targets = await this.getExtensionTargets(session, extensionId);
      if (targets.length === 0)
        throw new Error(`No background target found for extension: ${extensionId}`);

      const preferred = this.pickPreferredExtensionTarget(targets);
      attachedSession = await attachToFlatTarget(session, preferred.targetId);

      const evaluation = await this.evaluateInAttachedTarget(attachedSession, code, returnByValue);

      return json({
        extensionId,
        target: { type: preferred.type, url: preferred.url, name: preferred.name },
        result: evaluation.result,
        exceptionDetails: evaluation.exceptionDetails,
      });
    } catch (error) {
      return fail('extension_execute_in_context', error);
    } finally {
      if (attachedSession) {
        await detachFromFlatTarget(session, attachedSession).catch(() => undefined);
      }
      await safeDetach(session);
    }
  }

  private async getExtensionTargets(
    session: CdpSessionLike,
    expectedExtensionId?: string,
  ): Promise<ExtensionTarget[]> {
    const response = asRecord(await session.send('Target.getTargets'));
    const targetInfos = Array.isArray(response.targetInfos) ? response.targetInfos : [];
    const allowedTypes = new Set(['service_worker', 'background_page']);
    const result: ExtensionTarget[] = [];

    for (const item of targetInfos) {
      const record = asRecord(item);
      const targetId = asString(record.targetId);
      const type = asString(record.type);
      const url = asString(record.url);
      if (!targetId || !type || !url) continue;
      if (!allowedTypes.has(type)) continue;
      const extensionId = this.extractExtensionId(url);
      if (!extensionId) continue;
      if (expectedExtensionId && extensionId !== expectedExtensionId) continue;
      const title = asString(record.title) ?? '';
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
      if (leftScore !== rightScore) return leftScore - rightScore;
      return left.extensionId.localeCompare(right.extensionId);
    });
    return result;
  }

  private pickPreferredExtensionTarget(targets: ExtensionTarget[]): ExtensionTarget {
    const serviceWorker = targets.find((target) => target.type === 'service_worker');
    return serviceWorker ?? targets[0]!;
  }

  private extractExtensionId(url: string): string | null {
    const match = url.match(/^chrome-extension:\/\/([a-p]{32})(?:\/|$)/i);
    return match?.[1] ?? null;
  }

  private async evaluateInAttachedTarget(
    session: CdpSessionLike,
    code: string,
    returnByValue: boolean,
  ): Promise<{ result: unknown; exceptionDetails: unknown }> {
    const response = asRecord(
      await session.send('Runtime.evaluate', {
        expression: code,
        returnByValue,
        awaitPromise: true,
      }),
    );
    const resultEnvelope = asRecord(response.result);

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
