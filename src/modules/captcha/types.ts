/**
 * Shared type definitions for CAPTCHA detection modules.
 *
 * These types are used by both CaptchaDetector (rule-based) and AICaptchaDetector (LLM-based).
 */

/**
 * Supported CAPTCHA types.
 */
export type CaptchaType =
  | 'slider'
  | 'image'
  | 'recaptcha'
  | 'hcaptcha'
  | 'cloudflare'
  | 'turnstile'
  | 'page_redirect'
  | 'url_redirect'
  | 'text_input'
  | 'none'
  | 'unknown';

/**
 * Known CAPTCHA vendors/providers.
 */
export type CaptchaVendor =
  | 'geetest'
  | 'tencent'
  | 'aliyun'
  | 'cloudflare'
  | 'akamai'
  | 'datadome'
  | 'perimeter-x'
  | 'recaptcha'
  | 'hcaptcha'
  | 'turnstile'
  | 'arkose'
  | 'funcaptcha'
  | 'friendly-captcha'
  | 'external-ai-required'
  | 'unknown';

/**
 * Base interface for CAPTCHA detection results.
 */
export interface CaptchaDetectionResultBase {
  /** Whether a CAPTCHA was detected */
  detected: boolean;
  /** Type of CAPTCHA detected */
  type: CaptchaType;
  /** CAPTCHA vendor/provider */
  vendor?: CaptchaVendor;
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

/**
 * Default CAPTCHA detection configuration.
 */
export const DEFAULT_CAPTCHA_CONFIG: Required<CaptchaDetectionConfig> = {
  autoDetectCaptcha: true,
  autoSwitchHeadless: true,
  captchaTimeout: 5 * 60 * 1000, // 5 minutes
  defaultHeadless: true,
  askBeforeSwitchBack: true,
};
