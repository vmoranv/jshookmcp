import { mergeUnique } from '@modules/captcha/rules/shared';

const OTP_EXCLUDE_TITLE_KEYWORDS = [
  'verification code',
  'enter code',
  'sms code',
  'email verification',
  'phone verification',
  'verify your email',
  'verify your phone',
] as const;

const OTP_EXCLUDE_URL_KEYWORDS = [
  'verify-email',
  'verify-phone',
  'email-verification',
  'account-verification',
  'verify-account',
  'phone-verification',
  'sms-verification',
  'reset-password',
  'forgot-password',
] as const;

const OTP_EXCLUDE_TEXT_KEYWORDS = [
  'Enter verification code',
  'Get code',
  'Send code',
  'Enter the code',
  'We sent a code',
  'verification code sent',
  'Enter your authenticator code',
  'Two-factor authentication',
] as const;

const ZH_EXCLUDE_TITLE_KEYWORDS = [
  '短信验证',
  '邮箱验证',
  '输入验证码',
  '手机验证',
  '登录验证',
  '双重验证',
] as const;

const ZH_EXCLUDE_URL_KEYWORDS = ['验证邮箱', '验证手机', '重置密码'] as const;

const ZH_EXCLUDE_TEXT_KEYWORDS = [
  '输入验证码',
  '获取验证码',
  '发送验证码',
  '已发送验证码',
  '双因素认证',
] as const;

const AUTH_FLOW_TITLE_KEYWORDS = ['two-factor', '2fa', 'two-factor authentication'] as const;

export const EXCLUDE_KEYWORDS = {
  title: mergeUnique([
    ...OTP_EXCLUDE_TITLE_KEYWORDS,
    ...ZH_EXCLUDE_TITLE_KEYWORDS,
    ...AUTH_FLOW_TITLE_KEYWORDS,
  ]),
  url: mergeUnique([...OTP_EXCLUDE_URL_KEYWORDS, ...ZH_EXCLUDE_URL_KEYWORDS]),
  text: mergeUnique([...OTP_EXCLUDE_TEXT_KEYWORDS, ...ZH_EXCLUDE_TEXT_KEYWORDS]),
} as const;
