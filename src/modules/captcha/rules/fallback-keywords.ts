import { mergeUnique } from '@modules/captcha/rules/shared';

const FALLBACK_CAPTCHA_ENGLISH = [
  'captcha',
  'verification challenge',
  'security check',
  'human verification',
  'slide to verify',
  'drag the slider',
  'select all images',
  'i am not a robot',
  'protected by security verification',
  'checking your browser',
] as const;

const FALLBACK_CAPTCHA_CHINESE = [
  '验证码',
  '人机验证',
  '安全验证',
  '滑动验证',
  '拖动滑块',
  '请完成验证',
  '请完成安全验证',
  '请证明您是人类',
  '正在检查您的浏览器',
] as const;

const FALLBACK_EXCLUDE_ENGLISH = [
  'verification code',
  'enter verification code',
  'sms code',
  'email verification',
  'phone verification',
  'two-factor authentication',
  'authenticator code',
] as const;

const FALLBACK_EXCLUDE_CHINESE = [
  '输入验证码',
  '短信验证码',
  '邮箱验证码',
  '获取验证码',
  '发送验证码',
  '双因素认证',
] as const;

export const FALLBACK_CAPTCHA_KEYWORDS = mergeUnique([
  ...FALLBACK_CAPTCHA_ENGLISH,
  ...FALLBACK_CAPTCHA_CHINESE,
]);

export const FALLBACK_EXCLUDE_KEYWORDS = mergeUnique([
  ...FALLBACK_EXCLUDE_ENGLISH,
  ...FALLBACK_EXCLUDE_CHINESE,
]);
