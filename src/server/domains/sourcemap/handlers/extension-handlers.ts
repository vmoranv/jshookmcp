/**
 * Extension-related sub-handler for sourcemap domain.
 */

import { SOURCEMAP_EXT_TIMEOUT_MS } from '@src/constants';
import type {
  CdpSessionLike,
  ExtensionTarget,
  JsonRecord,
  TextToolResponse,
  SourcemapSharedState,
} from './shared';
import {
  asRecord,
  asString,
  requiredStringArg,
  parseBooleanArg,
  safeDetach,
  trySend,
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
    const session = (await page.createCDPSession()) as unknown as CdpSessionLike;
    let attachedSessionId = '';

    try {
      const targets = await this.getExtensionTargets(session, extensionId);
      if (targets.length === 0)
        throw new Error(`No background target found for extension: ${extensionId}`);

      const preferred = this.pickPreferredExtensionTarget(targets);
      const attachResult = asRecord(
        await session.send('Target.attachToTarget', {
          targetId: preferred.targetId,
          flatten: true,
        }),
      );
      attachedSessionId = requiredStringArg(attachResult.sessionId, 'sessionId');

      const evaluation = await this.evaluateInAttachedTarget(
        session,
        attachedSessionId,
        code,
        returnByValue,
      );

      return json({
        extensionId,
        target: { type: preferred.type, url: preferred.url, name: preferred.name },
        result: evaluation.result,
        exceptionDetails: evaluation.exceptionDetails,
      });
    } catch (error) {
      return fail('extension_execute_in_context', error);
    } finally {
      if (attachedSessionId) {
        await trySend(session, 'Target.detachFromTarget', { sessionId: attachedSessionId });
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
    sessionId: string,
    code: string,
    returnByValue: boolean,
  ): Promise<{ result: unknown; exceptionDetails: unknown }> {
    if (!session.on) throw new Error('CDP session does not support event listeners');
    const commandId = Date.now() % 1_000_000_000;
    const commandMessage = JSON.stringify({
      id: commandId,
      method: 'Runtime.evaluate',
      params: { expression: code, returnByValue, awaitPromise: true },
    });

    const responseMessage = await new Promise<JsonRecord>((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        cleanup();
        rejectPromise(new Error('Runtime.evaluate timed out'));
      }, SOURCEMAP_EXT_TIMEOUT_MS);
      const onMessage = (payload: unknown): void => {
        const record = asRecord(payload);
        if (asString(record.sessionId) !== sessionId) return;
        const rawMessage = asString(record.message);
        if (!rawMessage) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawMessage);
        } catch {
          return;
        }
        const parsedRecord = asRecord(parsed);
        if (parsedRecord.id !== commandId) return;
        cleanup();
        resolvePromise(parsedRecord);
      };
      const cleanup = (): void => {
        clearTimeout(timeout);
        session.off?.('Target.receivedMessageFromTarget', onMessage);
      };
      session.on?.('Target.receivedMessageFromTarget', onMessage);
      session
        .send('Target.sendMessageToTarget', { sessionId, message: commandMessage })
        .catch((error: unknown) => {
          cleanup();
          rejectPromise(error);
        });
    });

    const errorRecord = asRecord(responseMessage.error);
    if (Object.keys(errorRecord).length > 0) {
      throw new Error(
        asString(errorRecord.message) ?? asString(errorRecord.data) ?? 'Runtime.evaluate failed',
      );
    }
    const resultEnvelope = asRecord(responseMessage.result);
    return {
      result: resultEnvelope.result !== undefined ? resultEnvelope.result : null,
      exceptionDetails:
        resultEnvelope.exceptionDetails !== undefined ? resultEnvelope.exceptionDetails : null,
    };
  }
}
