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
  recaptcha: 'widget',
  hcaptcha: 'widget',
  turnstile: 'widget',
  cloudflare: 'browser_check',
};

/**
 * Compatibility aliases for legacy product-specific provider labels.
 */
export const LEGACY_CAPTCHA_PROVIDER_HINT_ALIASES: Readonly<
  Record<string, CaptchaProviderHint>
> = {
  geetest: 'regional_service',
  tencent: 'regional_service',
  aliyun: 'regional_service',
  keycaptcha: 'regional_service',
  yidun: 'regional_service',
  'netease-captcha': 'regional_service',
  recaptcha: 'embedded_widget',
  hcaptcha: 'embedded_widget',
  turnstile: 'embedded_widget',
  cloudflare: 'edge_service',
  akamai: 'edge_service',
  datadome: 'edge_service',
  'perimeter-x': 'edge_service',
  perimeterx: 'edge_service',
  perimeter: 'edge_service',
  'px-captcha': 'edge_service',
  incapsula: 'edge_service',
  distil: 'edge_service',
  'shield-square': 'edge_service',
  arkose: 'managed_service',
  funcaptcha: 'managed_service',
  'friendly-captcha': 'managed_service',
  'iw-captcha': 'managed_service',
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

