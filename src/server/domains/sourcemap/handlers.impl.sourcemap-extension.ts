import type { CdpSessionLike, ExtensionTarget, JsonRecord, TextToolResponse } from './handlers.impl.sourcemap-parse-base.js';
import { SourcemapToolHandlersCommon } from './handlers.impl.sourcemap-common.js';

export class SourcemapToolHandlersExtension extends SourcemapToolHandlersCommon {
  async handleExtensionListInstalled(
    _args: Record<string, unknown>
  ): Promise<TextToolResponse> {
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

  async handleExtensionExecuteInContext(
    args: Record<string, unknown>
  ): Promise<TextToolResponse> {
    const extensionId = this.requiredStringArg(args.extensionId, 'extensionId');
    const code = this.requiredStringArg(args.code, 'code');
    const returnByValue = this.parseBooleanArg(args.returnByValue, true);

    const page = await this.collector.getActivePage();
    const session = (await page.createCDPSession()) as unknown as CdpSessionLike;

    let attachedSessionId = '';

    try {
      const targets = await this.getExtensionTargets(session, extensionId);
      if (targets.length === 0) {
        throw new Error(`No background target found for extension: ${extensionId}`);
      }

      const preferred = this.pickPreferredExtensionTarget(targets);
      const attachResult = this.asRecord(
        await session.send('Target.attachToTarget', {
          targetId: preferred.targetId,
          flatten: true,
        })
      );
      attachedSessionId = this.requiredStringArg(
        attachResult.sessionId,
        'sessionId'
      );

      const evaluation = await this.evaluateInAttachedTarget(
        session,
        attachedSessionId,
        code,
        returnByValue
      );

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
      if (attachedSessionId) {
        await this.trySend(session, 'Target.detachFromTarget', {
          sessionId: attachedSessionId,
        });
      }
      await this.safeDetach(session);
    }
  }

  protected async getExtensionTargets(
    session: CdpSessionLike,
    expectedExtensionId?: string
  ): Promise<ExtensionTarget[]> {
    const response = this.asRecord(await session.send('Target.getTargets'));
    const targetInfos = Array.isArray(response.targetInfos)
      ? response.targetInfos
      : [];

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
    sessionId: string,
    code: string,
    returnByValue: boolean
  ): Promise<{ result: unknown; exceptionDetails: unknown }> {
    if (!session.on) {
      throw new Error('CDP session does not support event listeners');
    }

    const commandId = Date.now() % 1_000_000_000;
    const commandMessage = JSON.stringify({
      id: commandId,
      method: 'Runtime.evaluate',
      params: {
        expression: code,
        returnByValue,
        awaitPromise: true,
      },
    });

    const responseMessage = await new Promise<JsonRecord>((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        cleanup();
        rejectPromise(new Error('Runtime.evaluate timed out'));
      }, 15_000);

      const onMessage = (payload: unknown): void => {
        const record = this.asRecord(payload);
        const incomingSessionId = this.asString(record.sessionId);
        if (incomingSessionId !== sessionId) {
          return;
        }

        const rawMessage = this.asString(record.message);
        if (!rawMessage) {
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(rawMessage);
        } catch {
          return;
        }

        const parsedRecord = this.asRecord(parsed);
        const incomingId = parsedRecord.id;
        if (incomingId !== commandId) {
          return;
        }

        cleanup();
        resolvePromise(parsedRecord);
      };

      const cleanup = (): void => {
        clearTimeout(timeout);
        session.off?.('Target.receivedMessageFromTarget', onMessage);
      };

      session.on?.('Target.receivedMessageFromTarget', onMessage);

      session
        .send('Target.sendMessageToTarget', {
          sessionId,
          message: commandMessage,
        })
        .catch((error) => {
          cleanup();
          rejectPromise(error);
        });
    });

    const errorRecord = this.asRecord(responseMessage.error);
    if (Object.keys(errorRecord).length > 0) {
      const errorMessage =
        this.asString(errorRecord.message) ??
        this.asString(errorRecord.data) ??
        'Runtime.evaluate failed';
      throw new Error(errorMessage);
    }

    const resultEnvelope = this.asRecord(responseMessage.result);
    const resultValue =
      resultEnvelope.result !== undefined ? resultEnvelope.result : null;
    const exceptionDetails =
      resultEnvelope.exceptionDetails !== undefined
        ? resultEnvelope.exceptionDetails
        : null;

    return {
      result: resultValue,
      exceptionDetails,
    };
  }

}
