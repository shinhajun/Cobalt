import { chromium, Browser, Page, ElementHandle, BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';

export class BrowserController extends EventEmitter {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private debugMode: boolean = true;
  private debugDir: string = './debug';
  private context: BrowserContext | null = null;

  constructor(debugMode: boolean = true) {
    super();
    this.debugMode = debugMode;
    // Create debug directory if it doesn't exist
    if (this.debugMode && !fs.existsSync(this.debugDir)) {
      fs.mkdirSync(this.debugDir, { recursive: true });
    }
  }

  public emitLog(type: string, data: any) {
    this.emit('log', { type, data, timestamp: new Date().toISOString() });
  }

  async launch(): Promise<void> {
    // Chromium 채널 우선 시도(설치 환경에 따라 기본 chromium 사용)
    try {
      this.browser = await chromium.launch({
        channel: 'chrome',
        headless: true,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,PaintHolding',
          '--disable-site-isolation-trials',
          '--disable-renderer-backgrounding',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--no-sandbox',
          '--disable-gpu',
          '--use-angle=swiftshader',
        ],
        timeout: 60000,
      });
    } catch (_) {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,PaintHolding',
          '--disable-site-isolation-trials',
          '--disable-renderer-backgrounding',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--no-sandbox',
          '--disable-gpu',
          '--use-angle=swiftshader',
        ],
        timeout: 60000,
      });
    }

    const storageStatePath = path.join(this.debugDir, 'storageState.json');
    const context = await this.browser.newContext({
      viewport: { width: 1600, height: 1000 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', // 최신 Chrome
      locale: 'ko-KR',
      acceptDownloads: true,
      extraHTTPHeaders: {
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      storageState: fs.existsSync(storageStatePath) ? storageStatePath : undefined,
    });
    this.context = context;

    // 간단한 스텔스 스크립트 적용 (자동화 탐지 회피에 도움)
    await context.addInitScript(() => {
      try {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        // @ts-ignore
        window.chrome = { runtime: {} };
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      } catch (_) {}
    });

    this.page = await context.newPage();
    this.emitLog('system', { message: 'Browser launched.' });

    // Take initial screenshot after launch
    await this.streamScreenshot('browser-launched');
  }

  async goTo(url: string): Promise<void> {
    if (!this.page) {
      throw new Error('Page is not initialized. Call launch() first.');
    }
    this.emitLog('system', { message: `Navigating to ${url}...` });
    await this.page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await this.page.waitForTimeout(1000); // 안정화
    this.emitLog('system', { message: `Successfully navigated to ${url}.` });

    // Take screenshot after navigation
    await this.streamScreenshot('navigation');
    if (this.debugMode) await this.takeDebugScreenshot('after-navigation');

    // 구글 동의/오버레이 처리 시도
    try {
      const currentUrl = this.page.url();
      if (/https?:\/\/(www\.)?google\.[^/]+/.test(currentUrl)) {
        await this.handleGoogleConsentIfPresent();
      }
    } catch (_) {}
  }

  private getSelectorCandidates(original: string): string[] {
    const candidates = [original];
    // Google 검색 입력 관련 보완 셀렉터
    if (original.includes('input[name="q"]')) {
      candidates.push('textarea[name="q"]');
      candidates.push('input[aria-label="Search"]');
      candidates.push('textarea[aria-label="Search"]');
      candidates.push('input[aria-label="검색"]');
      candidates.push('textarea[aria-label="검색"]');
    }
    if (/google\./.test(this.page?.url() || '')) {
      // 일반적인 동의 버튼들
      if (original.includes('L2AGLb')) {
        candidates.push('button[aria-label="Accept all"]');
        candidates.push('button:has-text("I agree")');
        candidates.push('button:has-text("동의")');
      }
    }
    return Array.from(new Set(candidates));
  }

  private async handleGoogleConsentIfPresent(): Promise<void> {
    if (!this.page) return;
    try {
      const selectors = [
        'button#L2AGLb',
        'button[aria-label="Accept all"]',
        'button:has-text("I agree")',
        'button:has-text("동의")',
      ];
      for (const sel of selectors) {
        const el = await this.page.$(sel);
        if (el) {
          this.emitLog('system', { message: `Consent detected. Clicking ${sel}` });
          await el.click({ delay: 50 });
          await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
          await this.page.waitForTimeout(500);
          await this.streamScreenshot('consent-dismissed');
          break;
        }
      }
    } catch (e) {
      // 무시하고 진행
    }
  }

  async click(selector: string): Promise<boolean> {
    if (!this.page) {
      throw new Error('Page is not initialized. Call launch() first.');
    }

    try {
      this.emitLog('system', { message: `Attempting to click: ${selector}` });
      const element = await this.findElement(this.getSelectorCandidates(selector));
      if (element) {
        await element.hover();
        await this.page.waitForTimeout(120 + Math.random() * 180);
        await element.click({ delay: 50 + Math.floor(Math.random() * 120) });
        await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {}); // 클릭 후 페이지 변경 기다림 (오류 무시)
        await this.page.waitForTimeout(1000);
        this.emitLog('system', { message: `Clicked on ${selector}.` });

        // Take screenshot after click
        await this.streamScreenshot('click');
        if (this.debugMode) await this.takeDebugScreenshot('after-click');
        return true;
      }
      this.emitLog('error', { message: `Element not found for click: ${selector}` });
      if (this.debugMode) await this.takeDebugScreenshot('click-error');
      return false;
    } catch (error) {
      console.error(`Error clicking element: ${error}`);
      throw error;
    }
  }

  async type(selector: string, text: string): Promise<boolean> {
    if (!this.page) {
      throw new Error('Page is not initialized. Call launch() first.');
    }

    try {
      this.emitLog('system', { message: `Attempting to type '${text}' into: ${selector}` });
      const element = await this.findElement(this.getSelectorCandidates(selector));
      if (element) {
        // 사람처럼 타이핑 (fill 대신 type)
        await element.click();
        await this.page.waitForTimeout(150 + Math.random() * 250);
        await this.page.keyboard.type(text, { delay: 80 + Math.floor(Math.random() * 70) });
        this.emitLog('system', { message: `Typed '${text}' into ${selector}.` });

        // Take screenshot after typing
        await this.streamScreenshot('type');
        if (this.debugMode) await this.takeDebugScreenshot('after-type');
        return true;
      }
      this.emitLog('error', { message: `Element not found for type: ${selector}` });
      if (this.debugMode) await this.takeDebugScreenshot('type-error');
      return false;
    } catch (error) {
      console.error(`Error typing text: ${error}`);
      throw error;
    }
  }

  async pressKey(selector: string, key: string): Promise<boolean> {
    if (!this.page) {
      throw new Error('Page is not initialized. Call launch() first.');
    }

    try {
      this.emitLog('system', { message: `Attempting to press key '${key}' on: ${selector}` });
      const element = await this.findElement([selector]);
      if (element) {
        await element.press(key);
        await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        await this.page.waitForTimeout(1000);
        this.emitLog('system', { message: `Pressed key '${key}' on ${selector}.` });

        // Take screenshot after key press
        await this.streamScreenshot('pressKey');
        if (this.debugMode) await this.takeDebugScreenshot('after-key-press');
        return true;
      }
      this.emitLog('error', { message: `Element not found for pressKey: ${selector}` });
      if (this.debugMode) await this.takeDebugScreenshot('key-press-error');
      return false;
    } catch (error) {
      console.error(`Error pressing key: ${error}`);
      throw error;
    }
  }

  // --- CAPTCHA detection helpers ---
  async detectGoogleSorryCaptcha(options?: { includeImage?: boolean }): Promise<{ detected: boolean; imageBase64?: string; inputSelector?: string; submitSelectorCandidates?: string[] }> {
    if (!this.page) return { detected: false };
    try {
      const url = this.page.url();
      const includeImage = !!(options && options.includeImage);
      let detected = /\/sorry\//.test(url);
      if (!detected) {
        // Check visible text hints
        const hint = await this.page.evaluate(() => {
          const text = document.body?.innerText || '';
          return /unusual\s+traffic/i.test(text) || /비정상적인\s*트래픽/.test(text);
        });
        detected = !!hint;
      }
      if (!detected) return { detected: false };

      let imageBase64: string | undefined;
      if (includeImage) {
        // 1) 시도: 폼 내 캡차 이미지 우선
        const imgSelectors = [
          'form[action*="sorry"] img',
          'img[src*="captcha"]',
          'img[alt*="captcha" i]',
          'img[src*="sorry"]',
          'img'
        ];
        for (const sel of imgSelectors) {
          try {
            const el = await this.page.$(sel);
            if (el) {
              const buf = await el.screenshot();
              imageBase64 = Buffer.from(buf).toString('base64');
              this.emitLog('system', { message: `Google Sorry captcha image captured via selector: ${sel}` });
              break;
            }
          } catch (_) {}
        }
        // 2) 폼 자체 스크린샷으로 대체
        if (!imageBase64) {
          try {
            const form = await this.page.$('form[action*="sorry"], form#captcha-form, form');
            if (form) {
              const buf = await form.screenshot();
              imageBase64 = Buffer.from(buf).toString('base64');
              this.emitLog('system', { message: 'Google Sorry captcha form captured as fallback.' });
            }
          } catch (_) {}
        }
        // 3) 최후 수단: 페이지 전체 스크린샷
        if (!imageBase64) {
          try {
            const buf = await this.page.screenshot({ fullPage: true });
            imageBase64 = Buffer.from(buf).toString('base64');
            this.emitLog('system', { message: 'Full page captured as captcha fallback.' });
          } catch (_) {}
        }
      }

      // Input and submit candidates
      const inputSelectorCandidates = [
        'form[action*="sorry"] input[name="captcha"]',
        'form[action*="sorry"] input#captcha',
        'form[action*="sorry"] input[type="text"]',
        'input[name="captcha"]',
        'input#captcha',
        'input[type="text"]',
      ];
      let inputSelector: string | undefined;
      for (const sel of inputSelectorCandidates) {
        const el = await this.page.$(sel);
        if (el) { inputSelector = sel; break; }
      }
      const submitSelectorCandidates = [
        'form[action*="sorry"] input[type="submit"]',
        'form[action*="sorry"] button[type="submit"]',
        'form[action*="sorry"] button:has-text("Submit")',
        'form[action*="sorry"] button:has-text("확인")',
        'form[action*="sorry"] button:has-text("Continue")',
        'input[type="submit"]',
        'button[type="submit"]',
        'button:has-text("Submit")',
        'button:has-text("확인")',
        'button:has-text("Continue")',
        'input[name="submit"]',
      ];

      return { detected: true, imageBase64, inputSelector, submitSelectorCandidates };
    } catch (e) {
      return { detected: false };
    }
  }

  async detectRecaptchaV2(): Promise<{ detected: boolean; siteKey?: string }> {
    if (!this.page) return { detected: false };
    try {
      // Try div.g-recaptcha
      const info = await this.page.evaluate(() => {
        const recaptchaDiv = document.querySelector('div.g-recaptcha') as HTMLElement | null;
        const siteKeyAttr = recaptchaDiv?.getAttribute('data-sitekey') || '';
        // Try iframe fallback (k=sitekey in src)
        const iframe = Array.from(document.querySelectorAll('iframe'))
          .find((f: Element) => (f as HTMLIFrameElement).src.includes('google.com/recaptcha')) as HTMLIFrameElement | undefined;
        const iframeSrc = iframe?.src || '';
        return { siteKeyAttr, iframeSrc };
      });
      let siteKey = info.siteKeyAttr;
      if (!siteKey && info.iframeSrc) {
        const m = /[?&]k=([^&]+)/.exec(info.iframeSrc);
        if (m) siteKey = decodeURIComponent(m[1]);
      }
      if (siteKey) {
        return { detected: true, siteKey };
      }
      return { detected: false };
    } catch (_) {
      return { detected: false };
    }
  }

  async injectRecaptchaV2Token(token: string): Promise<boolean> {
    if (!this.page) return false;
    try {
      await this.page.evaluate((tok) => {
        const ensure = () => {
          let t = document.querySelector('textarea[name="g-recaptcha-response"]') as HTMLTextAreaElement | null;
          if (!t) {
            t = document.createElement('textarea');
            t.name = 'g-recaptcha-response';
            t.style.display = 'none';
            document.body.appendChild(t);
          }
          t.value = tok;
          t.dispatchEvent(new Event('input', { bubbles: true }));
          t.dispatchEvent(new Event('change', { bubbles: true }));
        };
        ensure();
      }, token);
      // Try to submit the form if present
      const submitted = await this.tryClickSelectors([
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("Submit")',
      ]);
      if (!submitted) {
        // Fallback: press Enter on any focused element
        try { await this.page.keyboard.press('Enter'); } catch (_) {}
      }
      await this.waitForPageLoad(8000);
      return true;
    } catch (e) {
      this.emitLog('error', { message: 'Failed to inject reCAPTCHA token: ' + (e as Error).message });
      return false;
    }
  }

  private async tryClickSelectors(selectors: string[]): Promise<boolean> {
    if (!this.page) return false;
    for (const sel of selectors) {
      try {
        const el = await this.page.$(sel);
        if (el) {
          await el.click({ delay: 50 });
          await this.page.waitForTimeout(500);
          await this.streamScreenshot('after-captcha-click');
          return true;
        }
      } catch (_) {}
    }
    return false;
  }

  async typeCaptchaAndSubmit(inputSelector: string | undefined, text: string, submitSelectorCandidates: string[] = []): Promise<boolean> {
    if (!this.page) return false;
    try {
      const sel = inputSelector || 'input[name="captcha"], input#captcha, input[type="text"]';
      const el = await this.findElement([sel]);
      if (!el) return false;
      await el.click();
      await this.page.waitForTimeout(150);
      await this.page.keyboard.type(text, { delay: 80 + Math.floor(Math.random() * 70) });
      // Try submit
      const clicked = await this.tryClickSelectors(submitSelectorCandidates.length ? submitSelectorCandidates : [
        'input[type="submit"]',
        'button[type="submit"]',
        'button:has-text("Submit")',
        'button:has-text("확인")',
      ]);
      if (!clicked) {
        try { await this.page.keyboard.press('Enter'); } catch (_) {}
      }
      await this.waitForPageLoad(8000);
      return true;
    } catch (e) {
      this.emitLog('error', { message: 'Failed to type captcha text: ' + (e as Error).message });
      return false;
    }
  }

  // --- reCAPTCHA (vision-based interaction) helpers ---
  private getRecaptchaFrames() {
    if (!this.page) return { anchorFrame: null as any, challengeFrame: null as any };
    const frames = this.page.frames();
    const anchorFrame = frames.find(f => /recaptcha/.test(f.url()) && /anchor/.test(f.url())) || null;
    const challengeFrame = frames.find(f => /recaptcha/.test(f.url()) && /bframe/.test(f.url())) || null;
    return { anchorFrame, challengeFrame };
  }

  async clickRecaptchaAnchor(): Promise<boolean> {
    if (!this.page) return false;
    const { anchorFrame } = this.getRecaptchaFrames();
    if (!anchorFrame) {
      this.emitLog('system', { message: 'reCAPTCHA anchor frame not found.' });
      return false;
    }
    try {
      this.emitLog('system', { message: 'Waiting for #recaptcha-anchor in anchor frame...' });
      const box = await anchorFrame.waitForSelector('#recaptcha-anchor', { timeout: 5000 });
      if (!box) {
        this.emitLog('system', { message: '#recaptcha-anchor element not found.' });
        return false;
      }
      await box.click({ delay: 50 });
      await this.page.waitForTimeout(800);
      // Stream an immediate screenshot so Live View reflects the click
      await this.streamScreenshot('recaptcha-anchor-click');
      return true;
    } catch (_) {
      return false;
    }
  }

  async isRecaptchaSolved(): Promise<boolean> {
    if (!this.page) return false;
    const { anchorFrame } = this.getRecaptchaFrames();
    if (!anchorFrame) return false;
    try {
      const solved = await anchorFrame.evaluate(() => {
        const a = document.querySelector('#recaptcha-anchor') as HTMLElement | null;
        if (!a) return false;
        const aria = a.getAttribute('aria-checked');
        const cls = a.className || '';
        return aria === 'true' || /recaptcha-checkbox-checked/.test(cls);
      });
      return !!solved;
    } catch (_) {
      return false;
    }
  }

  async getRecaptchaChallenge(): Promise<{ instruction: string; gridImageBase64: string; gridSize?: number } | null> {
    if (!this.page) return null;
    try {
      // Wait for challenge frame to appear briefly
      let challengeFrame = this.getRecaptchaFrames().challengeFrame;
      const start = Date.now();
      while (!challengeFrame && Date.now() - start < 8000) {
        await this.page.waitForTimeout(300);
        challengeFrame = this.getRecaptchaFrames().challengeFrame;
      }
      if (!challengeFrame) return null;

      const instruction = await challengeFrame.evaluate(() => {
        const sel = document.querySelector('.rc-imageselect-desc-no-canonical, .rc-imageselect-desc, .rc-imageselect-desc-wrapper');
        const text = sel ? (sel as HTMLElement).innerText : '';
        return text || '';
      });

      // Capture the entire grid as a single image for better context
      const gridContainer = await challengeFrame.$('.rc-imageselect-table-33, .rc-imageselect-table-44, table.rc-imageselect-table-33, table.rc-imageselect-table-44, .rc-imageselect-challenge');
      if (!gridContainer) return { instruction, gridImageBase64: '' };

      // Ensure tiles are mostly loaded before capture to avoid blank/white tiles being analyzed
      await this.waitForRecaptchaTilesLoaded(0.85, 4000).catch(() => {});

      const buf = await gridContainer.screenshot();
      const gridImageBase64 = Buffer.from(buf).toString('base64');
      // Also stream a full-page screenshot so Live View shows the challenge immediately
      await this.streamScreenshot('recaptcha-challenge-detected');

      // Try to infer grid size (3x3 or 4x4) for better indexing guidance
      let gridSize: number | undefined = undefined;
      try {
        const tileCount = await challengeFrame.evaluate(() => {
          const nodes = document.querySelectorAll('.rc-image-tile-wrapper, .rc-imageselect-tile, table tr td div.rc-image-tile-wrapper');
          return nodes ? nodes.length : 0;
        });
        if (typeof tileCount === 'number' && tileCount > 0) {
          gridSize = tileCount >= 16 ? 4 : 3;
        }
      } catch (_) {}

      return { instruction, gridImageBase64, gridSize };
    } catch (e) {
      return null;
    }
  }

  // Capture lightweight signatures of current tiles to detect refresh/replacement
  async getRecaptchaTileSignatures(): Promise<string[] | null> {
    if (!this.page) return null;
    const { challengeFrame } = this.getRecaptchaFrames();
    if (!challengeFrame) return null;
    try {
      const sigs = await challengeFrame.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('.rc-image-tile-wrapper, .rc-imageselect-tile, table tr td div.rc-image-tile-wrapper')) as HTMLElement[];
        return nodes.map((el) => {
          const img = el.querySelector('img') as HTMLImageElement | null;
          const bg = (img && img.src) ? img.src : (getComputedStyle(el).backgroundImage || '');
          // Normalize url("...") strings
          return bg.replace(/^url\(["']?/, '').replace(/["']?\)$/,'');
        });
      });
      if (!Array.isArray(sigs)) return null;
      return sigs as string[];
    } catch (_) {
      return null;
    }
  }

  // Wait for any tile to refresh/replace (used for 3x3 progressive challenges)
  async waitForRecaptchaTilesRefresh(prev: string[] | null, timeout: number = 5000): Promise<string[] | null> {
    if (!this.page) return null;
    const start = Date.now();
    let last: string[] | null = null;
    while (Date.now() - start < timeout) {
      const sigs = await this.getRecaptchaTileSignatures();
      if (sigs && prev && sigs.length === prev.length) {
        let changed = false;
        for (let i = 0; i < sigs.length; i++) {
          if (sigs[i] !== prev[i]) { changed = true; break; }
        }
        if (changed) {
          await this.streamScreenshot('recaptcha-tiles-refreshed');
          return sigs;
        }
      }
      last = sigs;
      await this.page.waitForTimeout(250);
    }
    return last;
  }

  // Wait until a minimum fraction of tiles report a loaded image (img naturalWidth>0 or background-image present)
  async waitForRecaptchaTilesLoaded(minLoadedFraction: number = 0.9, timeout: number = 4000): Promise<boolean> {
    if (!this.page) return false;
    const { challengeFrame } = this.getRecaptchaFrames();
    if (!challengeFrame) return false;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const ratio = await challengeFrame.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('.rc-image-tile-wrapper, .rc-imageselect-tile, table tr td div.rc-image-tile-wrapper')) as HTMLElement[];
        if (nodes.length === 0) return 0;
        const loaded = nodes.filter((el) => {
          const img = el.querySelector('img') as HTMLImageElement | null;
          const bg = getComputedStyle(el).backgroundImage;
          const hasImg = !!(img && img.complete && img.naturalWidth > 0);
          const hasBg = bg && bg !== 'none' && /url\(/.test(bg);
          return hasImg || hasBg;
        }).length;
        return loaded / nodes.length;
      }).catch(() => 0);
      if (ratio >= minLoadedFraction) return true;
      await this.page.waitForTimeout(200);
    }
    return false;
  }

  async selectRecaptchaTiles(indices: number[]): Promise<boolean> {
    if (!this.page) return false;
    const { challengeFrame } = this.getRecaptchaFrames();
    if (!challengeFrame) return false;
    try {
      // Collect unique clickable tiles (avoid duplicates from multiple matching selectors)
      const tileHandles = await challengeFrame.$$('.rc-imageselect-table-33 td, .rc-imageselect-table-44 td, .rc-image-tile-wrapper, .rc-imageselect-tile');
      const boxes = await Promise.all(tileHandles.map((h: any) => h.boundingBox()));
      type Box = { x: number; y: number; width?: number; height?: number };
      // Build unique list by center point to dedupe wrappers/overlays referring to same cell
      const byCenterKey = new Map<string, any>();
      for (let i = 0; i < tileHandles.length; i++) {
        const box = boxes[i] as Box | null;
        if (!box) continue;
        const cx = Math.round((box.x + (box.width || 0) / 2));
        const cy = Math.round((box.y + (box.height || 0) / 2));
        const key = `${cx}:${cy}`;
        if (!byCenterKey.has(key)) byCenterKey.set(key, tileHandles[i]);
      }
      const uniqueTiles: any[] = Array.from(byCenterKey.values());

      // Sort by row-major order (top->bottom, left->right)
      const uniqueBoxes = await Promise.all(uniqueTiles.map((h: any) => h.boundingBox()));
      const orderedPairs = uniqueTiles
        .map((el: any, idx: number) => ({ el, box: uniqueBoxes[idx] as Box }))
        .filter((p) => !!p.box)
        .sort((a, b) => {
          const ay = Math.round((a.box!.y) / 10);
          const by = Math.round((b.box!.y) / 10);
          if (ay !== by) return ay - by;
          return (a.box!.x) - (b.box!.x);
        });
      const ordered = orderedPairs.map(p => p.el);

      let clicked = 0;
      for (const i of indices) {
        const el = ordered[i];
        if (!el) continue;
        try {
          await el.click({ delay: 50 });
          await this.page!.waitForTimeout(250);
          clicked++;
          // Stream after each tile click for more frequent Live View updates
          await this.streamScreenshot('recaptcha-tile-click');
        } catch (_) {}
      }
      // One more screenshot after finishing all clicks in this round
      if (clicked > 0) {
        await this.streamScreenshot('recaptcha-tiles-clicked');
      }
      return clicked > 0;
    } catch (_) {
      return false;
    }
  }

  async submitRecaptchaChallenge(): Promise<boolean> {
    if (!this.page) return false;
    const { challengeFrame } = this.getRecaptchaFrames();
    if (!challengeFrame) return false;
    try {
      const btn = await challengeFrame.$('#recaptcha-verify-button');
      if (btn) {
        await btn.click({ delay: 50 });
        await this.page.waitForTimeout(800);
        // Stream verify click immediately
        await this.streamScreenshot('recaptcha-verify-click');
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  async submitSorryPageIfPresent(): Promise<boolean> {
    if (!this.page) return false;
    // Try common submit/continue buttons on Google Sorry pages
    return await this.tryClickSelectors([
      'form[action*="sorry"] button[type="submit"]',
      'form[action*="sorry"] input[type="submit"]',
      'button:has-text("확인")',
      'button:has-text("계속")',
      'button:has-text("Continue")',
      'input[name="submit"]',
      'button[type="submit"]',
      'input[type="submit"]'
    ]);
  }

  async getPageContent(): Promise<string> {
    if (!this.page) throw new Error('Page is not initialized.');

    try {
      // Wait a bit for page to stabilize
      await this.page.waitForTimeout(500);

      // Get visible text content instead of full HTML for better LLM understanding
      const visibleText = await this.page.evaluate(() => {
        // Remove script, style, and hidden elements
        const clonedBody = document.body.cloneNode(true) as HTMLElement;
        clonedBody.querySelectorAll('script, style, noscript').forEach(el => el.remove());
        return clonedBody.innerText || clonedBody.textContent || '';
      }).catch(() => '');

      // Also get input field info with more details
      const inputInfo = await this.page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input, textarea, button, a[role="button"]'));
        return inputs.slice(0, 30).map((el, idx) => {
          const tag = el.tagName.toLowerCase();
          const type = el.getAttribute('type') || '';
          const name = el.getAttribute('name') || '';
          const id = el.getAttribute('id') || '';
          const ariaLabel = el.getAttribute('aria-label') || '';
          const placeholder = el.getAttribute('placeholder') || '';
          const className = el.getAttribute('class') || '';
          const role = el.getAttribute('role') || '';
          const title = el.getAttribute('title') || '';
          const text = (el as HTMLElement).innerText?.substring(0, 50) || '';

          // Check if visible
          const rect = el.getBoundingClientRect();
          const isVisible = rect.width > 0 && rect.height > 0;

          return `[${idx}] <${tag} ${type ? `type="${type}"` : ''} ${name ? `name="${name}"` : ''} ${id ? `id="${id}"` : ''} ${ariaLabel ? `aria-label="${ariaLabel}"` : ''} ${placeholder ? `placeholder="${placeholder}"` : ''} ${role ? `role="${role}"` : ''} ${title ? `title="${title}"` : ''} ${className ? `class="${className.substring(0, 30)}"` : ''} visible="${isVisible}">${text}</${tag}>`;
        }).filter(s => s.includes('visible="true"')).join('\n');
      }).catch(() => 'Could not extract interactive elements');

      // Lightweight CAPTCHA status
      let captchaStatus = 'google_sorry=false, recaptcha_v2=false';
      try {
        const sorry = await this.detectGoogleSorryCaptcha({ includeImage: false });
        const rec = await this.detectRecaptchaV2();
        captchaStatus = `google_sorry=${sorry.detected}, recaptcha_v2=${rec.detected}`;
      } catch (_) {}

      const combined = `=== Visible Text (first 800 chars) ===\n${visibleText.substring(0, 800)}\n\n=== Interactive Elements (visible only) ===\n${inputInfo}\n\n=== Captcha Status ===\n${captchaStatus}`;
      this.emitLog('system', { message: 'Fetched page content (first 800 chars): ' + combined.substring(0, 800) });
      return combined;
    } catch (error) {
      console.error('[BrowserController] Error getting page content:', error);
      return 'Error: Could not fetch page content';
    }
  }

  getCurrentUrl(): string {
    if (!this.page) return 'Page not initialized';
    return this.page.url();
  }

  async waitForPageLoad(timeout: number = 10000): Promise<void> {
    if (!this.page) throw new Error('Page is not initialized.');
    try {
      await this.page.waitForLoadState('networkidle', { timeout });
      this.emitLog('system', { message: `Page load 'networkidle' state reached.`});
    } catch (e) {
      this.emitLog('system', { message: `Page load 'networkidle' timed out after ${timeout}ms, continuing...`});
      // Timeout은 일반적이므로 에러로 처리하지 않고 로그만 남김
    }
  }

  async getText(selector: string): Promise<string | null> {
    if (!this.page) {
      throw new Error('Page is not initialized. Call launch() first.');
    }

    try {
      this.emitLog('system', { message: `Getting text from selector: ${selector}` });
      const element = await this.findElement([selector]);
      if (!element) {
        return null;
      }

      const text = await element.textContent();
      this.emitLog('system', { message: `Text from selector "${selector}": ${text}` });
      return text;
    } catch (error) {
      console.error(`Error getting text: ${error}`);
      this.emitLog('error', { message: `Error getting text: ${(error as Error).message}` });
      return null;
    }
  }

  async takeDebugScreenshot(name: string): Promise<string | null> {
    if (!this.debugMode || !this.page) {
      return null;
    }

    try {
      const timestamp = Date.now();
      const filePath = path.join(this.debugDir, `${name}-${timestamp}.png`);
      await this.page.screenshot({ path: filePath, fullPage: true });
      console.log(`[BrowserController] Debug screenshot saved: ${filePath}`);
      return filePath;
    } catch (error) {
      console.error(`[BrowserController] Failed to take debug screenshot: ${error}`);
      return null;
    }
  }

  async streamScreenshot(action: string): Promise<void> {
    if (!this.page) {
      return;
    }

    try {
      // Wait longer for iframe-based content (like reCAPTCHA) to render
      const isCaptchaRelated = action.includes('captcha') || action.includes('recaptcha');
      const waitTime = isCaptchaRelated ? 1500 : 500;
      await this.page.waitForTimeout(waitTime);

      // Force a couple of RAF cycles and a resize event to flush paints (helps avoid black frames)
      try {
        await this.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await this.page.evaluate(() => window.dispatchEvent(new Event('resize'))).catch(() => {});
      } catch (_) {}

      // Take a screenshot and get it as buffer
      // For Google Sorry/CAPTCHA pages, use fullPage to capture the entire rendered page
      // For other pages, use viewport screenshot for better performance
      const currentUrl = this.page.url();
      const isGoogleSorry = currentUrl.includes('google.com') && currentUrl.includes('/sorry/');
      const useFullPage = isCaptchaRelated || isGoogleSorry;

      const screenshotBuffer = await this.page.screenshot({
        fullPage: useFullPage,
        omitBackground: false,
        type: 'png'
      });

      // Convert buffer to base64 for sending over WebSocket
      const base64Image = screenshotBuffer.toString('base64');

      // Emit an event with the screenshot data and action info
      this.emit('screenshot', {
        image: base64Image,
        action: action,
        url: currentUrl,
        timestamp: new Date().toISOString()
      });

      console.log(`Streaming screenshot for action: ${action}`);
    } catch (error) {
      console.error(`[BrowserController] Failed to stream screenshot for action ${action}:`, error);
      this.emitLog('error', { message: `Failed to stream screenshot: ${(error as Error).message}` });
    }
  }

  async close(): Promise<void> {
    try {
      if (this.context) {
        const storageStatePath = path.join(this.debugDir, 'storageState.json');
        try { await this.context.storageState({ path: storageStatePath }); } catch (_) {}
      }
    } catch (_) {}
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      this.context = null;
      this.emitLog('system', { message: 'Browser closed.'});
      console.log('[BrowserController] Browser closed.');
    }
  }

  async findElement(selectors: string[]): Promise<ElementHandle | null> {
    if (!this.page) {
      throw new Error('Page is not initialized. Call launch() first.');
    }
    for (const selector of selectors) {
      try {
        const element = await this.page.waitForSelector(selector, { timeout: 5000, state: 'visible' });
        if (element) return element;
      } catch (error) {
        // console.log(`Could not find element with selector: ${selector}`);
      }
    }
    if (this.debugMode) {
      await this.takeDebugScreenshot('selector-not-found-' + selectors.join('-').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50));
      // const html = await this.page.content();
      // fs.writeFileSync(path.join(this.debugDir, `page-html-${Date.now()}.html`), html);
    }
    return null;
  }
}