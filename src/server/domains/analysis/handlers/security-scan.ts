/**
 * Security scan handler: analysis_security_scan
 *
 * Exposes the existing `identifySecurityRisks` module as a user-facing tool.
 * Returns a structured list of vulnerabilities with severity, location, and recommendations.
 */

import { argString } from '@server/domains/shared/parse-args';
import { asJsonResponse } from '@server/domains/shared/response';
import type { ToolArgs, ToolResponse } from '@server/types';
import { identifySecurityRisks } from '@modules/analyzer/SecurityCodeAnalyzer';

export async function handleAnalysisSecurityScan(args: ToolArgs): Promise<ToolResponse> {
  const code = argString(args, 'code');
  if (!code || code.trim().length === 0) {
    return asJsonResponse({
      success: false,
      error: 'code is required and must be a non-empty string',
    });
  }

  const risks = identifySecurityRisks(code, {});
  return asJsonResponse({
    success: true,
    risks,
    riskCount: risks.length,
    severities: {
      critical: risks.filter((r) => r.severity === 'critical').length,
      high: risks.filter((r) => r.severity === 'high').length,
      medium: risks.filter((r) => r.severity === 'medium').length,
      low: risks.filter((r) => r.severity === 'low').length,
    },
  });
}
