import { BrowserController } from './browserController';
import { Page } from 'playwright';

/**
 * CAPTCHA detection result from DOM analysis
 */
export interface CaptchaDetection {
  detected: boolean;
  type: 'recaptcha_v2' | 'recaptcha_v3' | 'hcaptcha' | 'turnstile' | 'custom' | 'none';
  elements: {
    iframe?: string;        // iframe selector
    checkbox?: string;      // checkbox selector
    challenge?: string;     // challenge container selector
    response?: string;      // response textarea selector
  };
  confidence: number;       // 0-1
}

/**
 * reCAPTCHA tile extracted from DOM
 */
export interface RecaptchaTile {
  index: number;
  coordinates: { x: number; y: number; width: number; height: number };
  selector?: string;
  centerX: number;
  centerY: number;
}

/**
 * CAPTCHA solve result
 */
export interface CaptchaSolveResult {
  success: boolean;
  message: string;
  captchaType: string;
  solveTime?: number;       // milliseconds
}

/**
 * DOM-Based CAPTCHA Solver
 *
 * Strategy: Use DOM analysis (browser-use style) instead of vision models
 * - Faster: Direct DOM queries vs screenshot + vision processing
 * - More accurate: Actual element detection vs image classification
 * - Lighter: No heavy vision model calls for detection
 *
 * Vision models are still used for solving (e.g., selecting reCAPTCHA tiles)
 * but detection is pure DOM-based
 */
export class CaptchaSolver {
  private browserController: BrowserController;
  private page: Page | null = null;
  private visionModel: any = null;
  private buildVisionContentParts: any = null; // Function from llmService

  constructor(browserController: BrowserController) {
    this.browserController = browserController;
  }

  /**
   * Set vision model and helper function (injected from llmService)
   */
  setVisionModel(visionModel: any, buildVisionContentParts: any): void {
    this.visionModel = visionModel;
    this.buildVisionContentParts = buildVisionContentParts;
  }

  /**
   * Set the current page (from browserController)
   */
  setPage(page: Page): void {
    this.page = page;
  }

  /**
   * Main entry: Detect CAPTCHA using DOM analysis
   */
  async detectCaptcha(): Promise<CaptchaDetection> {
    if (!this.page) {
      return { detected: false, type: 'none', elements: {}, confidence: 0 };
    }

    try {
      // Run DOM analysis in browser context
      const result = await this.page.evaluate(() => {
        // Check for reCAPTCHA v2
        const recaptchaIframe = document.querySelector('iframe[src*="recaptcha"][src*="/anchor"]');
        const recaptchaDiv = document.querySelector('.g-recaptcha');
        const recaptchaResponse = document.querySelector('textarea[name="g-recaptcha-response"]');
        const recaptchaAnchor = document.querySelector('#recaptcha-anchor');

        if (recaptchaIframe || recaptchaDiv || recaptchaResponse || recaptchaAnchor) {
          return {
            detected: true,
            type: 'recaptcha_v2' as const,
            elements: {
              iframe: recaptchaIframe ? 'iframe[src*="recaptcha"][src*="/anchor"]' : undefined,
              checkbox: '#recaptcha-anchor',
              response: 'textarea[name="g-recaptcha-response"]'
            },
            confidence: 0.95
          };
        }

        // Check for reCAPTCHA v3 (invisible, usually just script tag)
        const recaptchaV3Script = document.querySelector('script[src*="recaptcha"][src*="/api.js"]');
        const recaptchaV3Badge = document.querySelector('.grecaptcha-badge');
        if (recaptchaV3Script || recaptchaV3Badge) {
          return {
            detected: true,
            type: 'recaptcha_v3' as const,
            elements: {
              response: 'textarea[name="g-recaptcha-response"]'
            },
            confidence: 0.9
          };
        }

        // Check for hCaptcha
        const hcaptchaIframe = document.querySelector('iframe[src*="hcaptcha"]');
        const hcaptchaDiv = document.querySelector('.h-captcha');
        const hcaptchaResponse = document.querySelector('textarea[name="h-captcha-response"]');

        if (hcaptchaIframe || hcaptchaDiv || hcaptchaResponse) {
          return {
            detected: true,
            type: 'hcaptcha' as const,
            elements: {
              iframe: 'iframe[src*="hcaptcha"]',
              response: 'textarea[name="h-captcha-response"]'
            },
            confidence: 0.95
          };
        }

        // Check for Cloudflare Turnstile
        const turnstileDiv = document.querySelector('.cf-turnstile, [class*="cf-challenge"]');
        const turnstileIframe = document.querySelector('iframe[src*="challenges.cloudflare"]');
        const turnstileInput = document.querySelector('input[name="cf-turnstile-response"]');

        if (turnstileDiv || turnstileIframe || turnstileInput) {
          return {
            detected: true,
            type: 'turnstile' as const,
            elements: {
              iframe: 'iframe[src*="challenges.cloudflare"]',
              challenge: '.cf-turnstile, [class*="cf-challenge"]',
              response: 'input[name="cf-turnstile-response"]'
            },
            confidence: 0.9
          };
        }

        // Check for custom "I'm not a robot" checkboxes (common pattern)
        const robotText = Array.from(document.querySelectorAll('*')).find(el => {
          const text = el.textContent?.toLowerCase() || '';
          return text.includes('not a robot') ||
                 text.includes('로봇이 아닙니다') ||
                 text.includes('verify you') ||
                 text.includes('human verification');
        });

        if (robotText) {
          // Look for nearby checkbox or clickable element
          const parent = robotText.parentElement;
          const checkbox = parent?.querySelector('input[type="checkbox"], [role="checkbox"], .checkbox');

          if (checkbox || parent) {
            return {
              detected: true,
              type: 'custom' as const,
              elements: {
                checkbox: checkbox ? 'input[type="checkbox"], [role="checkbox"]' : undefined
              },
              confidence: 0.7
            };
          }
        }

        return {
          detected: false,
          type: 'none' as const,
          elements: {},
          confidence: 0
        };
      });

      this.emitLog('system', {
        message: `CAPTCHA detection: ${result.detected ? result.type : 'none'} (confidence: ${result.confidence})`
      });

      return result;
    } catch (error: any) {
      this.emitLog('error', { message: `CAPTCHA detection error: ${error.message}` });
      return { detected: false, type: 'none', elements: {}, confidence: 0 };
    }
  }

