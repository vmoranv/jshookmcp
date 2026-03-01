import { logger } from '../../utils/logger.js';

interface CdpRemoteObjectLike {
  type: string;
  value?: unknown;
  objectId?: string;
  description?: string;
}

interface RuntimePropertyDescriptorLike {
  name: string;
  value?: CdpRemoteObjectLike;
}

interface RuntimeGetPropertiesResultLike {
  result: RuntimePropertyDescriptorLike[];
}

interface RuntimeGetPropertiesSessionLike {
  send(
    method: 'Runtime.getProperties',
    params: {
      objectId: string;
      ownProperties: true;
      accessorPropertiesOnly: false;
      generatePreview: true;
    }
  ): Promise<RuntimeGetPropertiesResultLike>;
}

export interface InspectedPropertyEntry {
  value: unknown;
  type: string;
  objectId?: string;
  description?: string;
}

export type InspectedObjectProperties = Record<string, InspectedPropertyEntry>;

interface ObjectCacheContext {
  ensureSession(): Promise<void>;
  cdpSession: RuntimeGetPropertiesSessionLike | null;
  objectCache: Map<string, InspectedObjectProperties>;
  MAX_OBJECT_CACHE_SIZE: number;
  extractValue(obj: CdpRemoteObjectLike): unknown;
}

export async function inspectObjectCore(
  ctx: unknown,
  objectId: string
): Promise<InspectedObjectProperties> {
  const context = ctx as ObjectCacheContext;
  await context.ensureSession();
  if (!context.cdpSession) {
    throw new Error('CDP session not available after reconnect attempt');
  }

  if (context.objectCache.has(objectId)) {
    const cached = context.objectCache.get(objectId);
    if (cached !== undefined) {
      return cached;
    }
  }

  try {
    const result = await context.cdpSession.send('Runtime.getProperties', {
      objectId,
      ownProperties: true,
      accessorPropertiesOnly: false,
      generatePreview: true,
    });

    const properties: InspectedObjectProperties = {};

    for (const prop of result.result) {
      if (!prop.value) continue;
      const valueObj = prop.value;

      properties[prop.name] = {
        value: context.extractValue(valueObj),
        type: valueObj.type,
        objectId: valueObj.objectId,
        description: valueObj.description,
      };
    }

    if (!context.objectCache.has(objectId)) {
      while (context.objectCache.size >= context.MAX_OBJECT_CACHE_SIZE) {
        const oldestKey = context.objectCache.keys().next().value as string | undefined;
        if (oldestKey === undefined) {
          break;
        }
        context.objectCache.delete(oldestKey);
      }
    }
    context.objectCache.set(objectId, properties);

    logger.info(`Object inspected: ${objectId}`, {
      propertyCount: Object.keys(properties).length,
    });

    return properties;
  } catch (error) {
    logger.error('Failed to inspect object:', error);
    throw error;
  }
}

export function clearObjectCacheCore(ctx: unknown): void {
  const context = ctx as Pick<ObjectCacheContext, 'objectCache'>;
  context.objectCache.clear();
  logger.info('Object cache cleared');
}
