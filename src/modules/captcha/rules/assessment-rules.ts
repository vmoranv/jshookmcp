import type { CaptchaHeuristicRule } from '@modules/captcha/types';

export const CAPTCHA_MATCH_RULES: Readonly<{
  url: readonly CaptchaHeuristicRule[];
  title: readonly CaptchaHeuristicRule[];
  text: readonly CaptchaHeuristicRule[];
}> = {
  url: [
    {
      id: 'edge-browser-check',
      label: 'edge browser challenge',
      pattern:
        /(cdn-cgi\/challenge|challenge-platform|browser-check|security-check|bot-check|interstitial)/i,
      confidence: 95,
      typeHint: 'browser_check',
      providerHint: 'edge_service',
    },
    {
      id: 'embedded-widget-url',
      label: 'embedded widget challenge path',
      pattern:
        /(captcha-frame|challenge-frame|widget-challenge|widget\/verify|siteverify|sitekey)/i,
      confidence: 90,
      typeHint: 'widget',
      providerHint: 'embedded_widget',
    },
    {
      id: 'generic-url-challenge',
      label: 'generic captcha-like URL path',
      pattern: /(captcha|challenge|verify|verification|robot-check|security-check|bot-check)/i,
      confidence: 70,
      requiresDomConfirmation: true,
      typeHint: 'url_redirect',
    },
  ],
  title: [
    {
      id: 'generic-title-en',
      label: 'generic captcha title (english)',
      pattern:
        /\b(captcha|challenge|verify|verification|robot|human|security check|bot check|anti-bot)\b/i,
      confidence: 78,
      requiresDomConfirmation: true,
      typeHint: 'page_redirect',
    },
    {
      id: 'generic-title-zh',
      label: 'generic captcha title (chinese)',
      pattern: /(验证码|安全验证|人机验证|滑动验证|身份验证|安全检测)/,
      confidence: 82,
      requiresDomConfirmation: true,
      typeHint: 'page_redirect',
    },
  ],
  text: [
    {
      id: 'generic-text-en',
      label: 'generic captcha challenge text (english)',
      pattern:
        /(Please verify|Verify you are human|Complete the security check|Slide to verify|Click to verify|Drag the slider|Prove you are human|I am not a robot|Checking your browser|Just a moment|Checking if the site connection is secure|This process is automatic|Protected by|Powered by|Are you a robot|Confirm you are human|Security verification required)/i,
      confidence: 78,
      requiresDomConfirmation: true,
      typeHint: 'unknown',
    },
    {
      id: 'generic-text-zh',
      label: 'generic captcha challenge text (chinese)',
      pattern:
        /(请完成安全验证|请滑动验证|拖动滑块|点击验证|人机验证|安全检测中|请证明您是人类|正在检查您的浏览器|请稍候|验证您的身份|请完成验证|滑动滑块|请拖动滑块完成验证)/,
      confidence: 82,
      requiresDomConfirmation: true,
      typeHint: 'unknown',
    },
  ],
};

export const EXCLUDE_MATCH_RULES: Readonly<{
  url: readonly CaptchaHeuristicRule[];
  title: readonly CaptchaHeuristicRule[];
  text: readonly CaptchaHeuristicRule[];
}> = {
  url: [
    {
      id: 'otp-url-flow',
      label: 'otp/account verification URL',
      pattern:
        /(verify-email|verify-phone|email-verification|account-verification|verify-account|phone-verification|sms-verification|reset-password|forgot-password|验证邮箱|验证手机|重置密码)/i,
      confidence: 95,
    },
  ],
  title: [
    {
      id: 'otp-title-flow',
      label: 'otp/account verification title',
      pattern:
        /(verification code|enter code|sms code|email verification|phone verification|verify your email|verify your phone|短信验证|邮箱验证|输入验证码|手机验证|登录验证|双重验证)/i,
      confidence: 88,
    },
    {
      id: 'auth-title-flow',
      label: '2fa/authenticator title',
      pattern: /\b(two-factor|2fa|two-factor authentication)\b/i,
      confidence: 84,
    },
  ],
  text: [
    {
      id: 'otp-text-flow',
      label: 'otp/account verification text',
      pattern:
        /(Enter verification code|Get code|Send code|Enter the code|We sent a code|verification code sent|输入验证码|获取验证码|发送验证码|已发送验证码)/i,
      confidence: 82,
    },
    {
      id: '2fa-text-flow',
      label: '2fa/authenticator text',
      pattern: /(Enter your authenticator code|Two-factor authentication|双因素认证)/i,
      confidence: 84,
    },
  ],
};
