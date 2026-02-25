import { Page } from 'rebrowser-puppeteer-core';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { logger } from '../../utils/logger.js';
import { LLMService } from '../../services/LLMService.js';

export interface AICaptchaDetectionResult {
  detected: boolean;
  type?: 'slider' | 'image' | 'recaptcha' | 'hcaptcha' | 'cloudflare' | 'text_input' | 'none';
  confidence: number;
  reasoning: string;
  location?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  screenshot?: string;
  screenshotPath?: string;
  vendor?: string;
  suggestions?: string[];
}

export class AICaptchaDetector {
  private llm: LLMService;
  private screenshotDir: string;
  private hasLoggedVisionFallback = false;

  constructor(llm: LLMService, screenshotDir: string = './screenshots') {
    this.llm = llm;
    this.screenshotDir = screenshotDir;
  }

  private async saveScreenshot(screenshotBase64: string): Promise<string> {
    try {
      await mkdir(this.screenshotDir, { recursive: true });

      const timestamp = Date.now();
      const filename = `captcha-${timestamp}.png`;
      const filepath = join(this.screenshotDir, filename);

      const buffer = Buffer.from(screenshotBase64, 'base64');
      await writeFile(filepath, buffer);

      logger.info(`Screenshot saved: ${filepath}`);
      return filepath;
    } catch (error) {
      logger.error('', error);
      throw error;
    }
  }

