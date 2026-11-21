/**
 * Code understanding handlers: understand_code, detect_crypto, detect_obfuscation
 */

import { argBool, argEnum, argObject } from '@server/domains/shared/parse-args';
import { cpuLimit } from '@utils/concurrency';
import { asJsonResponse, asTextResponse } from '@server/domains/shared/response';
import type { CodeAnalyzer } from '@modules/analyzer/CodeAnalyzer';
import type { CryptoDetector } from '@modules/crypto/CryptoDetector';
import type { ObfuscationDetector } from '@modules/detector/ObfuscationDetector';
import type { ToolArgs, ToolResponse } from '@server/types';
import { requireCodeArg } from './shared';

const FOCUS_MODES = new Set(['structure', 'business', 'security', 'all'] as const);

export async function handleUnderstandCode(
  args: ToolArgs,
  analyzer: CodeAnalyzer,
): Promise<ToolResponse> {
  const code = requireCodeArg(args);
  if (!code) {
    return asJsonResponse({
      success: false,
      error: 'code is required and must be a non-empty string',
    });
  }

  const context = argObject(args, 'context');
  const focus = argEnum(args, 'focus', FOCUS_MODES, 'all');

  return cpuLimit(async (): Promise<ToolResponse> => {
    const result = await analyzer.understand({
      code,
      context,
      focus,
    });

    return asJsonResponse(result);
  });
}

export async function handleDetectCrypto(
  args: ToolArgs,
  cryptoDetector: CryptoDetector,
): Promise<ToolResponse> {
  const code = requireCodeArg(args);
  if (!code) {
    return asJsonResponse({
      success: false,
      error: 'code is required and must be a non-empty string',
    });
  }

  return cpuLimit(async (): Promise<ToolResponse> => {
    const result = await cryptoDetector.detect({
      code,
    });

    return asJsonResponse(result);
  });
}

export async function handleDetectObfuscation(
  args: ToolArgs,
  obfuscationDetector: ObfuscationDetector,
): Promise<ToolResponse> {
  const code = requireCodeArg(args);
  if (!code) {
    return asJsonResponse({
      success: false,
      error: 'code is required and must be a non-empty string',
    });
  }

  const generateReport = argBool(args, 'generateReport', true);

  return cpuLimit(async (): Promise<ToolResponse> => {
    const result = obfuscationDetector.detect(code);

    if (!generateReport) {
      return asJsonResponse(result);
    }

    const report = obfuscationDetector.generateReport(result);
    return asTextResponse(`${JSON.stringify(result, null, 2)}\n\n${report}`);
  });
}