  /**
   * Check if we're on a Cloudflare challenge page
   */
  async isCloudflareChallenge(): Promise<boolean> {
    if (!this.page) return false;

    try {
      const isCloudflare = await this.page.evaluate(() => {
        // Check URL patterns
        const url = window.location.href;
        if (url.includes('cdn-cgi/challenge-platform') ||
            url.includes('/cdn-cgi/challenge')) {
          return true;
        }

        // Check page title
        const title = document.title.toLowerCase();
        if (title.includes('just a moment') ||
            title.includes('attention required') ||
            title.includes('checking your browser')) {
          return true;
        }

        // Check for Cloudflare text patterns
        const bodyText = document.body.textContent?.toLowerCase() || '';
        const cfPatterns = [
          'checking your browser',
          'cloudflare',
          'ddos protection',
          'ray id'
        ];

        return cfPatterns.some(pattern => bodyText.includes(pattern));
      });

      return isCloudflare;
    } catch {
      return false;
    }
  }

  /**
   * Quick check: Is there any CAPTCHA-like element in DOM?
   */
  async hasCaptchaElements(): Promise<boolean> {
    const detection = await this.detectCaptcha();
    return detection.detected && detection.confidence > 0.5;
  }

  /**
   * Get CAPTCHA information for LLM context
   */
  async getCaptchaInfo(): Promise<string> {
    const detection = await this.detectCaptcha();

    if (!detection.detected) {
      return 'No CAPTCHA detected on current page.';
    }

    let info = `CAPTCHA detected: ${detection.type} (confidence: ${detection.confidence * 100}%)`;

    if (Object.keys(detection.elements).length > 0) {
      info += '\nElements found:';
      for (const [key, selector] of Object.entries(detection.elements)) {
        if (selector) {
          info += `\n  - ${key}: ${selector}`;
        }
      }
    }

    return info;
  }

