import { mergeUnique } from '@modules/captcha/rules/shared';

const GENERIC_CAPTCHA_TITLE_KEYWORDS = [
  'captcha',
  'challenge',
  'verify',
  'verification',
  'robot',
  'human',
  'security check',
  'bot check',
  'anti-bot',
] as const;

const PROVIDER_CAPTCHA_TITLE_KEYWORDS = [
  'browser check',
  'security challenge',
  'human check',
  'verification widget',
  'widget challenge',
] as const;

const ZH_CAPTCHA_TITLE_KEYWORDS = [
  '验证码',
  '安全验证',
  '人机验证',
  '滑动验证',
  '身份验证',
  '安全检测',
] as const;

const GENERIC_CAPTCHA_URL_KEYWORDS = [
  'captcha',
  'challenge',
  'verify',
  'verification',
  'robot-check',
  'security-check',
  'bot-check',
] as const;

const EDGE_PROVIDER_URL_KEYWORDS = [
  'cdn-cgi/challenge',
  'challenge-platform',
  'browser-check',
  'security-check',
  'interstitial',
] as const;

const EMBEDDED_WIDGET_URL_KEYWORDS = [
  'captcha-frame',
  'challenge-frame',
  'widget-challenge',
  'siteverify',
  'sitekey',
] as const;

const REGIONAL_PROVIDER_URL_KEYWORDS = ['slider-verify', 'drag-verify', 'slide-check'] as const;

const GENERIC_CAPTCHA_TEXT_KEYWORDS = [
  'Please verify',
  'Verify you are human',
  'Complete the security check',
  'Slide to verify',
  'Click to verify',
  'Drag the slider',
  'Prove you are human',
  'I am not a robot',
  'Checking your browser',
  'Just a moment',
  'Checking if the site connection is secure',
  'This process is automatic',
  'Protected by',
  'Powered by',
  'Are you a robot',
  'Confirm you are human',
  'Security verification required',
] as const;

const ZH_CAPTCHA_TEXT_KEYWORDS = [
  '请完成安全验证',
  '请滑动验证',
  '拖动滑块',
  '点击验证',
  '人机验证',
  '安全检测中',
  '请证明您是人类',
  '正在检查您的浏览器',
  '请稍候',
  '验证您的身份',
  '请完成验证',
  '滑动滑块',
  '请拖动滑块完成验证',
] as const;

export const CAPTCHA_KEYWORDS = {
  title: mergeUnique([
    ...GENERIC_CAPTCHA_TITLE_KEYWORDS,
    ...PROVIDER_CAPTCHA_TITLE_KEYWORDS,
    ...ZH_CAPTCHA_TITLE_KEYWORDS,
  ]),
  url: mergeUnique([
    ...GENERIC_CAPTCHA_URL_KEYWORDS,
    ...EDGE_PROVIDER_URL_KEYWORDS,
    ...EMBEDDED_WIDGET_URL_KEYWORDS,
    ...REGIONAL_PROVIDER_URL_KEYWORDS,
  ]),
  text: mergeUnique([...GENERIC_CAPTCHA_TEXT_KEYWORDS, ...ZH_CAPTCHA_TEXT_KEYWORDS]),
} as const;