  async detect(page: Page): Promise<AICaptchaDetectionResult> {
    try {
      logger.info('Running AI captcha detection...');

      const screenshot = await page.screenshot({
        encoding: 'base64',
        fullPage: false,
      });

      const pageInfo = await this.getPageInfo(page);

      const analysis = await this.analyzeWithAI(screenshot as string, pageInfo);

      logger.info(`AI: ${analysis.detected ? '' : ''} (: ${analysis.confidence}%)`);

      return analysis;
    } catch (error) {
      logger.error('AI', error);
      return {
        detected: false,
        confidence: 0,
        reasoning: `: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async getPageInfo(page: Page): Promise<{
    url: string;
    title: string;
    bodyText: string;
    hasIframes: boolean;
    suspiciousElements: string[];
  }> {
    const url = page.url();
    const title = await page.title();

    const info = await page.evaluate(() => {
      const bodyText = document.body.innerText.substring(0, 1000);

      const hasIframes = document.querySelectorAll('iframe').length > 0;

      const suspiciousElements: string[] = [];

      const captchaSelectors = [
        '[class*="captcha"]',
        '[id*="captcha"]',
        '[class*="verify"]',
        '[id*="verify"]',
        '[class*="challenge"]',
        'iframe[src*="recaptcha"]',
        'iframe[src*="hcaptcha"]',
        '.geetest_holder',
        '#nc_1_wrapper',
      ];

      for (const selector of captchaSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          suspiciousElements.push(`${selector} (${elements.length})`);
        }
      }

      return {
        bodyText,
        hasIframes,
        suspiciousElements,
      };
    });

    return {
      url,
      title,
      ...info,
    };
  }

  private async analyzeWithAI(
    screenshot: string,
    pageInfo: {
      url: string;
      title: string;
      bodyText: string;
      hasIframes: boolean;
      suspiciousElements: string[];
    }
  ): Promise<AICaptchaDetectionResult> {
    const prompt = this.buildAnalysisPrompt(pageInfo);

    try {
      logger.info('Starting AI captcha analysis...');

      const response = await this.llm.analyzeImage(screenshot, prompt);

      logger.info('AI analysis completed. Parsing response...');

      return this.parseAIResponse(response, '');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const visionUnsupported = errorMessage.includes('does not support image analysis');

      if (visionUnsupported) {
        if (!this.hasLoggedVisionFallback) {
          logger.warn(
            'Configured model does not support vision. Falling back to external analysis guidance.'
          );
          this.hasLoggedVisionFallback = true;
        }

        const screenshotPath = await this.saveScreenshot(screenshot);

        return {
          detected: false,
          type: 'none',
          confidence: 0,
          reasoning:
            'The configured MCP model does not support image analysis and requires external AI assistance.\n\n' +
            'A screenshot has been saved (see screenshotPath).\n' +
            'The analysis prompt is included below.\n\n' +
            'Use a vision-capable model (for example GPT-4o or Claude 3) to analyze the screenshot and determine whether a captcha is present.\n\n' +
            '---\n\n' +
            `${prompt}\n\n` +
            '---\n\n' +
            'Review the file at screenshotPath with the prompt above.',
          screenshotPath,
          vendor: 'external-ai-required',
          suggestions: [
            `Use a vision-capable model to analyze the screenshot: ${screenshotPath}`,
            'Reuse the prompt embedded in the reasoning field',
            'After analysis, manually decide whether captcha handling is required',
            'Or configure MCP with a vision-capable model (for example gpt-4o or claude-3-opus)',
          ],
        };
      }

      logger.error('AI captcha analysis failed:', errorMessage);
      logger.info('Falling back to rule-based captcha detection');
      return this.fallbackTextAnalysis(pageInfo);
    }
  }

  private buildAnalysisPrompt(pageInfo: {
    url: string;
    title: string;
    bodyText: string;
    hasIframes: boolean;
    suspiciousElements: string[];
  }): string {
    return `# 

## 
，（CAPTCHA），。

## 
\`\`\`json
{
  "url": "${pageInfo.url}",
  "title": "${pageInfo.title}",
  "hasIframes": ${pageInfo.hasIframes},
  "suspiciousElements": ${JSON.stringify(pageInfo.suspiciousElements)},
  "bodyTextPreview": "${pageInfo.bodyText.substring(0, 200).replace(/"/g, '\\"')}..."
}
\`\`\`

## 

### 1. （Interactive CAPTCHA）
**1.1 （Slider CAPTCHA）**
- ****: 、
- ****: (Geetest)、、、
- ****: 、、""
- **DOM**: \`.geetest_slider\`, \`.nc_1_wrapper\`, \`.tcaptcha-transform\`

**1.2 （Image CAPTCHA）**
- ****: （""）
- ****: reCAPTCHA v2、hCaptcha
- ****: 3x34x4、
- **DOM**: \`iframe[src*="recaptcha"]\`, \`.h-captcha\`

**1.3 （Text CAPTCHA）**
- ****: /
- ****: 、
- ****: ""

### 2. （Automatic CAPTCHA）
**2.1 reCAPTCHA v3**
- ****: ，reCAPTCHA
- ****: "Protected by reCAPTCHA" 

**2.2 Cloudflare Turnstile**
- ****: "" / "Checking your browser"
- ****: Cloudflare logo、、Ray ID

### 3. （False Positives - ）
**3.1 **
-  、、
-  ""（）
-  ""（）

**3.2 **
-  、
-  、
-  

**3.3 UI**
-  Range slider、Progress bar
-  Carousel、Swiper
-  、

## 

### Step 1: 
1. ：
   -  + 
   -  + 
   - ""
   - ""
   - Cloudflare/reCAPTCHA logo

### Step 2: 
1. URL：
   - \`/captcha\`, \`/challenge\`, \`/verify\`
   - \`cdn-cgi/challenge\` (Cloudflare)
   - \`recaptcha.net\`, \`hcaptcha.com\`

2. ：
   - ""、""、""
   - "Verify", "Challenge", "Security Check"

3. ：
   - suspiciousElements → 
   -  → 

### Step 3: 
1. ：
   - ""、""
   - ，
   - →  \`detected: false\`

2. /UI：
   - 、、
   - →  \`detected: false\`

### Step 4: 
- **90-100%**:  + DOM
- **70-89%**: ，DOM
- **50-69%**: ，
- **0-49%**: 

## 

**JSON Schema**:

\`\`\`json
{
  "detected": boolean,
  "type": "slider" | "image" | "recaptcha" | "hcaptcha" | "cloudflare" | "text_input" | "none",
  "confidence": number,
  "reasoning": string,
  "location": {
    "x": number,
    "y": number,
    "width": number,
    "height": number
  } | null,
  "vendor": "geetest" | "tencent" | "aliyun" | "recaptcha" | "hcaptcha" | "cloudflare" | "unknown",
  "suggestions": string[]
}
\`\`\`

### 
- **detected**: （）
- **type**: （）
- **confidence**: （0-100）
- **reasoning**: （200，）
- **location**: （，null）
- **vendor**: （"unknown"）
- **suggestions**: （，2-3）

### 

**1: **
\`\`\`json
{
  "detected": true,
  "type": "slider",
  "confidence": 95,
  "reasoning": "：1) ；2) ''；3) DOM.geetest_slider。。",
  "location": {
    "x": 450,
    "y": 300,
    "width": 320,
    "height": 180
  },
  "vendor": "geetest",
  "suggestions": [
    "",
    "captcha_wait",
    "，"
  ]
}
\`\`\`

**2:  - **
\`\`\`json
{
  "detected": false,
  "type": "none",
  "confidence": 95,
  "reasoning": "''''，，。，。",
  "location": null,
  "vendor": "unknown",
  "suggestions": [
    "，",
    ""
  ]
}
\`\`\`

**3: **
\`\`\`json
{
  "detected": false,
  "type": "none",
  "confidence": 98,
  "reasoning": "，、。，suspiciousElements，URL。",
  "location": null,
  "vendor": "unknown",
  "suggestions": [
    "，",
    ""
  ]
}
\`\`\`

## 

1. ****:  \`detected: false\`，
2. ****:  > DOM > 
3. ****: URL、、DOM、
4. ****: reasoning
5. ****: suggestions

，JSON。`;
  }

  private parseAIResponse(response: string, screenshotPath: string): AICaptchaDetectionResult {
    try {
      const jsonMatch =
        response.match(/```json\s*([\s\S]*?)\s*```/) || response.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        throw new Error('AIJSON');
      }

      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const result = JSON.parse(jsonStr);

      return {
        detected: result.detected || false,
        type: result.type || 'none',
        confidence: result.confidence || 0,
        reasoning: result.reasoning || '',
        location: result.location,
        vendor: result.vendor,
        suggestions: result.suggestions || [],
        screenshotPath: screenshotPath || undefined,
      };
    } catch (error) {
      logger.error('AI', error);

      const detected =
        response.toLowerCase().includes('detected') && response.toLowerCase().includes('true');

      return {
        detected,
        confidence: detected ? 50 : 80,
        reasoning: `AI parse failed, raw response: ${response.substring(0, 200)}`,
        screenshotPath: screenshotPath || undefined,
      };
    }
  }

  private fallbackTextAnalysis(pageInfo: {
    url: string;
    title: string;
    bodyText: string;
    hasIframes: boolean;
    suspiciousElements: string[];
  }): AICaptchaDetectionResult {
    logger.warn('');

    const hasCaptchaElements = pageInfo.suspiciousElements.length > 0;
    const hasCaptchaKeywords =
      pageInfo.title.toLowerCase().includes('captcha') ||
      pageInfo.title.toLowerCase().includes('verify') ||
      pageInfo.bodyText.toLowerCase().includes('') ||
      pageInfo.bodyText.toLowerCase().includes('');

    const detected = hasCaptchaElements && hasCaptchaKeywords;

    return {
      detected,
      confidence: detected ? 60 : 90,
      reasoning: `: ${detected ? '' : ''}`,
      suggestions: detected ? ['', ''] : ['Solve the CAPTCHA manually'],
    };
  }

  async waitForCompletion(page: Page, timeout: number = 300000): Promise<boolean> {
    logger.info('Waiting for CAPTCHA to be solved...');

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const result = await this.detect(page);

      if (!result.detected || result.confidence < 50) {
        logger.info(' ');
        return true;
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    logger.error(' ');
    return false;
  }
}