  /**
   * Main solve method: Detect and solve CAPTCHA
   * Returns result with success status and message
   */
  async solve(): Promise<CaptchaSolveResult> {
    const startTime = Date.now();

    try {
      // Step 1: Detect CAPTCHA type
      const detection = await this.detectCaptcha();

      if (!detection.detected || detection.confidence < 0.5) {
        return {
          success: true,
          message: 'No CAPTCHA detected or confidence too low',
          captchaType: 'none',
          solveTime: Date.now() - startTime
        };
      }

      this.emitLog('system', {
        message: `Starting CAPTCHA solve: type=${detection.type}, confidence=${detection.confidence}`
      });

      // Step 2: Route to appropriate solver based on type
      let result: CaptchaSolveResult;

      switch (detection.type) {
        case 'recaptcha_v2':
          result = await this.solveRecaptchaV2();
          break;

        case 'hcaptcha':
          result = await this.solveHCaptcha();
          break;

        case 'turnstile':
          result = await this.solveTurnstile();
          break;

        case 'custom':
          result = await this.solveCustomCheckbox();
          break;

        case 'recaptcha_v3':
          // v3 is invisible, usually nothing to do
          result = {
            success: true,
            message: 'reCAPTCHA v3 detected (invisible, no action needed)',
            captchaType: 'recaptcha_v3'
          };
          break;

        default:
          result = {
            success: false,
            message: `Unknown CAPTCHA type: ${detection.type}`,
            captchaType: detection.type
          };
      }

      result.solveTime = Date.now() - startTime;
      return result;

    } catch (error: any) {
      return {
        success: false,
        message: `CAPTCHA solve error: ${error.message}`,
        captchaType: 'unknown',
        solveTime: Date.now() - startTime
      };
    }
  }

  /**
   * Solve reCAPTCHA v2
   * Uses existing browserController methods
   */
  private async solveRecaptchaV2(): Promise<CaptchaSolveResult> {
    try {
      // Click the anchor checkbox
      const clicked = await this.browserController.clickRecaptchaAnchor();

      if (!clicked) {
        return {
          success: false,
          message: 'Failed to click reCAPTCHA anchor',
          captchaType: 'recaptcha_v2'
        };
      }

      // Wait for challenge or auto-solve
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check if challenge appeared
      const challenge = await this.browserController.getRecaptchaChallenge();

      if (!challenge || !challenge.gridImageBase64) {
        // No challenge = auto-solved or pending
        return {
          success: true,
          message: 'reCAPTCHA anchor clicked, no challenge appeared (may be auto-solved)',
          captchaType: 'recaptcha_v2'
        };
      }

      // Challenge appeared - needs vision model to solve
      if (!this.visionModel) {
        return {
          success: false,
          message: 'reCAPTCHA challenge detected but vision model not available',
          captchaType: 'recaptcha_v2'
        };
      }

      // TODO: Implement full vision-based tile selection
      // For now, return partial success
      return {
        success: false,
        message: 'reCAPTCHA challenge detected - vision solving not yet integrated',
        captchaType: 'recaptcha_v2'
      };

    } catch (error: any) {
      return {
        success: false,
        message: `reCAPTCHA v2 solve error: ${error.message}`,
        captchaType: 'recaptcha_v2'
      };
    }
  }

  /**
   * Solve hCaptcha
   */
  private async solveHCaptcha(): Promise<CaptchaSolveResult> {
    return {
      success: false,
      message: 'hCaptcha solving not yet implemented',
      captchaType: 'hcaptcha'
    };
  }

