import { logger } from '../../utils/logger.js';
import { PrerequisiteError } from '../../errors/PrerequisiteError.js';
import type {
  ScopeVariable,
  GetScopeVariablesOptions,
  GetScopeVariablesResult,
} from '../../types/index.js';
import type { ObjectPropertyInfo } from './DebuggerManager.impl.core.class.js';
import type { CallFrame, PausedState, Scope } from './DebuggerManager.impl.core.class.js';
import type { CDPSession } from 'rebrowser-puppeteer-core';

interface RuntimeRemoteObjectLike {
  value?: unknown;
  type?: string;
  objectId?: string;
  className?: string;
  description?: string;
}

interface RuntimePropertyLike {
  name: string;
  value?: RuntimeRemoteObjectLike;
  writable?: boolean;
  configurable?: boolean;
  enumerable?: boolean;
}

interface RuntimeGetPropertiesResult {
  result: RuntimePropertyLike[];
}

type CDPSessionLike = Pick<CDPSession, 'send'>;

interface ScopeCoreContext {
  enabled: boolean;
  cdpSession: CDPSessionLike | null;
  pausedState: PausedState | null;
}

interface ScopeCallFrame extends CallFrame {
  scopeChain: Scope[];
}

function asScopeCoreContext(ctx: unknown): ScopeCoreContext {
  return ctx as ScopeCoreContext;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function getScopeVariablesCore(
  ctx: unknown,
  options: GetScopeVariablesOptions = {}
): Promise<GetScopeVariablesResult> {
  const coreCtx = asScopeCoreContext(ctx);

  if (!coreCtx.enabled || !coreCtx.cdpSession) {
    throw new PrerequisiteError('Debugger not enabled. Call init() or enable() first.');
  }

  if (!coreCtx.pausedState) {
    throw new PrerequisiteError('Not in paused state. Use pause() or set a breakpoint first.');
  }

  const {
    callFrameId,
    includeObjectProperties = false,
    maxDepth = 1,
    skipErrors = true,
  } = options;

  try {
    const targetFrame = callFrameId
      ? (coreCtx.pausedState.callFrames.find((f) => f.callFrameId === callFrameId) as
          | ScopeCallFrame
          | undefined)
      : (coreCtx.pausedState.callFrames[0] as ScopeCallFrame | undefined);

    if (!targetFrame) {
      throw new Error(`Call frame not found: ${callFrameId || 'top frame'}`);
    }

    const variables: ScopeVariable[] = [];
    const errors: Array<{ scope: string; error: string }> = [];
    let successfulScopes = 0;

    for (const scope of targetFrame.scopeChain) {
      try {
        if (scope.object.objectId) {
          const properties = (await coreCtx.cdpSession.send('Runtime.getProperties', {
            objectId: scope.object.objectId,
            ownProperties: true,
          })) as RuntimeGetPropertiesResult;

          for (const prop of properties.result) {
            if (prop.name === '__proto__') continue;

            const variable: ScopeVariable = {
              name: prop.name,
              value: prop.value?.value,
              type: prop.value?.type || 'unknown',
              scope: scope.type,
              writable: prop.writable,
              configurable: prop.configurable,
              enumerable: prop.enumerable,
              objectId: prop.value?.objectId,
            };

            variables.push(variable);

            if (includeObjectProperties && prop.value?.objectId && maxDepth > 0) {
              try {
                const nestedProps = await getObjectPropertiesCore(
                  coreCtx,
                  prop.value.objectId,
                  maxDepth - 1
                );
                for (const nested of nestedProps) {
                  variables.push({
                    ...nested,
                    name: `${prop.name}.${nested.name}`,
                    scope: scope.type,
                  });
                }
              } catch (nestedError) {
                logger.debug(`Failed to get nested properties for ${prop.name}:`, nestedError);
              }
            }
          }

          successfulScopes++;
        }
      } catch (error) {
        const errorMsg = toErrorMessage(error);

        logger.warn(`Failed to get properties for scope ${scope.type}:`, errorMsg);

        errors.push({
          scope: scope.type,
          error: errorMsg,
        });

        if (!skipErrors) {
          throw error;
        }
      }
    }

    const result: GetScopeVariablesResult = {
      success: true,
      variables,
      callFrameId: targetFrame.callFrameId,
      callFrameInfo: {
        functionName: targetFrame.functionName || '(anonymous)',
        location: `${targetFrame.url}:${targetFrame.location.lineNumber}:${targetFrame.location.columnNumber}`,
      },
      totalScopes: targetFrame.scopeChain.length,
      successfulScopes,
    };

    if (errors.length > 0) {
      result.errors = errors;
    }

    logger.info(
      `Got ${variables.length} variables from ${successfulScopes}/${targetFrame.scopeChain.length} scopes`,
      {
        callFrameId: targetFrame.callFrameId,
        functionName: targetFrame.functionName,
        errors: errors.length,
      }
    );

    return result;
  } catch (error) {
    logger.error('Failed to get scope variables:', error);
    throw error;
  }
}

export async function getObjectPropertiesByIdCore(
  ctx: unknown,
  objectId: string
): Promise<ObjectPropertyInfo[]> {
  const coreCtx = asScopeCoreContext(ctx);

  if (!coreCtx.enabled || !coreCtx.cdpSession) {
    throw new Error('Debugger not enabled');
  }

  if (!objectId || typeof objectId !== 'string') {
    throw new Error('objectId parameter is required');
  }

  try {
    const properties = (await coreCtx.cdpSession.send('Runtime.getProperties', {
      objectId,
      ownProperties: true,
      accessorPropertiesOnly: false,
      generatePreview: true,
    })) as RuntimeGetPropertiesResult;

    const result: ObjectPropertyInfo[] = [];
    for (const prop of properties.result) {
      if (!prop.value) {
        continue;
      }

      result.push({
        name: prop.name,
        value: prop.value.value ?? prop.value.description,
        type: prop.value.type || 'unknown',
        objectId: prop.value.objectId,
        className: prop.value.className,
        description: prop.value.description,
      });
    }

    return result;
  } catch (error) {
    const message = toErrorMessage(error);
    if (
      message.includes('Could not find object with given id') ||
      message.includes('Invalid remote object id')
    ) {
      throw new Error(
        'Object handle is expired or invalid. Pause execution again and reacquire objectId from get_scope_variables_enhanced.'
      );
    }
    throw error;
  }
}

export async function getObjectPropertiesCore(
  ctx: unknown,
  objectId: string,
  maxDepth: number
): Promise<ScopeVariable[]> {
  const coreCtx = asScopeCoreContext(ctx);

  if (maxDepth <= 0 || !coreCtx.cdpSession) {
    return [];
  }

  try {
    const properties = (await coreCtx.cdpSession.send('Runtime.getProperties', {
      objectId,
      ownProperties: true,
    })) as RuntimeGetPropertiesResult;

    const variables: ScopeVariable[] = [];

    for (const prop of properties.result) {
      if (prop.name === '__proto__') continue;

      variables.push({
        name: prop.name,
        value: prop.value?.value,
        type: prop.value?.type || 'unknown',
        scope: 'local',
        objectId: prop.value?.objectId,
      });
    }

    return variables;
  } catch (error) {
    logger.debug(`Failed to get object properties for ${objectId}:`, error);
    return [];
  }
}
