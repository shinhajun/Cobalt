import { chromium, Browser, Page, ElementHandle, BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';

export class BrowserController extends EventEmitter {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private debugMode: boolean = false; // 기본값 false로 변경
  private debugDir: string = './debug';
  private context: BrowserContext | null = null;
  private pageContentCache: { content: string; timestamp: number; url: string } | null = null;

  // 타임아웃 상수 정의 (빠른 응답을 위해 단축)
  private readonly TIMEOUTS = {
    NAVIGATION_DOMCONTENTLOADED: 20000,
    NAVIGATION_LOAD: 25000,
    NAVIGATION_COMMIT: 15000,
    CLOUDFLARE_INITIAL_WAIT: 15000,
    CLOUDFLARE_RELOAD_CHECK: 8000,
    CLOUDFLARE_SCREENSHOT_INTERVAL: 4,
    PAGE_LOAD_DEFAULT: 8000,
    RECAPTCHA_CHALLENGE_WAIT: 3000,
    RECAPTCHA_TILE_REFRESH: 6000,
    SELECTOR_WAIT: 5000,
    STABILIZATION: 500,
  };

  // 페이지 콘텐츠 캐시 유효 시간 (ms)
  private readonly PAGE_CONTENT_CACHE_TTL = 2000;

  constructor(debugMode: boolean = false) {
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
    // Chromium 채널 우선 시도 - Cloudflare 우회를 위한 최적화된 설정
    const launchArgs = [
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1920,1080',
      '--start-maximized',
      '--disable-infobars',
      '--disable-notifications',
      '--disable-popup-blocking',
    ];

    try {
      this.browser = await chromium.launch({
        channel: 'chrome',
        headless: false, // headless 모드는 Cloudflare가 쉽게 감지 - false로 변경
        args: launchArgs,
        timeout: 60000,
      });
    } catch (_) {
      this.browser = await chromium.launch({
        headless: false,
        args: launchArgs,
        timeout: 60000,
      });
    }

    const storageStatePath = path.join(this.debugDir, 'storageState.json');
    const context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'ko-KR',
      acceptDownloads: true,
      extraHTTPHeaders: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
      },
      storageState: fs.existsSync(storageStatePath) ? storageStatePath : undefined,
      // 추가 컨텍스트 옵션
      bypassCSP: true,
      ignoreHTTPSErrors: true,
      javaScriptEnabled: true,
    });
    this.context = context;

    // 강화된 스텔스 스크립트 (Cloudflare 우회)
    await context.addInitScript(() => {
      try {
        // webdriver 속성 제거
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        delete (navigator as any).__proto__.webdriver;

        // Chrome 객체 추가
        (window as any).chrome = {
          runtime: {},
          loadTimes: function() {},
          csi: function() {},
          app: {}
        };

        // 언어 설정
        Object.defineProperty(navigator, 'languages', {
          get: () => ['ko-KR', 'ko', 'en-US', 'en']
        });

        // 플러그인 설정
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5]
        });

        // Permission API 우회
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters: any) => (
          parameters.name === 'notifications' ?
            Promise.resolve({ state: 'denied' } as PermissionStatus) :
            originalQuery(parameters)
        );

        // 자동화 감지 우회
        Object.defineProperty(navigator, 'platform', {
          get: () => 'Win32'
        });

        Object.defineProperty(navigator, 'vendor', {
          get: () => 'Google Inc.'
        });
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
    this.pageContentCache = null; // 캐시 무효화
    let navigated = false;

    // 1차: domcontentloaded로 바로 시작 (networkidle은 너무 느림)
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      navigated = true;
      this.emitLog('system', { message: `Successfully navigated to ${url}.` });
    } catch (e: any) {
      this.emitLog('system', { message: `Navigation domcontentloaded failed: ${e.message}. Trying load...` });

      // 2차: load 시도
      try {
        await this.page.goto(url, { waitUntil: 'load', timeout: 25000 });
        navigated = true;
        this.emitLog('system', { message: `Successfully navigated to ${url} (load).` });
      } catch (e2: any) {
        this.emitLog('system', { message: `Navigation load failed: ${e2.message}. Trying commit...` });

        // 3차: commit (가장 빠름, 최소한의 로딩)
        try {
          await this.page.goto(url, { waitUntil: 'commit', timeout: 15000 });
          navigated = true;
          this.emitLog('system', { message: `Successfully navigated to ${url} (commit).` });
          // commit은 매우 빠르므로 추가 대기
          await this.page.waitForTimeout(2000);
        } catch (e3: any) {
          this.emitLog('error', { message: `Navigation failed (all strategies): ${e3.message}` });
          try { await this.streamScreenshot('navigation-failed'); } catch (_) {}
          throw e3;
        }
      }
    }

    // 짧은 안정화 대기
    await this.page.waitForTimeout(500);

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

    // Cloudflare 인터스티셜 처리 - handleCloudflareGate가 이미 모든 재시도 포함
    try {
      const hadCloudflare = await this.handleCloudflareGate();
      // Cloudflare 통과 후 스크린샷 업데이트
      if (hadCloudflare) {
        await this.streamScreenshot('cloudflare-passed');
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

    // 재시도 로직 추가 (최대 2회)
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        this.emitLog('system', { message: `Attempting to click: ${selector}${attempt > 1 ? ` (retry ${attempt-1})` : ''}` });
        const element = await this.findElement(this.getSelectorCandidates(selector));
        if (element) {
          this.pageContentCache = null; // 캐시 무효화
          await element.hover();
          await this.page.waitForTimeout(120 + Math.random() * 180);
          // Pre-capture href and tag for anchor fallback
          let href: string | null = null;
          let tagName: string | null = null;
          try {
            href = await element.getAttribute('href');
            tagName = (await element.evaluate((el: any) => el.tagName)).toString().toLowerCase();
          } catch (_) {}
          const preUrl = this.page.url();
          await element.click({ delay: 50 + Math.floor(Math.random() * 120) });
          await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
          await this.page.waitForTimeout(500);
          this.emitLog('system', { message: `Clicked on ${selector}.` });

          // Take screenshot after click
          await this.streamScreenshot('click');
          if (this.debugMode) await this.takeDebugScreenshot('after-click');
          // If it was an anchor and domain didn't change, navigate directly to href to bypass blockers
          try {
            const afterUrl = this.page.url();
            if (tagName === 'a' && href && /^https?:\/\//i.test(href)) {
              const preHost = new URL(preUrl).host;
              const afterHost = new URL(afterUrl).host;
              const destHost = new URL(href).host;
              if (preHost === afterHost && destHost !== afterHost) {
                this.emitLog('system', { message: `Anchor navigation fallback to ${href}` });
                await this.page.goto(href, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
                await this.streamScreenshot('anchor-fallback-goto');
              }
            }
          } catch (_) {}
          try { await this.handleCloudflareGate(); } catch (_) {}
          return true;
        }

        // 요소를 찾지 못한 경우 재시도 전 대기
        if (attempt < 2) {
          this.emitLog('system', { message: `Element not found, waiting before retry...` });
          await this.page.waitForTimeout(1000);
        }
      } catch (error) {
        if (attempt === 2) {
          console.error(`Error clicking element after retries: ${error}`);
          throw error;
        }
        this.emitLog('system', { message: `Click attempt ${attempt} failed: ${(error as Error).message}` });
        await this.page.waitForTimeout(1000);
      }
    }

    this.emitLog('error', { message: `Element not found for click after retries: ${selector}` });
    if (this.debugMode) await this.takeDebugScreenshot('click-error');
    return false;
  }

  async type(selector: string, text: string): Promise<boolean> {
    if (!this.page) {
      throw new Error('Page is not initialized. Call launch() first.');
    }

    // 재시도 로직 추가 (최대 2회)
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        this.emitLog('system', { message: `Attempting to type '${text}' into: ${selector}${attempt > 1 ? ` (retry ${attempt-1})` : ''}` });
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

        // 요소를 찾지 못한 경우 재시도 전 대기
        if (attempt < 2) {
          this.emitLog('system', { message: `Element not found, waiting before retry...` });
          await this.page.waitForTimeout(1000);
        }
      } catch (error) {
        if (attempt === 2) {
          console.error(`Error typing text after retries: ${error}`);
          throw error;
        }
        this.emitLog('system', { message: `Type attempt ${attempt} failed: ${(error as Error).message}` });
        await this.page.waitForTimeout(1000);
      }
    }

    this.emitLog('error', { message: `Element not found for type after retries: ${selector}` });
    if (this.debugMode) await this.takeDebugScreenshot('type-error');
    return false;
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
        try { await this.handleCloudflareGate(); } catch (_) {}
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
  // Removed URL-based and special-case detectors; vision/DOM flows handle challenges now.

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
      try { await this.streamScreenshot('recaptcha-token-injected'); } catch (_) {}
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
      try { await this.streamScreenshot('captcha-text-submitted'); } catch (_) {}
      return true;
    } catch (e) {
      this.emitLog('error', { message: 'Failed to type captcha text: ' + (e as Error).message });
      return false;
    }
  }

  // --- reCAPTCHA (vision-based interaction) helpers ---
  private async getRecaptchaFramesDOM(): Promise<{ anchorFrame: any, challengeFrame: any }> {
    if (!this.page) return { anchorFrame: null as any, challengeFrame: null as any };
    const frames = this.page.frames();
    let anchorFrame: any = null;
    let challengeFrame: any = null;
    for (const f of frames) {
      try {
        const hasAnchor = await f.evaluate(() => !!document.querySelector('#recaptcha-anchor'));
        if (hasAnchor) anchorFrame = anchorFrame || f;
      } catch (_) {}
      try {
        const hasChallenge = await f.evaluate(() => !!(document.querySelector('#recaptcha-verify-button') || document.querySelector('.rc-imageselect-challenge')));
        if (hasChallenge) challengeFrame = challengeFrame || f;
      } catch (_) {}
      if (anchorFrame && challengeFrame) break;
    }
    return { anchorFrame, challengeFrame };
  }

  async clickRecaptchaAnchor(): Promise<boolean> {
    if (!this.page) return false;
    const { anchorFrame } = await this.getRecaptchaFramesDOM();
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
    const { anchorFrame } = await this.getRecaptchaFramesDOM();
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
      // Wait for challenge frame to appear briefly (DOM-based)
      let challengeFrame = (await this.getRecaptchaFramesDOM()).challengeFrame;
      const start = Date.now();
      while (!challengeFrame && Date.now() - start < 8000) {
        await this.page.waitForTimeout(300);
        challengeFrame = (await this.getRecaptchaFramesDOM()).challengeFrame;
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
      await this.waitForRecaptchaTilesLoaded(0.92, 6000).catch(() => {});

      // Use JPEG with moderate quality to reduce payload size for vision models
      const buf = await gridContainer.screenshot({ type: 'jpeg', quality: 70 });
      const gridImageBase64 = Buffer.from(buf).toString('base64');
      // Also stream a full-page screenshot so Live View shows the challenge immediately
      await this.streamScreenshot('recaptcha-challenge-detected');

      // Try to infer grid size (3x3 or 4x4) using unique cell centers to avoid duplicate wrappers/overlays
      let gridSize: number | undefined = undefined;
      try {
        const tileHandles = await challengeFrame.$$('.rc-imageselect-table-33 td, .rc-imageselect-table-44 td, .rc-image-tile-wrapper, .rc-imageselect-tile');
        const boxes = await Promise.all(tileHandles.map((h: any) => h.boundingBox()));
        type Box = { x: number; y: number; width?: number; height?: number };
        const byCenterKey = new Map<string, any>();
        for (let i = 0; i < tileHandles.length; i++) {
          const box = boxes[i] as Box | null;
          if (!box) continue;
          const cx = Math.round((box.x + (box.width || 0) / 2));
          const cy = Math.round((box.y + (box.height || 0) / 2));
          const key = `${cx}:${cy}`;
          if (!byCenterKey.has(key)) byCenterKey.set(key, tileHandles[i]);
        }
        const uniqueCount = byCenterKey.size;
        if (uniqueCount > 0) {
          gridSize = uniqueCount >= 15 ? 4 : 3;
          this.emitLog('system', { message: `reCAPTCHA grid unique tiles=${uniqueCount} => gridSize=${gridSize}` });
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
    const { challengeFrame } = await this.getRecaptchaFramesDOM();
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
    const { challengeFrame } = await this.getRecaptchaFramesDOM();
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
    const { challengeFrame } = await this.getRecaptchaFramesDOM();
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

      // Detect already-selected states to avoid toggling off
      const selectedStates: boolean[] = await Promise.all(
        ordered.map((el: any) => el.evaluate((node: HTMLElement) => {
          const pressed = (node.getAttribute('aria-pressed') || '').toString() === 'true';
          const cls = (node.className || '').toString();
          const hasSel = /rc-imageselect-tileselected/.test(cls);
          return pressed || hasSel;
        }))
      );

      let clicked = 0;
      for (const i of indices) {
        const el = ordered[i];
        if (!el) continue;
        // Skip if already selected to avoid toggling off
        if (selectedStates[i]) continue;
        try {
          const target = (await el.$('.rc-image-tile-wrapper')) || (await el.$('.rc-imageselect-tile')) || el;
          await (target as any).click({ delay: 50 });
          await this.page!.waitForTimeout(250);
          clicked++;
        } catch (_) {}
      }
      // 라운드당 한 번만 스크린샷 (개별 타일마다 제거)
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
    const { challengeFrame } = await this.getRecaptchaFramesDOM();
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
      const currentUrl = this.page.url();
      const now = Date.now();

      // 캐시 유효성 검사
      if (this.pageContentCache &&
          this.pageContentCache.url === currentUrl &&
          now - this.pageContentCache.timestamp < this.PAGE_CONTENT_CACHE_TTL) {
        return this.pageContentCache.content;
      }

      // Wait a bit for page to stabilize
      await this.page.waitForTimeout(300);

      // Get visible text content instead of full HTML for better LLM understanding
      const visibleText = await this.page.evaluate(() => {
        // Remove script, style, and hidden elements
        const clonedBody = document.body.cloneNode(true) as HTMLElement;
        clonedBody.querySelectorAll('script, style, noscript').forEach(el => el.remove());
        return clonedBody.innerText || clonedBody.textContent || '';
      }).catch(() => '');

      // Also get input field info with more details (제한 30 → 15)
      const inputInfo = await this.page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input, textarea, button, a[role="button"]'));
        return inputs.slice(0, 15).map((el, idx) => {
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
      let captchaStatus = 'captcha_status=none';
      try {
        const cfWaiting = (/확인\s*성공/i.test(visibleText) && /응답을\s*기다리는\s*중/i.test(visibleText))
          || (/verification\s*success/i.test(visibleText) && /(waiting|hold)\s*for\s*response/i.test(visibleText));
        const cfGate = /아래 작업을 완료하여 사람인지 확인/i.test(visibleText)
          || /보안을\s*검토/i.test(visibleText)
          || /Checking your browser/i.test(visibleText)
          || /성능\s*&\s*보안/.test(visibleText)
          || /확인\s*성공/.test(visibleText);
        if (cfWaiting) captchaStatus = 'captcha_status=cloudflare_waiting';
        else if (cfGate) captchaStatus = 'captcha_status=cloudflare_gate';
      } catch (_) {}

      const combined = `=== Visible Text (first 800 chars) ===\n${visibleText.substring(0, 800)}\n\n=== Interactive Elements (visible only) ===\n${inputInfo}\n\n=== Captcha Status ===\n${captchaStatus}`;

      // 캐시 저장
      this.pageContentCache = {
        content: combined,
        timestamp: now,
        url: currentUrl
      };

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
      // Avoid URL-based detection; use action hint or text hints for full-page capture
      let isTextCaptcha = false;
      try {
        isTextCaptcha = await this.page.evaluate(() => {
          const t = document.body?.innerText || '';
          return /unusual\s+traffic/i.test(t) || /비정상적인\s*트래픽/.test(t) || /captcha|reCAPTCHA/i.test(t);
        });
      } catch (_) {}
      const useFullPage = isCaptchaRelated || isTextCaptcha;

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
        url: this.page.url(),
        timestamp: new Date().toISOString()
      });

      console.log(`Streaming screenshot for action: ${action}`);
    } catch (error) {
      console.error(`[BrowserController] Failed to stream screenshot for action ${action}:`, error);
      this.emitLog('error', { message: `Failed to stream screenshot: ${(error as Error).message}` });
    }
  }

  private async isCloudflareGate(): Promise<boolean> {
    if (!this.page) return false;
    try {
      const text = await this.page.evaluate(() => document.body?.innerText || '');
      return /cloudflare/i.test(text)
        || /Ray ID:/i.test(text)
        || /Checking your browser/i.test(text)
        || /성능\s*&\s*보안/.test(text)
        || /확인\s*성공/.test(text)
        || /보안을\s*검토/.test(text);
    } catch (_) {
      return false;
    }
  }

  // Cloudflare 대기 상태 감지 (중복 로직 통합)
  async isCloudflareWaiting(): Promise<boolean> {
    if (!this.page) return false;
    try {
      const text = await this.page.evaluate(() => document.body?.innerText || '');
      // 더 유연한 패턴 매칭
      const hasSuccess = /확인\s*성공/i.test(text) || /verification\s*success/i.test(text);
      const hasWaiting = /기다리는\s*중/i.test(text) || /waiting/i.test(text);
      const hasRayId = /Ray ID:/i.test(text);

      // 디버깅 로그
      if (hasRayId) {
        console.log(`[Cloudflare Waiting Check] success=${hasSuccess}, waiting=${hasWaiting}, rayId=${hasRayId}`);
        console.log(`[Cloudflare Waiting Check] Text sample: ${text.substring(0, 200)}`);
      }

      return hasSuccess && hasWaiting && hasRayId;
    } catch (_) {
      return false;
    }
  }

  // Cloudflare 대기 상태 처리 (공통 메서드)
  async waitForCloudflarePassthrough(maxWaitMs: number = 15000): Promise<boolean> {
    if (!this.page) return false;
    const start = Date.now();
    let count = 0;
    while (Date.now() - start < maxWaitMs) {
      await new Promise(r => setTimeout(r, 1500));
      count++;
      if (count % 3 === 0) {
        await this.streamScreenshot(`cloudflare-passthrough-wait-${count}`);
      }
      const still = await this.isCloudflareWaiting();
      if (!still) {
        this.emitLog('system', { message: 'Cloudflare waiting state cleared.' });
        return true;
      }
    }
    this.emitLog('system', { message: 'Cloudflare waiting state persists after timeout.' });
    return false;
  }

  async handleCloudflareGate(): Promise<boolean> {
    if (!this.page) return false;
    try {
      const detected = await this.isCloudflareGate();
      if (!detected) return false;

      this.emitLog('system', { message: 'Cloudflare gate detected. Using aggressive bypass strategy...' });
      await this.streamScreenshot('cloudflare-detected');

      // 즉시 버튼 클릭 시도
      await this.tryClickSelectors([
        'button:has-text("Verify")',
        'button:has-text("Continue")',
        'button:has-text("확인")',
        'input[type="button"]',
        'input[type="submit"]'
      ]);

      // 1단계: 초기 대기 (25초로 증가, 2.5초 간격)
      this.emitLog('system', { message: 'Waiting for Cloudflare to process (up to 25 seconds)...' });
      const start = Date.now();
      let checkCount = 0;
      while (Date.now() - start < 25000) {
        await this.page.waitForTimeout(2500);
        checkCount++;

        const ok = !(await this.isCloudflareGate());
        if (ok) {
          this.emitLog('system', { message: `Cloudflare gate cleared after ${Math.round((Date.now() - start) / 1000)}s!` });
          await this.streamScreenshot('cloudflare-cleared');
          return true;
        }

        if (checkCount % 2 === 0) {
          this.emitLog('system', { message: `Still waiting... (${Math.round((Date.now() - start) / 1000)}s elapsed)` });
        }
      }

      // 2단계: Reload 시도 (15초 대기로 증가)
      this.emitLog('system', { message: 'Cloudflare persists after 25s. Forcing reload...' });
      try {
        await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});

        // Reload 후 충분한 시간 대기 (15초, 3초 간격 체크)
        const reloadStart = Date.now();
        while (Date.now() - reloadStart < 15000) {
          await this.page.waitForTimeout(3000);
          const ok = !(await this.isCloudflareGate());
          if (ok) {
            this.emitLog('system', { message: `Cloudflare cleared after reload (${Math.round((Date.now() - reloadStart) / 1000)}s)!` });
            await this.streamScreenshot('cloudflare-cleared-reload');
            return true;
          }
        }
        this.emitLog('system', { message: 'Reload did not clear Cloudflare after 15s.' });
      } catch (_) {}

      // 3단계: Cache-bust 시도 (15초 대기로 증가)
      this.emitLog('system', { message: 'Trying cache-bust navigation...' });
      try {
        const url = this.page.url();
        const bustUrl = url + (url.includes('?') ? '&' : '?') + '_=' + Date.now();
        await this.page.goto(bustUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});

        // Cache-bust 후 충분한 시간 대기 (15초, 3초 간격 체크)
        const bustStart = Date.now();
        while (Date.now() - bustStart < 15000) {
          await this.page.waitForTimeout(3000);
          const ok = !(await this.isCloudflareGate());
          if (ok) {
            this.emitLog('system', { message: `Cloudflare cleared after cache-bust (${Math.round((Date.now() - bustStart) / 1000)}s)!` });
            await this.streamScreenshot('cloudflare-cleared-bust');
            return true;
          }
        }
        this.emitLog('system', { message: 'Cache-bust did not clear Cloudflare after 15s.' });
      } catch (_) {}

      // 4단계: Fresh navigation 시도 (20초 대기로 증가)
      this.emitLog('system', { message: 'Trying fresh navigation (last attempt before extended wait)...' });
      try {
        const url = this.page.url().split('?')[0]; // 쿼리 제거
        await this.page.goto(url, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
        
        // Fresh navigation 후 충분한 시간 대기 (20초, 4초 간격 체크)
        const freshStart = Date.now();
        while (Date.now() - freshStart < 20000) {
          await this.page.waitForTimeout(4000);
          
          const stillGate = await this.isCloudflareGate();
          const isWaitingNow = await this.isCloudflareWaiting();
          
          this.emitLog('system', { message: `Fresh nav check (${Math.round((Date.now() - freshStart) / 1000)}s): gate=${stillGate}, waiting=${isWaitingNow}` });
          
          if (!stillGate && !isWaitingNow) {
            this.emitLog('system', { message: `Cloudflare cleared after fresh navigation (${Math.round((Date.now() - freshStart) / 1000)}s)!` });
            await this.streamScreenshot('cloudflare-cleared-fresh');
            return true;
          }
          
          // waiting 상태면 루프 탈출하고 아래 extended wait로 진행
          if (isWaitingNow) {
            this.emitLog('system', { message: 'Detected waiting state, will proceed to extended wait...' });
            break;
          }
        }
      } catch (_) {}

      // 마지막으로 대기 상태인지 확인
      const isWaiting = await this.isCloudflareWaiting();
      this.emitLog('system', { message: `Checking Cloudflare waiting state: ${isWaiting}` });

      if (isWaiting) {
        this.emitLog('system', { message: 'Cloudflare is in waiting state. This may require manual intervention or more time.' });
        // 추가로 30초 더 대기
        this.emitLog('system', { message: 'Waiting additional 30 seconds for Cloudflare to clear...' });
        const extraStart = Date.now();
        while (Date.now() - extraStart < 30000) {
          await this.page.waitForTimeout(3000);
          const stillGate = await this.isCloudflareGate();
          const stillWaiting = await this.isCloudflareWaiting();
          this.emitLog('system', { message: `Extended wait check: gate=${stillGate}, waiting=${stillWaiting}` });

          if (!stillGate) {
            this.emitLog('system', { message: 'Cloudflare cleared during extended wait!' });
            await this.streamScreenshot('cloudflare-finally-cleared');
            return true;
          }
        }
      } else {
        // 대기 상태가 아니지만 여전히 Cloudflare gate가 있다면, 추가 대기 시도
        this.emitLog('system', { message: 'Not in waiting state but gate persists. Trying one more extended wait...' });
        const extraStart = Date.now();
        while (Date.now() - extraStart < 20000) {
          await this.page.waitForTimeout(3000);
          if (!(await this.isCloudflareGate())) {
            this.emitLog('system', { message: 'Cloudflare cleared during final wait!' });
            await this.streamScreenshot('cloudflare-finally-cleared');
            return true;
          }
        }
      }

      this.emitLog('error', { message: 'Cloudflare bypass failed after all attempts. Manual intervention may be required.' });
      return false;
    } catch (e) {
      this.emitLog('error', { message: `Cloudflare handler error: ${(e as Error).message}` });
      return false;
    }
  }

  // --- Generic vision-interaction helpers ---
  async getViewportSize(): Promise<{ width: number; height: number }> {
    if (!this.page) return { width: 0, height: 0 };
    const size = this.page.viewportSize();
    return { width: size?.width || 0, height: size?.height || 0 };
  }

  async captureViewportScreenshotBase64(): Promise<{ imageBase64: string; width: number; height: number }> {
    if (!this.page) return { imageBase64: '', width: 0, height: 0 };
    const size = this.page.viewportSize();
    // Use JPEG to reduce payload for vision models
    const buf = await this.page.screenshot({ fullPage: false, type: 'jpeg', quality: 70 });
    return { imageBase64: buf.toString('base64'), width: size?.width || 0, height: size?.height || 0 };
  }

  async clickViewport(x: number, y: number): Promise<boolean> {
    if (!this.page) return false;
    try {
      await this.page.mouse.move(x, y);
      await this.page.waitForTimeout(80);
      await this.page.mouse.click(x, y, { delay: 50 });
      await this.streamScreenshot('viewport-click');
      if (this.debugMode) await this.takeDebugScreenshot('after-viewport-click');
      await this.page.waitForTimeout(200);
      return true;
    } catch (_) {
      return false;
    }
  }

  async clickRectGrid(rect: { x: number; y: number; width: number; height: number }, gridSize: number, indices: number[]): Promise<boolean> {
    if (!this.page) return false;
    try {
      const rows = gridSize;
      const cols = gridSize;
      const cellW = rect.width / cols;
      const cellH = rect.height / rows;
      let clicked = 0;
      for (const idx of indices) {
        const r = Math.floor(idx / cols);
        const c = idx % cols;
        const cx = Math.round(rect.x + c * cellW + cellW / 2);
        const cy = Math.round(rect.y + r * cellH + cellH / 2);
        const ok = await this.clickViewport(cx, cy);
        if (ok) clicked++;
        await this.page!.waitForTimeout(200);
      }
      if (clicked > 0) {
        await this.streamScreenshot('grid-tiles-clicked');
        if (this.debugMode) await this.takeDebugScreenshot('after-grid-tiles-clicked');
      }
      return clicked > 0;
    } catch (_) {
      return false;
    }
  }

  async clickFirstVisibleContainingText(patterns: string[]): Promise<boolean> {
    if (!this.page) return false;
    try {
      const match = await this.page.evaluate((pats: string[]) => {
        const toLower = (s: any) => (s || '').toString().toLowerCase();
        const patterns = pats.map(toLower);
        const isVisible = (el: Element) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          const style = window.getComputedStyle(el as HTMLElement);
          return r.width > 1 && r.height > 1 && style.visibility !== 'hidden' && style.display !== 'none';
        };
        const all = Array.from(document.querySelectorAll('*')) as HTMLElement[];
        for (const el of all) {
          try {
            if (!isVisible(el)) continue;
            const text = toLower(el.innerText || el.textContent || '');
            if (!text) continue;
            for (const pat of patterns) {
              if (text.includes(pat)) {
                const rect = el.getBoundingClientRect();
                return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
              }
            }
          } catch (_e) {}
        }
        return null;
      }, patterns);
      if (match && typeof match.x === 'number' && typeof match.y === 'number') {
        const { x, y } = match;
        await this.page.mouse.move(x, y);
        await this.page.waitForTimeout(80);
        await this.page.mouse.click(x, y, { delay: 50 });
        await this.streamScreenshot('text-click');
        if (this.debugMode) await this.takeDebugScreenshot('after-text-click');
        await this.page.waitForTimeout(200);
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  async clickCheckboxLeftOfText(patterns: string[]): Promise<boolean> {
    if (!this.page) return false;
    try {
      const rect = await this.page.evaluate((pats: string[]) => {
        const toLower = (s: any) => (s || '').toString().toLowerCase();
        const patterns = pats.map(toLower);
        const isVisible = (el: Element) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          const style = window.getComputedStyle(el as HTMLElement);
          return r.width > 1 && r.height > 1 && style.visibility !== 'hidden' && style.display !== 'none';
        };
        const all = Array.from(document.querySelectorAll('*')) as HTMLElement[];
        for (const el of all) {
          try {
            if (!isVisible(el)) continue;
            const text = toLower(el.innerText || el.textContent || '');
            if (!text) continue;
            for (const pat of patterns) {
              if (text.includes(pat)) {
                const r = el.getBoundingClientRect();
                return { left: r.left, top: r.top, width: r.width, height: r.height };
              }
            }
          } catch (_e) {}
        }
        return null;
      }, patterns);

      if (!rect) return false;
      const h = Math.max(12, Math.min(40, Math.round(rect.height)));
      const cx = (dx: number) => Math.max(1, Math.round(rect.left + dx));
      const cy = Math.max(1, Math.round(rect.top + rect.height / 2));
      const dxCandidates = [-Math.round(h * 0.7), -Math.round(h * 0.55), -32, -24, -16];
      let clicked = 0;
      for (const dx of dxCandidates) {
        const x = cx(dx);
        const y = cy;
        const ok = await this.clickViewport(x, y);
        if (ok) clicked++;
        await this.page!.waitForTimeout(180);
      }
      if (clicked > 0) {
        await this.streamScreenshot('checkbox-left-of-text-clicked');
        if (this.debugMode) await this.takeDebugScreenshot('after-checkbox-left-of-text');
      }
      return clicked > 0;
    } catch (_) {
      return false;
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