  /**
   * Solve Cloudflare Turnstile
   */
  private async solveTurnstile(): Promise<CaptchaSolveResult> {
    try {
      // Turnstile usually auto-solves, just wait
      await new Promise(resolve => setTimeout(resolve, 5000));

      return {
        success: true,
        message: 'Waited for Turnstile (usually auto-solves)',
        captchaType: 'turnstile'
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Turnstile error: ${error.message}`,
        captchaType: 'turnstile'
      };
    }
  }

  /**
   * Extract reCAPTCHA grid tiles from DOM (browser-use style)
   * Returns tiles with exact coordinates for clicking
   */
  async extractRecaptchaTiles(): Promise<RecaptchaTile[]> {
    if (!this.page) return [];

    try {
      const tiles = await this.page.evaluate(() => {
        // Find all frames
        const frames = Array.from(document.querySelectorAll('iframe'));

        // Look for reCAPTCHA challenge frame
        const challengeFrame = frames.find(f =>
          f.src.includes('recaptcha') &&
          (f.src.includes('/bframe') || f.src.includes('challenge'))
        );

        if (!challengeFrame) {
          return [];
        }

        // Try to access frame content (may fail due to cross-origin)
        try {
          const frameDoc = challengeFrame.contentDocument || challengeFrame.contentWindow?.document;
          if (!frameDoc) return [];

          // Common selectors for reCAPTCHA grid tiles
          const tileSelectors = [
            '.rc-imageselect-tile',
            'td.rc-imageselect-tile',
            '[class*="tile"]',
            '.rc-image-tile-target'
          ];

          let tileElements: Element[] = [];
          for (const selector of tileSelectors) {
            tileElements = Array.from(frameDoc.querySelectorAll(selector));
            if (tileElements.length > 0) break;
          }

          if (tileElements.length === 0) {
            return [];
          }

          // Extract coordinates for each tile
          const result: RecaptchaTile[] = [];

          tileElements.forEach((tile, index) => {
            const rect = tile.getBoundingClientRect();

            // Get frame position relative to page
            const frameRect = challengeFrame.getBoundingClientRect();

            result.push({
              index,
              coordinates: {
                x: frameRect.left + rect.left,
                y: frameRect.top + rect.top,
                width: rect.width,
                height: rect.height
              },
              centerX: frameRect.left + rect.left + rect.width / 2,
              centerY: frameRect.top + rect.top + rect.height / 2
            });
          });

          return result;

        } catch (crossOriginError) {
          // Frame is cross-origin, cannot access
          // Fall back to grid calculation based on frame size
          const frameRect = challengeFrame.getBoundingClientRect();

          // Typical reCAPTCHA grid is 300x300 or 400x400
          // Assume 3x3 grid for now
          const gridSize = 3;
          const tileWidth = frameRect.width / gridSize;
          const tileHeight = frameRect.height / gridSize;

          const result: RecaptchaTile[] = [];

          for (let row = 0; row < gridSize; row++) {
            for (let col = 0; col < gridSize; col++) {
              const index = row * gridSize + col;
              const x = frameRect.left + col * tileWidth;
              const y = frameRect.top + row * tileHeight;

              result.push({
                index,
                coordinates: {
                  x,
                  y,
                  width: tileWidth,
                  height: tileHeight
                },
                centerX: x + tileWidth / 2,
                centerY: y + tileHeight / 2
              });
            }
          }

          return result;
        }
      });

      this.emitLog('system', {
        message: `Extracted ${tiles.length} reCAPTCHA tiles from DOM`
      });

      return tiles;

    } catch (error: any) {
      this.emitLog('error', {
        message: `Failed to extract reCAPTCHA tiles: ${error.message}`
      });
      return [];
    }
  }

  /**
   * Click specific reCAPTCHA tiles by their indices
   * Uses DOM-extracted coordinates for precise clicking
   */
  async clickRecaptchaTilesByIndices(indices: number[]): Promise<boolean> {
    if (indices.length === 0) return true;

    try {
      const tiles = await this.extractRecaptchaTiles();

      if (tiles.length === 0) {
        this.emitLog('error', { message: 'No tiles extracted, cannot click' });
        return false;
      }

      this.emitLog('system', {
        message: `Clicking tiles: [${indices.join(', ')}]`
      });

      // Click each tile by index
      for (const index of indices) {
        const tile = tiles.find(t => t.index === index);

        if (!tile) {
          this.emitLog('error', { message: `Tile ${index} not found` });
          continue;
        }

        // Click at center of tile
        await this.browserController.clickViewport(tile.centerX, tile.centerY);
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      return true;

    } catch (error: any) {
      this.emitLog('error', {
        message: `Failed to click tiles: ${error.message}`
      });
      return false;
    }
  }

  /**
   * Solve custom checkbox CAPTCHA
   */
  private async solveCustomCheckbox(): Promise<CaptchaSolveResult> {
    try {
      // Try to click checkbox using heuristics
      const clicked = await this.browserController.clickCheckboxLeftOfText([
        "i'm not a robot",
        'i am not a robot',
        '로봇이 아닙니다',
        'not a robot'
      ]);

      if (clicked) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return {
          success: true,
          message: 'Custom checkbox clicked',
          captchaType: 'custom'
        };
      }

      return {
        success: false,
        message: 'Failed to click custom checkbox',
        captchaType: 'custom'
      };

    } catch (error: any) {
      return {
        success: false,
        message: `Custom checkbox error: ${error.message}`,
        captchaType: 'custom'
      };
    }
  }

  /**
   * Emit log through browser controller
   */
  private emitLog(type: string, data: any): void {
    this.browserController.emitLog(type, data);
  }
}
