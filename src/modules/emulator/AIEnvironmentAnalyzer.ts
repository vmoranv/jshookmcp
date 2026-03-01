import type { LLMService } from '../../services/LLMService.js';
import type { DetectedEnvironmentVariables, MissingAPI } from '../../types/index.js';
import type { BrowserType } from './BrowserEnvironmentRules.js';
import { logger } from '../../utils/logger.js';
import {
  generateBrowserEnvAnalysisMessages,
  generateAntiCrawlAnalysisMessages,
  generateAPIImplementationMessages,
  generateEnvironmentSuggestionsMessages,
} from '../../services/prompts/environment.js';

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
  constructor(private llm?: LLMService) {}

  async analyze(
    code: string,
    detected: DetectedEnvironmentVariables,
    missing: MissingAPI[],
    browserType: BrowserType = 'chrome'
  ): Promise<AIAnalysisResult> {
    if (!this.llm) {
      logger.warn('LLM service unavailable, skipping AI environment analysis');
      return this.getEmptyResult();
    }

    try {
      logger.info(' AI...');

      const response = await this.llm.chat(
        generateBrowserEnvAnalysisMessages(code, detected, missing, browserType)
      );

      const result = this.parseAIResponse(response.content);
      logger.info(
        `AI environment analysis complete, confidence: ${(result.confidence * 100).toFixed(1)}%`
      );

      return result;
    } catch (error) {
      logger.error('AI', error);
      return this.getEmptyResult();
    }
  }

  private parseAIResponse(response: string): AIAnalysisResult {
    try {
      const jsonMatch =
        response.match(/```json\s*([\s\S]*?)\s*```/) || response.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        logger.warn('AIJSON');
        return this.getEmptyResult();
      }

      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr);

      return {
        recommendedVariables: parsed.recommendedVariables || {},
        recommendedAPIs: parsed.recommendedAPIs || [],
        antiCrawlFeatures: parsed.antiCrawlFeatures || [],
        suggestions: parsed.suggestions || [],
        confidence: parsed.confidence || 0.5,
      };
    } catch (error) {
      logger.error('AI', error);
      return this.getEmptyResult();
    }
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

  async analyzeAntiCrawl(code: string): Promise<AIAnalysisResult['antiCrawlFeatures']> {
    if (!this.llm) {
      return [];
    }

    try {
      const response = await this.llm.chat(generateAntiCrawlAnalysisMessages(code));

      const jsonMatch =
        response.content.match(/```json\s*([\s\S]*?)\s*```/) ||
        response.content.match(/\[[\s\S]*\]/);

      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        return JSON.parse(jsonStr);
      }

      return [];
    } catch (error) {
      logger.error('', error);
      return [];
    }
  }

  async inferAPIImplementation(apiPath: string, context: string): Promise<string | null> {
    if (!this.llm) {
      return null;
    }

    try {
      const response = await this.llm.chat(generateAPIImplementationMessages(apiPath, context));

      const codeMatch = response.content.match(/```(?:javascript|js)?\s*([\s\S]*?)\s*```/);
      if (codeMatch && codeMatch[1]) {
        return codeMatch[1].trim();
      }

      const trimmed = response.content.trim();
      if (trimmed.includes('function') || trimmed.includes('const') || trimmed.includes('var')) {
        return trimmed;
      }

      return null;
    } catch (error) {
      logger.error('API', error);
      return null;
    }
  }

  async generateSuggestions(
    detected: DetectedEnvironmentVariables,
    missing: MissingAPI[],
    browserType: BrowserType
  ): Promise<string[]> {
    if (!this.llm) {
      return this.getDefaultSuggestions(detected, missing);
    }

    try {
      const response = await this.llm.chat(
        generateEnvironmentSuggestionsMessages(
          detected as unknown as Record<string, string[]>,
          missing,
          browserType
        )
      );

      const jsonMatch =
        response.content.match(/```json\s*([\s\S]*?)\s*```/) ||
        response.content.match(/\[[\s\S]*\]/);

      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        const suggestions = JSON.parse(jsonStr);
        if (Array.isArray(suggestions) && suggestions.every((s) => typeof s === 'string')) {
          return suggestions;
        }
      }

      return this.getDefaultSuggestions(detected, missing);
    } catch (error) {
      logger.error('', error);
      return this.getDefaultSuggestions(detected, missing);
    }
  }

  private getDefaultSuggestions(
    detected: DetectedEnvironmentVariables,
    missing: MissingAPI[]
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
