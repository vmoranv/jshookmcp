import type { DetectedEnvironmentVariables, MissingAPI } from '@internal-types/index';
import type { BrowserType } from '@modules/emulator/BrowserEnvironmentRules';

export interface AIAnalysisResult {
  recommendedVariables: Record<string, unknown>;

  recommendedAPIs: Array<{
    path: string;
    implementation: string;
    reason: string;
  }>;

  antiCrawlFeatures: Array<{
    feature: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    mitigation: string;
  }>;

  suggestions: string[];

  confidence: number;
}

export class AIEnvironmentAnalyzer {
  constructor(legacyDependency?: unknown) {
    void legacyDependency;
  }

  async analyze(
    _exitCodeValue: string,
    _detected: DetectedEnvironmentVariables,
    _missing: MissingAPI[],
    _browserType: BrowserType = 'chrome',
  ): Promise<AIAnalysisResult> {
    return this.getEmptyResult();
  }

  private getEmptyResult(): AIAnalysisResult {
    return {
      recommendedVariables: {},
      recommendedAPIs: [],
      antiCrawlFeatures: [],
      suggestions: [],
      confidence: 0,
    };
  }

  async analyzeAntiCrawl(_exitCodeValue: string): Promise<AIAnalysisResult['antiCrawlFeatures']> {
    return [];
  }

  async inferAPIImplementation(_apiPath: string, _context: string): Promise<string | null> {
    return null;
  }

  async generateSuggestions(
    detected: DetectedEnvironmentVariables,
    missing: MissingAPI[],
    _browserType: BrowserType,
  ): Promise<string[]> {
    return this.getDefaultSuggestions(detected, missing);
  }

  private getDefaultSuggestions(
    detected: DetectedEnvironmentVariables,
    missing: MissingAPI[],
  ): string[] {
    const suggestions: string[] = [];

    const totalVars = Object.values(detected).flat().length;
    if (totalVars > 50) {
      suggestions.push('Enable environment emulation for better compatibility');
    }

    if (missing.length > 10) {
      suggestions.push(`${missing.length} browser APIs missing, enable API emulation`);
    }

    if (detected.navigator.some((v) => v.includes('webdriver'))) {
      suggestions.push('webdriver flag detected, set navigator.webdriver = false');
    }

    if (detected.navigator.some((v) => v.includes('plugins'))) {
      suggestions.push('Empty plugins list detected, enable plugin emulation');
    }

    if (detected.window.some((v) => v.includes('chrome'))) {
      suggestions.push('chrome property missing, inject window.chrome');
    }

    return suggestions;
  }
}
