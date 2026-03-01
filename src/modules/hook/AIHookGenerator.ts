import { logger } from '../../utils/logger.js';
import {
  generatePropertyHookTemplate,
  generateEventHookTemplate,
} from './AIHookGeneratorTemplates.js';

export interface AIHookRequest {
  description: string;

  target: {
    type: 'function' | 'object-method' | 'api' | 'property' | 'event' | 'custom';
    name?: string;
    pattern?: string;
    object?: string;
    property?: string;
  };

  behavior: {
    captureArgs?: boolean;
    captureReturn?: boolean;
    captureStack?: boolean;
    modifyArgs?: boolean;
    modifyReturn?: boolean;
    blockExecution?: boolean;
    logToConsole?: boolean;
  };

  condition?: {
    argFilter?: string;
    returnFilter?: string;
    urlPattern?: string;
    maxCalls?: number;
  };

  customCode?: {
    before?: string;
    after?: string;
    replace?: string;
  };
}

export interface AIHookResponse {
  success: boolean;
  hookId: string;
  generatedCode: string;
  explanation: string;
  injectionMethod: 'evaluateOnNewDocument' | 'evaluate' | 'addScriptTag';
  warnings?: string[];
}

export class AIHookGenerator {
  private hookCounter = 0;

  generateHook(request: AIHookRequest): AIHookResponse {
    logger.info(` AI Hook Generator: ${request.description}`);

    const hookId = `ai-hook-${++this.hookCounter}-${Date.now()}`;
    const warnings: string[] = [];

    try {
      let generatedCode = '';
      let explanation = '';
      let injectionMethod: AIHookResponse['injectionMethod'] = 'evaluateOnNewDocument';

      switch (request.target.type) {
        case 'function':
          ({ code: generatedCode, explanation } = this.generateFunctionHook(request, hookId));
          break;

        case 'object-method':
          ({ code: generatedCode, explanation } = this.generateObjectMethodHook(request, hookId));
          break;

        case 'api':
          ({ code: generatedCode, explanation } = this.generateAPIHook(request, hookId));
          injectionMethod = 'evaluateOnNewDocument';
          break;

        case 'property':
          ({ code: generatedCode, explanation } = this.generatePropertyHook(request, hookId));
          break;

        case 'event':
          ({ code: generatedCode, explanation } = this.generateEventHook(request, hookId));
          injectionMethod = 'evaluate';
          break;

        case 'custom':
          ({ code: generatedCode, explanation } = this.generateCustomHook(request, hookId));
          break;

        default:
          throw new Error(`Unsupported target type: ${request.target.type}`);
      }

      generatedCode = this.wrapWithGlobalStorage(generatedCode, hookId);

      this.validateGeneratedCode(generatedCode, warnings);

      logger.success(` Hook generated: ${hookId}`);

      return {
        success: true,
        hookId,
        generatedCode,
        explanation,
        injectionMethod,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      logger.error('Failed to generate hook', error);
      return {
        success: false,
        hookId,
        generatedCode: '',
        explanation: `Error: ${error instanceof Error ? error.message : String(error)}`,
        injectionMethod: 'evaluateOnNewDocument',
        warnings: ['Hook generation failed'],
      };
    }
  }

  private generateFunctionHook(
    request: AIHookRequest,
    hookId: string
  ): { code: string; explanation: string } {
    const { target, behavior, condition, customCode } = request;
    const functionName = target.name || target.pattern || 'unknownFunction';

    let code = `
(function() {
  const originalFunction = window.${functionName};
  
  if (typeof originalFunction !== 'function') {
    console.warn('[${hookId}] Function not found: ${functionName}');
    return;
  }
  
  let callCount = 0;
  const maxCalls = ${condition?.maxCalls || 'Infinity'};
  
  window.${functionName} = function(...args) {
    callCount++;
    
    if (callCount > maxCalls) {
      return originalFunction.apply(this, args);
    }
    
    const hookData = {
      hookId: '${hookId}',
      functionName: '${functionName}',
      callCount,
      timestamp: Date.now(),
      ${behavior.captureArgs ? 'args: args,' : ''}
      ${behavior.captureStack ? 'stack: new Error().stack,' : ''}
    };
    
    ${customCode?.before || ''}
    
    ${
      condition?.argFilter
        ? `
    const argFilterPassed = (function() {
      try {
        return ${condition.argFilter};
      } catch (e) {
        console.error('[${hookId}] Arg filter error:', e);
        return true;
      }
    })();
    
    if (!argFilterPassed) {
      return originalFunction.apply(this, args);
    }
    `
        : ''
    }
    
    ${
      behavior.logToConsole
        ? `
    console.log('[${hookId}] Function called:', hookData);
    `
        : ''
    }
    
    ${
      behavior.blockExecution
        ? `
    console.warn('[${hookId}] Execution blocked');
    return undefined;
    `
        : `
    const startTime = performance.now();
    const result = originalFunction.apply(this, args);
    const executionTime = performance.now() - startTime;
    
    ${
      behavior.captureReturn
        ? `
    hookData.returnValue = result;
    hookData.executionTime = executionTime;
    `
        : ''
    }
    
    ${customCode?.after || ''}
    
    if (!window.__aiHooks) window.__aiHooks = {};
    if (!window.__aiHooks['${hookId}']) window.__aiHooks['${hookId}'] = [];
    window.__aiHooks['${hookId}'].push(hookData);
    
    return result;
    `
    }
  };
  
  console.log('[${hookId}] Hook installed for: ${functionName}');
})();
`;

    const explanation = `
Hook: ${functionName}
- : ${behavior.captureArgs ? '' : ''}
- : ${behavior.captureReturn ? '' : ''}
- : ${behavior.captureStack ? '' : ''}
- : ${behavior.blockExecution ? '' : ''}
${condition?.maxCalls ? `- : ${condition.maxCalls}` : ''}
`;

    return { code, explanation };
  }

  private generateObjectMethodHook(
    request: AIHookRequest,
    hookId: string
  ): { code: string; explanation: string } {
    const { target, behavior } = request;
    const objectPath = target.object || 'window';
    const methodName = target.property || target.name || 'unknownMethod';

    const code = `
(function() {
  const targetObject = ${objectPath};
  const methodName = '${methodName}';
  
  if (!targetObject || typeof targetObject[methodName] !== 'function') {
    console.warn('[${hookId}] Method not found: ${objectPath}.${methodName}');
    return;
  }
  
  const originalMethod = targetObject[methodName];
  let callCount = 0;
  
  targetObject[methodName] = function(...args) {
    callCount++;
    
    const hookData = {
      hookId: '${hookId}',
      object: '${objectPath}',
      method: '${methodName}',
      callCount,
      timestamp: Date.now(),
      ${behavior.captureArgs ? 'args: args,' : ''}
      ${behavior.captureStack ? 'stack: new Error().stack,' : ''}
    };
    
    ${
      behavior.logToConsole
        ? `
    console.log('[${hookId}] Method called:', hookData);
    `
        : ''
    }
    
    const result = originalMethod.apply(this, args);
    
    ${
      behavior.captureReturn
        ? `
    hookData.returnValue = result;
    `
        : ''
    }
    
    if (!window.__aiHooks) window.__aiHooks = {};
    if (!window.__aiHooks['${hookId}']) window.__aiHooks['${hookId}'] = [];
    window.__aiHooks['${hookId}'].push(hookData);
    
    return result;
  };
  
  console.log('[${hookId}] Hook installed for: ${objectPath}.${methodName}');
})();
`;

    const explanation = `Hook: ${objectPath}.${methodName}`;
    return { code, explanation };
  }

  private generateAPIHook(
    request: AIHookRequest,
    hookId: string
  ): { code: string; explanation: string } {
    const apiName = request.target.name || 'fetch';

    let code = '';

    if (apiName === 'fetch') {
      code = this.generateFetchAPIHook(request, hookId);
    } else if (apiName === 'XMLHttpRequest') {
      code = this.generateXHRAPIHook(request, hookId);
    } else {
      code = `console.error('[${hookId}] Unsupported API: ${apiName}');`;
    }

    const explanation = `HookAPI: ${apiName}`;
    return { code, explanation };
  }

  private generateFetchAPIHook(request: AIHookRequest, hookId: string): string {
    const { behavior, condition } = request;

    return `
(function() {
  const originalFetch = window.fetch;
  
  window.fetch = function(...args) {
    const [url, options] = args;
    
    ${
      condition?.urlPattern
        ? `
    const urlPattern = new RegExp('${condition.urlPattern}');
    if (!urlPattern.test(url)) {
      return originalFetch.apply(this, args);
    }
    `
        : ''
    }
    
    const hookData = {
      hookId: '${hookId}',
      type: 'fetch',
      url: url,
      method: options?.method || 'GET',
      timestamp: Date.now(),
      ${behavior.captureArgs ? 'options: options,' : ''}
    };
    
    ${
      behavior.logToConsole
        ? `
    console.log('[${hookId}] Fetch request:', hookData);
    `
        : ''
    }
    
    return originalFetch.apply(this, args).then(response => {
      ${
        behavior.captureReturn
          ? `
      hookData.status = response.status;
      hookData.statusText = response.statusText;
      `
          : ''
      }
      
      if (!window.__aiHooks) window.__aiHooks = {};
      if (!window.__aiHooks['${hookId}']) window.__aiHooks['${hookId}'] = [];
      window.__aiHooks['${hookId}'].push(hookData);
      
      return response;
    });
  };
  
  console.log('[${hookId}] Fetch Hook installed');
})();
`;
  }

  private generateXHRAPIHook(_request: AIHookRequest, hookId: string): string {
    return `
(function() {
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__hookData = {
      hookId: '${hookId}',
      type: 'xhr',
      method,
      url,
      timestamp: Date.now(),
    };
    return originalOpen.apply(this, [method, url, ...rest]);
  };
  
  XMLHttpRequest.prototype.send = function(...args) {
    const xhr = this;
    
    xhr.addEventListener('load', function() {
      if (xhr.__hookData) {
        xhr.__hookData.status = xhr.status;
        xhr.__hookData.response = xhr.responseText;
        
        if (!window.__aiHooks) window.__aiHooks = {};
        if (!window.__aiHooks['${hookId}']) window.__aiHooks['${hookId}'] = [];
        window.__aiHooks['${hookId}'].push(xhr.__hookData);
      }
    });
    
    return originalSend.apply(this, args);
  };
  
  console.log('[${hookId}] XHR Hook installed');
})();
`;
  }

  private generatePropertyHook(
    request: AIHookRequest,
    hookId: string
  ): { code: string; explanation: string } {
    return generatePropertyHookTemplate(request, hookId);
  }

  private generateEventHook(
    request: AIHookRequest,
    hookId: string
  ): { code: string; explanation: string } {
    return generateEventHookTemplate(request, hookId);
  }

  private generateCustomHook(
    request: AIHookRequest,
    _hookId: string
  ): { code: string; explanation: string } {
    const code = request.customCode?.replace || ``;
    const explanation = 'Custom Hook code provided by user';
    return { code, explanation };
  }

  private wrapWithGlobalStorage(code: string, hookId: string): string {
    return `
// Initialize __aiHooks and __aiHookMetadata independently to avoid race conditions
if (typeof window.__aiHooks === 'undefined') {
  window.__aiHooks = {};
}
if (typeof window.__aiHookMetadata === 'undefined') {
  window.__aiHookMetadata = {};
}

window.__aiHookMetadata['${hookId}'] = {
  id: '${hookId}',
  createdAt: Date.now(),
  enabled: true,
};

${code}
`;
  }

  private validateGeneratedCode(code: string, warnings: string[]): void {
    if (code.includes('eval(') || code.includes('Function(')) {
      warnings.push('Generated code contains eval() or Function(), which may be dangerous');
    }

    const openBraces = (code.match(/{/g) || []).length;
    const closeBraces = (code.match(/}/g) || []).length;
    if (openBraces !== closeBraces) {
      warnings.push('Possible syntax error: unmatched braces');
    }
  }
}
