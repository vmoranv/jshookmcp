import type { DeobfuscateOptions, DeobfuscateResult, ObfuscationType } from '@internal-types/index';
import { DEOBFUSCATION_CONFIG, withTimeout } from '@modules/deobfuscator/DeobfuscationConfig';

interface ObfuscatorProConfig {
  apiToken: string;
  version?: string;
  timeout?: number;
}

interface ObfuscatorProOptions {
  vmObfuscation?: boolean;
  parseHtml?: boolean;
}

interface ObfuscatorProResult {
  getObfuscatedCode: () => string;
  getSourceMap?: () => string;
}

interface ObfuscatorProClient {
  obfuscatePro: (
    sourceCode: string,
    options: ObfuscatorProOptions,
    config: ObfuscatorProConfig,
  ) => Promise<ObfuscatorProResult>;
}

interface ProApiDeobfuscatorOptions extends DeobfuscateOptions {
  proApiToken?: string;
  proApiVersion?: string;
  vmObfuscation?: boolean;
  parseHtml?: boolean;
}

interface ProApiDeobfuscateResult extends DeobfuscateResult {
  proApiUsed: boolean;
  proApiConfig?: ObfuscatorProConfig;
}

// Cache for the javascript-obfuscator module to prevent repeated dynamic imports
// @ts-expect-error -- optional dependency, may not be installed
let jsObfuscatorModule: typeof import('javascript-obfuscator') | null = null;
let moduleLoadAttempted = false;
// @ts-expect-error -- optional dependency
let moduleLoadPromise: Promise<typeof import('javascript-obfuscator') | null> | null = null;

// @ts-expect-error -- optional dependency
async function getJsObfuscatorModule(): Promise<typeof import('javascript-obfuscator') | null> {
  if (jsObfuscatorModule !== null) {
    return jsObfuscatorModule;
  }

  if (moduleLoadAttempted) {
    return null;
  }

  if (moduleLoadPromise !== null) {
    return moduleLoadPromise;
  }

  moduleLoadAttempted = true;
  moduleLoadPromise = withTimeout(
    (async () => {
      try {
        // @ts-expect-error -- optional dependency
        const module = await import('javascript-obfuscator');
        jsObfuscatorModule = module;
        return module;
      } catch (error) {
        console.warn('Failed to load javascript-obfuscator module:', error);
        return null;
      }
    })(),
    DEOBFUSCATION_CONFIG.PRO_API_TIMEOUT_MS,
    'javascript-obfuscator module load timeout',
  ).catch(() => null);

  return moduleLoadPromise;
}

export function getProApiClientStatus(): 'valid' | 'invalid' | 'unknown' {
  const token = process.env.OBFUSCATOR_IO_API_TOKEN;
  if (!token) {
    return 'unknown';
  }

  return token.length >= DEOBFUSCATION_CONFIG.MIN_API_TOKEN_LENGTH ? 'valid' : 'invalid';
}

export function hasProFeatures(options: DeobfuscateOptions): boolean {
  return (
    !!(options as ProApiDeobfuscatorOptions).proApiToken ||
    (options as ObfuscatorProOptions).vmObfuscation === true ||
    (options as ObfuscatorProOptions).parseHtml === true
  );
}

export function hasValidProApiToken(): boolean {
  const token = process.env.OBFUSCATOR_IO_API_TOKEN;
  return !!token && token.length >= DEOBFUSCATION_CONFIG.MIN_API_TOKEN_LENGTH;
}

export async function deobfuscateWithProApi(
  options: DeobfuscateOptions,
): Promise<ProApiDeobfuscateResult | null> {
  const proOptions = options as ProApiDeobfuscatorOptions;
  const proToken = proOptions.proApiToken || process.env.OBFUSCATOR_IO_API_TOKEN;

  // Validation with proper error messages
  if (!proToken) {
    console.debug('Pro API token not provided');
    return null;
  }

  if (proToken.length < DEOBFUSCATION_CONFIG.MIN_API_TOKEN_LENGTH) {
    console.warn(
      `Pro API token too short (min ${DEOBFUSCATION_CONFIG.MIN_API_TOKEN_LENGTH} chars)`,
    );
    return null;
  }

  const module = await getJsObfuscatorModule();
  if (!module) {
    console.warn('javascript-obfuscator module not available');
    return null;
  }

  try {
    const apiOptions: ObfuscatorProOptions = {
      vmObfuscation: proOptions.vmObfuscation === true,
      parseHtml: proOptions.parseHtml === true,
    };

    const apiConfig: ObfuscatorProConfig = {
      apiToken: '[REDACTED]', // Don't expose the actual token
      version: proOptions.proApiVersion || process.env.OBFUSCATOR_IO_VERSION,
      timeout: DEOBFUSCATION_CONFIG.PRO_API_TIMEOUT_MS,
    };

    // Use timeout for the API call
    const result = await withTimeout(
      module.obfuscatePro(options.code, apiOptions, {
        apiToken: proToken,
        version: apiConfig.version,
        timeout: DEOBFUSCATION_CONFIG.PRO_API_TIMEOUT_MS,
      }),
      DEOBFUSCATION_CONFIG.PRO_API_TIMEOUT_MS,
      'Pro API deobfuscation timeout',
    );

    if (result && typeof (result as ObfuscatorProResult).getObfuscatedCode === 'function') {
      const proResult = result as ObfuscatorProResult;
      return {
        code: proResult.getObfuscatedCode(),
        readabilityScore: 0,
        confidence: 0.9,
        obfuscationType: ['javascript-obfuscator'] as ObfuscationType[],
        transformations: [],
        analysis: 'obfuscator.io Pro API applied',
        proApiUsed: true,
        proApiConfig: {
          apiToken: '[REDACTED]', // Don't expose actual token
          version: apiConfig.version,
          timeout: apiConfig.timeout,
        },
        engine: 'pro-api',
        cached: false,
      };
    }
  } catch (error) {
    console.error('Pro API deobfuscation failed:', (error as Error).message);
    return null;
  }

  return null;
}

export const ProApiClient = {
  loadClient: async (): Promise<ObfuscatorProClient | null> => {
    const module = await getJsObfuscatorModule();
    if (!module) return null;

    return {
      obfuscatePro: module.obfuscatePro.bind(module),
    };
  },

  obfuscatePro: async (
    sourceCode: string,
    options: ObfuscatorProOptions,
    config: ObfuscatorProConfig,
  ): Promise<{ code: string; applier: string } | null> => {
    const client = await ProApiClient.loadClient();
    if (!client) {
      return null;
    }

    try {
      const result = await withTimeout(
        client.obfuscatePro(sourceCode, options, {
          apiToken: config.apiToken,
          version: config.version,
          timeout: config.timeout || DEOBFUSCATION_CONFIG.PRO_API_TIMEOUT_MS,
        }),
        config.timeout || DEOBFUSCATION_CONFIG.PRO_API_TIMEOUT_MS,
        'Pro API deobfuscation timeout',
      );

      return {
        code: result.getObfuscatedCode(),
        applier: 'javascript-obfuscator',
      };
    } catch (error) {
      console.error('Pro API obfuscation failed:', (error as Error).message);
      return null;
    }
  },

  getApiTokenStatus: getProApiClientStatus,
};

export default {
  deobfuscateWithProApi,
  hasProFeatures,
  hasValidProApiToken,
  ProApiClient,
};
