/**
 * Shared type definitions for CAPTCHA detection modules.
 *
 * These types are used by both CaptchaDetector (rule-based) and AICaptchaDetector (LLM-based).
 */

/**
 * Supported public CAPTCHA types.
 *
 * Keep these values interaction-oriented instead of product-oriented so the
 * external contract stays stable even if underlying providers change.
 */
export const CAPTCHA_TYPES = [
  'slider',
  'image',
  'widget',
  'browser_check',
  'page_redirect',
  'url_redirect',
  'text_input',
  'none',
  'unknown',
] as const;

export type CaptchaType = (typeof CAPTCHA_TYPES)[number];

/**
 * Generic provider hints surfaced to callers.
 *
 * These are intentionally broad categories, not real vendor/product names.
 */
export const CAPTCHA_PROVIDER_HINTS = [
  'regional_service',
  'embedded_widget',
  'edge_service',
  'managed_service',
  'external_review',
  'unknown',
] as const;

export type CaptchaProviderHint = (typeof CAPTCHA_PROVIDER_HINTS)[number];

/**
 * Compatibility aliases for legacy product-specific model outputs.
 */
export const LEGACY_CAPTCHA_TYPE_ALIASES: Readonly<Record<string, CaptchaType>> = {
  checkbox: 'widget',
  challenge_widget: 'widget',
  browsercheck: 'browser_check',
  'browser-check': 'browser_check',
  redirect: 'page_redirect',
};

/**
 * Compatibility aliases for legacy product-specific provider labels.
 */
export const LEGACY_CAPTCHA_PROVIDER_HINT_ALIASES: Readonly<Record<string, CaptchaProviderHint>> = {
  regional: 'regional_service',
  embedded: 'embedded_widget',
  widget: 'embedded_widget',
  edge: 'edge_service',
  managed: 'managed_service',
  'external-ai-required': 'external_review',
  unknown: 'unknown',
};

/**
 * Base interface for CAPTCHA detection results.
 */
export interface CaptchaDetectionResultBase {
  /** Whether a CAPTCHA was detected */
  detected: boolean;
  /** Type of CAPTCHA detected */
  type: CaptchaType;
  /** Broad provider hint, intentionally de-branded */
  providerHint?: CaptchaProviderHint;
  /** Detection confidence (0-100) */
  confidence: number;
}

/**
 * Result from rule-based CAPTCHA detection (CaptchaDetector).
 */
export interface CaptchaDetectionResult extends CaptchaDetectionResultBase {
  /** CSS selector that matched the CAPTCHA element */
  selector?: string;
  /** Page title when CAPTCHA was detected */
  title?: string;
  /** Page URL when CAPTCHA was detected */
  url?: string;
  /** Additional detection details */
  details?: unknown;
  /** Reason for false positive if detected but excluded */
  falsePositiveReason?: string;
}

/**
 * Signal source used during rule-based assessment.
 */
export const CAPTCHA_SIGNAL_SOURCES = ['url', 'title', 'dom', 'text', 'vendor'] as const;

export type CaptchaSignalSource = (typeof CAPTCHA_SIGNAL_SOURCES)[number];

/**
 * Signal polarity used during rule-based assessment.
 */
export const CAPTCHA_SIGNAL_KINDS = ['captcha', 'exclude'] as const;

export type CaptchaSignalKind = (typeof CAPTCHA_SIGNAL_KINDS)[number];

/**
 * Lightweight evidence emitted by heuristic detectors before any action is taken.
 */
export interface CaptchaSignal {
  source: CaptchaSignalSource;
  kind: CaptchaSignalKind;
  value: string;
  confidence: number;
  typeHint?: CaptchaType;
  providerHint?: CaptchaProviderHint;
  details?: unknown;
}

export interface CaptchaHeuristicRule {
  id: string;
  label: string;
  pattern: RegExp;
  confidence: number;
  requiresDomConfirmation?: boolean;
  typeHint?: Exclude<CaptchaType, 'none'>;
  providerHint?: CaptchaProviderHint;
}

export interface CaptchaDomRule {
  id: string;
  label: string;
  selectors: readonly string[];
  confidence: number;
  typeHint: Exclude<CaptchaType, 'none'>;
  providerHint?: CaptchaProviderHint;
  requiresVisibility?: boolean;
  verifier?: 'slider';
}

/**
 * Structured candidate surfaced by rule-based assessment.
 */
export interface CaptchaCandidate {
  source: CaptchaSignalSource;
  value: string;
  confidence: number;
  type: Exclude<CaptchaType, 'none'>;
  providerHint?: CaptchaProviderHint;
}

/**
 * Next-step recommendation from rule-based assessment before execution policy is applied.
 */
export const CAPTCHA_NEXT_STEPS = [
  'ignore',
  'observe',
  'ask_ai',
  'manual',
  'switch_to_headed',
] as const;

export type CaptchaNextStep = (typeof CAPTCHA_NEXT_STEPS)[number];

/**
 * Aggregated rule-based assessment. This is intended for higher-level policy
 * decisions so detection and action stay decoupled.
 */
export interface CaptchaAssessment {
  signals: CaptchaSignal[];
  candidates: CaptchaCandidate[];
  score: number;
  excludeScore: number;
  confidence: number;
  likelyCaptcha: boolean;
  recommendedNextStep: CaptchaNextStep;
  primaryDetection: CaptchaDetectionResult;
}

/**
 * Bounding box location for detected CAPTCHA.
 */
export interface CaptchaLocation {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Result from AI-based CAPTCHA detection (AICaptchaDetector).
 */
export interface AICaptchaDetectionResult extends CaptchaDetectionResultBase {
  /** AI reasoning/explanation for the detection */
  reasoning: string;
  /** Bounding box location of detected CAPTCHA */
  location?: CaptchaLocation | null;
  /** Base64 encoded screenshot (if captured) */
  screenshot?: string;
  /** Path to saved screenshot file */
  screenshotPath?: string;
  /** Suggestions for handling the CAPTCHA */
  suggestions?: string[];
}

/**
 * Configuration for CAPTCHA detection behavior.
 */
export interface CaptchaDetectionConfig {
  /** Enable automatic CAPTCHA detection */
  autoDetectCaptcha?: boolean;
  /** Automatically switch from headless to headed mode when CAPTCHA is detected */
  autoSwitchHeadless?: boolean;
  /** Timeout in milliseconds for waiting for CAPTCHA completion */
  captchaTimeout?: number;
  /** Default headless mode setting */
  defaultHeadless?: boolean;
  /** Ask user before switching back to headless mode */
  askBeforeSwitchBack?: boolean;
}

/**
 * Page information used for AI-based CAPTCHA analysis.
 */
export interface CaptchaPageInfo {
  url: string;
  title: string;
  bodyText: string;
  hasIframes: boolean;
  suspiciousElements: string[];
}
