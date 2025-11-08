import { chromium, Browser, Page, ElementHandle, BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import { DOMExtractor, InteractiveElementMap, InteractiveElement } from './domExtractor';

// Control mode for hybrid browser support
enum ControlMode {
  PLAYWRIGHT = 'playwright',    // AI task execution (existing logic)
  BROWSERVIEW = 'browserview'    // User manual browsing (integrated view)
}

export class BrowserController extends EventEmitter {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private debugMode: boolean = false; // 기본값 false로 변경
  private headless: boolean = true; // 기본값 headless
  private debugDir: string = './debug';
  private context: BrowserContext | null = null;
  private pageContentCache: { content: string; timestamp: number; url: string } | null = null;

  // Multi-tab support
  private tabs: Map<string, Page> = new Map();
  private activeTabId: string = 'main';

  // Hybrid mode support
  private controlMode: ControlMode = ControlMode.PLAYWRIGHT;
  private browserViewWebContents: any = null; // Electron webContents when in BrowserView mode

  // DOM extraction support (browser-use style)
  private domExtractor: DOMExtractor = new DOMExtractor();
  private interactiveElementsCache: InteractiveElementMap | null = null;

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

  constructor(debugMode: boolean = false, headless: boolean = true) {
    super();
    this.debugMode = debugMode;
    this.headless = headless;
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
        headless: this.headless,
        args: launchArgs,
        timeout: 60000,
      });
    } catch (_) {
      this.browser = await chromium.launch({
        headless: this.headless,
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

    // Register main page as a tab
    this.tabs.set('main', this.page);
    this.activeTabId = 'main';

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
    this.clearInteractiveElementsCache(); // DOM 캐시도 무효화

    // 최적화된 네비게이션: domcontentloaded (DOM만 기다림, 훨씬 빠름!)
    try {
      await this.page.goto(url, {
        waitUntil: 'domcontentloaded',  // 'load'에서 변경 (이미지 안 기다림)
        timeout: 30000
      });
      this.emitLog('system', { message: `Successfully navigated to ${url}` });
    } catch (error: any) {
      this.emitLog('error', { message: `Navigation failed: ${error.message}` });
      try { await this.streamScreenshot('navigation-failed'); } catch (_) {}
      throw error;
    }

    // 주요 컨텐츠 로드 확인 (조건 기반, 즉시 리턴 가능)
    await this.page.waitForFunction(() => {
      return document.body && document.body.childElementCount > 0;
    }, { timeout: 2000, polling: 100 }).catch(() => {});

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

    // Cloudflare 인터스티셜 처리
    try {
      const hadCloudflare = await this.handleCloudflareGate();
      if (hadCloudflare) {
        await this.streamScreenshot('cloudflare-passed');
      }
    } catch (_) {}
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
          await el.click();

          // 조건 기반 대기: 버튼이 사라지면 즉시 진행!
          await this.page.waitForSelector(sel, {
            state: 'hidden',
            timeout: 2000
          }).catch(() => {});

          await this.streamScreenshot('consent-dismissed');
          break;
        }
      }
    } catch (e) {
      // 무시하고 진행
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

      // 조건 기반 대기: Challenge frame이 나타나는지 polling 체크
      const startTime = Date.now();
      while (Date.now() - startTime < 2000) {
        const frames = this.page.frames();
        const challengeFrame = frames.find(f => f.url().includes('recaptcha/api2/bframe'));
        if (challengeFrame) break;
        await this.page.waitForTimeout(100);
      }

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

        // 조건 기반 대기: Verify 버튼이 사라지거나 페이지가 변하면 즉시
        await Promise.race([
          challengeFrame.waitForSelector('#recaptcha-verify-button', { state: 'hidden', timeout: 2000 }),
          this.page.waitForLoadState('domcontentloaded', { timeout: 2000 })
        ]).catch(() => {});

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

      // Also get input field info with more details (제한 30 → 25, 더 많은 셀렉터, onclick도 포함)
      const inputInfo = await this.page.evaluate(() => {
        // 더 광범위한 셀렉터: 클릭 가능한 모든 요소
        const selectors = [
          'input', 'textarea', 'button',
          'a[role="button"]', 'div[role="button"]', 'span[role="button"]',
          '[onclick]', '[role="checkbox"]',
          'div[class*="checkbox"]', 'div[class*="button"]', 'span[class*="checkbox"]',
          'div[class*="clickable"]', '[tabindex]', 'a[href]',
          // Shadow DOM 내부 요소도 시도
          'div[class*="check"]', 'svg', 'canvas'
        ];

        const allElements = new Set<Element>();
        selectors.forEach(sel => {
          try {
            document.querySelectorAll(sel).forEach(el => allElements.add(el));
          } catch (_) {}
        });

        const inputs = Array.from(allElements);
        return inputs.slice(0, 25).map((el, idx) => {
          const tag = el.tagName.toLowerCase();
          const type = el.getAttribute('type') || '';
          const name = el.getAttribute('name') || '';
          const id = el.getAttribute('id') || '';
          const ariaLabel = el.getAttribute('aria-label') || '';
          const placeholder = el.getAttribute('placeholder') || '';
          const className = el.getAttribute('class') || '';
          const role = el.getAttribute('role') || '';
          const title = el.getAttribute('title') || '';
          const onclick = el.getAttribute('onclick') ? 'has-onclick' : '';
          const text = (el as HTMLElement).innerText?.substring(0, 50) || '';

          // Check if visible
          const rect = el.getBoundingClientRect();
          const isVisible = rect.width > 0 && rect.height > 0;

          // Build attribute string more carefully
          const attrs = [];
          if (type) attrs.push(`type="${type}"`);
          if (name) attrs.push(`name="${name}"`);
          if (id) attrs.push(`id="${id}"`);
          if (ariaLabel) attrs.push(`aria-label="${ariaLabel}"`);
          if (placeholder) attrs.push(`placeholder="${placeholder}"`);
          if (role) attrs.push(`role="${role}"`);
          if (title) attrs.push(`title="${title}"`);
          if (onclick) attrs.push('onclick');
          if (className) attrs.push(`class="${className.substring(0, 40)}"`);

          // Get position for fallback coordinate-based clicks
          const posInfo = `x=${Math.round(rect.left + rect.width/2)} y=${Math.round(rect.top + rect.height/2)} w=${Math.round(rect.width)} h=${Math.round(rect.height)}`;

          return `[${idx}] <${tag} ${attrs.join(' ')} visible="${isVisible}" ${posInfo}>${text}</${tag}>`;
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

  async waitForPageLoad(timeout: number = 3000): Promise<void> {
    if (!this.page) throw new Error('Page is not initialized.');

    // Smart Wait: 조건 충족 시 즉시 진행 (고정 대기 없음)
    try {
      // Step 1: DOM 준비되면 즉시 (가장 빠름)
      await this.page.waitForLoadState('domcontentloaded', { timeout: 1000 }).catch(() => {});

      // Step 2: Body 존재 체크 (조건 기반)
      await this.page.waitForSelector('body', {
        state: 'attached',
        timeout: 500
      }).catch(() => {});

      // Step 3: 기본 컨텐츠 로드 확인 (body에 자식 요소 있으면 즉시)
      await this.page.waitForFunction(() => {
        return document.body && document.body.childElementCount > 0;
      }, { timeout: 1000, polling: 100 }).catch(() => {});

      // Step 4: networkidle은 짧게만 (최대 2초, 조건 충족 시 즉시)
      await this.page.waitForLoadState('networkidle', {
        timeout: Math.min(timeout, 2000)
      }).catch(() => {});

      this.emitLog('system', { message: `Page ready (smart wait completed)`});
    } catch (e) {
      // 모든 조건 실패해도 계속 진행
      this.emitLog('system', { message: `Page load checks completed (some may have timed out)`});
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

  /**
   * Capture screenshot and return as base64 (for auto-streaming)
   */
  async captureScreenshot(): Promise<string | null> {
    if (!this.page) {
      return null;
    }

    try {
      const screenshotBuffer = await this.page.screenshot({
        fullPage: false,
        omitBackground: false,
        type: 'png'
      });

      return screenshotBuffer.toString('base64');
    } catch (error) {
      return null;
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

  // Internal helper for coordinate-based clicking (used by CAPTCHA solver and vision tools)
  async clickViewport(x: number, y: number): Promise<boolean> {
    if (!this.page) return false;
    try {
      await this.page.mouse.move(x, y);
      await this.page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      await this.page.mouse.click(x, y, { delay: 50 });
      await this.page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Click grid tiles using DOM element selection (preferred method)
   * Searches for actual grid DOM elements and clicks them directly
   */
  async clickGridByElements(rect: { x: number; y: number; width: number; height: number }, gridSize: number, indices: number[]): Promise<boolean> {
    if (!this.page) return false;
    try {
      this.emitLog('system', `[ClickGridByElements] Searching for ${gridSize}x${gridSize} grid tiles in DOM...`);

      // Discover what selectors are available
      const availableSelectors = await this.page.evaluate(() => {
        const testSelectors = [
          '.captcha-box-grid > div',
          '.captcha-box-grid div',
          '.captcha-box div',
          '[class*="captcha"] div',
          '[class*="grid"] > div',
          '[class*="grid"] div',
          '.grid-tile', '.tile', '.square', '.cell',
          'img[src*="captcha"]', 'canvas',
          'div[onclick]', 'div[style*="cursor"]'
        ];

        const results: { selector: string; count: number }[] = [];
        for (const sel of testSelectors) {
          try {
            const elements = document.querySelectorAll(sel);
            if (elements.length > 0) {
              results.push({ selector: sel, count: elements.length });
            }
          } catch (_) {}
        }
        return results;
      });

      this.emitLog('system', `[ClickGridByElements] Available selectors: ${JSON.stringify(availableSelectors)}`);

      const selectors = [
        '.captcha-box-grid > div > div',  // neal.fun: nested divs
        '.captcha-box-grid > div',
        '.captcha-box-grid-tile',
        '.captcha-tile',
        '[class*="captcha-box-grid"] > div > div',
        '[class*="captcha-box-grid"] > div',
        '[class*="grid"] > div > div',
        '[class*="grid"] > div',
        '.grid-tile', '.tile', '.square', '.cell',
        '[class*="tile"]',
        'img[src*="captcha"]', 'canvas', 'div[onclick]'
      ];

      let clicked = 0;
      const expectedTiles = gridSize * gridSize;

      for (const selector of selectors) {
        try {
          const tiles = await this.page.$$(selector);
          if (tiles.length !== expectedTiles) continue;

          // Found matching grid!
          this.emitLog('system', `[ClickGridByElements] ✓ Found ${tiles.length} tiles using selector: ${selector}`);

          // Click the specified indices directly
          for (const idx of indices) {
            if (idx < 0 || idx >= tiles.length) continue;

            const tile = tiles[idx];
            this.emitLog('system', `[ClickGridByElements] Clicking tile ${idx} (DOM element)`);

            try {
              await tile.click({ delay: 50 });
              clicked++;
              await this.page.waitForTimeout(200);
            } catch (clickErr: any) {
              this.emitLog('error', `[ClickGridByElements] Failed to click tile ${idx}: ${clickErr.message}`);
            }
          }

          if (clicked > 0) {
            this.emitLog('system', `[ClickGridByElements] ✓ Successfully clicked ${clicked}/${indices.length} tiles via DOM elements`);
            await this.streamScreenshot('grid-tiles-clicked-elements');
            if (this.debugMode) await this.takeDebugScreenshot('after-grid-tiles-clicked-elements');
          }

          return clicked > 0;
        } catch (_) {
          continue;  // Try next selector
        }
      }

      this.emitLog('error', `[ClickGridByElements] ✗ No matching grid found with ${expectedTiles} tiles`);
      return false;
    } catch (e: any) {
      this.emitLog('error', `[ClickGridByElements] Error: ${e.message}`);
      return false;
    }
  }

  /**
   * Click grid tiles using coordinate calculation (fallback method)
   * Divides the grid rect into cells and clicks calculated coordinates
   */
  async clickGridByCoordinates(rect: { x: number; y: number; width: number; height: number }, gridSize: number, indices: number[]): Promise<boolean> {
    if (!this.page) return false;
    try {
      this.emitLog('system', `[ClickGridByCoordinates] Using rect-based calculation for ${gridSize}x${gridSize} grid`);
      this.emitLog('system', `[ClickGridByCoordinates] Grid rect: x=${rect.x}, y=${rect.y}, w=${rect.width}, h=${rect.height}`);

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

        this.emitLog('system', `[ClickGridByCoordinates] Clicking tile ${idx} (row=${r}, col=${c}) at (${cx}, ${cy})`);

        const ok = await this.clickViewport(cx, cy);
        if (ok) clicked++;
      }

      this.emitLog('system', `[ClickGridByCoordinates] ✓ Successfully clicked ${clicked}/${indices.length} tiles via coordinates`);

      if (clicked > 0) {
        await this.streamScreenshot('grid-tiles-clicked-coordinates');
        if (this.debugMode) await this.takeDebugScreenshot('after-grid-tiles-clicked-coordinates');
      }

      return clicked > 0;
    } catch (e: any) {
      this.emitLog('error', `[ClickGridByCoordinates] Error: ${e.message}`);
      return false;
    }
  }

  /**
   * @deprecated Use clickGridByElements or clickGridByCoordinates instead
   * Old method kept for compatibility
   */
  async clickRectGrid(rect: { x: number; y: number; width: number; height: number }, gridSize: number, indices: number[]): Promise<boolean> {
    // Try elements first, fall back to coordinates
    const success = await this.clickGridByElements(rect, gridSize, indices);
    if (success) return true;
    return await this.clickGridByCoordinates(rect, gridSize, indices);
  }

  /**
   * Handle dynamic grid challenge (reCAPTCHA-style)
   * Click tiles one by one, wait for new images, continue until no more matches
   * Uses vision model to identify which tiles contain the target object after each click
   */
  async clickGridDynamic(
    rect: { x: number; y: number; width: number; height: number },
    gridSize: number,
    initialIndexes: number[],
    _instruction: string,
    clickMethod: 'elements' | 'coordinates',
    maxIterations: number = 20
  ): Promise<{ success: boolean; clickCount: number }> {
    if (!this.page) return { success: false, clickCount: 0 };

    this.emitLog('system', `[DynamicGrid] Starting dynamic grid challenge: ${gridSize}x${gridSize}, method=${clickMethod}`);
    this.emitLog('system', `[DynamicGrid] Initial tiles to click: ${JSON.stringify(initialIndexes)}`);

    let totalClicked = 0;
    let iteration = 0;
    let currentIndexes = [...initialIndexes];

    try {
      while (iteration < maxIterations && currentIndexes.length > 0) {
        iteration++;
        this.emitLog('system', `[DynamicGrid] Iteration ${iteration}: clicking ${currentIndexes.length} tiles`);

        // Click all current tiles
        for (const idx of currentIndexes) {
          let success = false;

          if (clickMethod === 'elements') {
            success = await this.clickGridByElements(rect, gridSize, [idx]);
          } else {
            success = await this.clickGridByCoordinates(rect, gridSize, [idx]);
          }

          if (success) {
            totalClicked++;
            // Wait for new image to load
            await this.page.waitForTimeout(800);
          }
        }

        this.emitLog('system', `[DynamicGrid] Iteration ${iteration} complete. Total clicked: ${totalClicked}`);

        // Take screenshot and check if there are more tiles to click
        await this.streamScreenshot(`dynamic-grid-iteration-${iteration}`);

        // Small delay before checking again
        await this.page.waitForTimeout(500);

        // Note: Vision loop for dynamic grids is handled by LLMService
        // The agent will call visionInteract again if needed
        // This method handles one round of clicking, then returns control to agent
        this.emitLog('system', `[DynamicGrid] Round complete. Agent will re-evaluate if more tiles remain.`);
        break;
      }

      this.emitLog('system', `[DynamicGrid] Completed. Total iterations: ${iteration}, total tiles clicked: ${totalClicked}`);
      return { success: totalClicked > 0, clickCount: totalClicked };

    } catch (e: any) {
      this.emitLog('error', `[DynamicGrid] Error: ${e.message}`);
      return { success: false, clickCount: totalClicked };
    }
  }

  /**
   * Handle static grid challenge (neal.fun-style)
   * Select all matching tiles at once, then the agent will click verify
   */
  async clickGridStatic(
    rect: { x: number; y: number; width: number; height: number },
    gridSize: number,
    indexes: number[],
    clickMethod: 'elements' | 'coordinates'
  ): Promise<boolean> {
    this.emitLog('system', `[StaticGrid] Clicking all ${indexes.length} tiles at once (method=${clickMethod})`);

    if (clickMethod === 'elements') {
      return await this.clickGridByElements(rect, gridSize, indexes);
    } else {
      return await this.clickGridByCoordinates(rect, gridSize, indexes);
    }
  }

  /**
   * Check if captcha failed (shows error or wrong selection)
   * Returns true if failure detected
   */
  async isCaptchaFailed(): Promise<boolean> {
    if (!this.page) return false;
    try {
      const text = await this.page.evaluate(() => document.body?.innerText || '');
      // Look for common failure indicators
      const failurePatterns = /incorrect|wrong|try again|failed|error|다시|틀렸|오류/i;
      return failurePatterns.test(text);
    } catch (_) {
      return false;
    }
  }

  /**
   * Retry action with automatic failure detection and reset
   */
  async retryWithReset<T>(
    action: () => Promise<T>,
    maxRetries: number = 3,
    actionName: string = 'action'
  ): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.emitLog('system', `[Retry] Attempt ${attempt}/${maxRetries} for ${actionName}`);

        const result = await action();

        // Check if failed
        await this.page?.waitForTimeout(1000);
        const failed = await this.isCaptchaFailed();

        if (!failed) {
          this.emitLog('system', `[Retry] ✓ Success on attempt ${attempt}`);
          return result;
        }

        this.emitLog('system', `[Retry] ✗ Failed on attempt ${attempt}, trying reset...`);

        // Try to reset
        const resetSuccess = await this.clickResetButton();
        if (resetSuccess) {
          await this.page?.waitForTimeout(1500);
        }

        if (attempt === maxRetries) {
          this.emitLog('error', `[Retry] ✗ Failed after ${maxRetries} attempts`);
          return result;
        }
      } catch (error) {
        this.emitLog('error', `[Retry] Error on attempt ${attempt}: ${(error as Error).message}`);
        if (attempt === maxRetries) {
          throw error;
        }
      }
    }

    throw new Error(`Failed after ${maxRetries} retries`);
  }

  /**
   * Click Reset button if visible
   */
  async clickResetButton(): Promise<boolean> {
    this.emitLog('system', '[Reset] Looking for Reset button...');
    const resetClicked = await this.clickFirstVisibleContainingText(['reset', '재설정', '다시']);
    if (resetClicked) {
      this.emitLog('system', '[Reset] ✓ Reset button clicked');
      await this.page?.waitForTimeout(1000);
      await this.streamScreenshot('after-reset');
      return true;
    }
    this.emitLog('system', '[Reset] ✗ No Reset button found');
    return false;
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

    // Close all tabs
    this.tabs.clear();

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      this.context = null;
      this.emitLog('system', { message: 'Browser closed.'});
      console.log('[BrowserController] Browser closed.');
    }
  }

  /**
   * Fill form with data
   */
  async fillForm(formData: Record<string, string>): Promise<boolean> {
    if (!this.page) return false;

    try {
      for (const [selector, value] of Object.entries(formData)) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            await element.fill(value);
            this.emitLog('system', `[FillForm] Filled ${selector} with value`);
            await this.page.waitForTimeout(100);
          }
        } catch (err) {
          this.emitLog('error', `[FillForm] Failed to fill ${selector}: ${(err as Error).message}`);
        }
      }

      return true;
    } catch (error) {
      this.emitLog('error', `[FillForm] Error: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Detect form fields on page
   */
  async detectFormFields(): Promise<Array<{selector: string; type: string; name: string; label: string}>> {
    if (!this.page) return [];

    try {
      const fields = await this.page.$$eval('input, textarea, select', (elements: Element[]) => {
        return elements.map(el => {
          const input = el as HTMLInputElement;
          const label = document.querySelector(`label[for="${input.id}"]`);

          return {
            selector: input.id ? `#${input.id}` : `[name="${input.name}"]`,
            type: input.type || input.tagName.toLowerCase(),
            name: input.name || input.id || '',
            label: label?.textContent?.trim() || input.placeholder || ''
          };
        }).filter(f => f.selector);
      });

      this.emitLog('system', `[DetectForm] Found ${fields.length} form fields`);
      return fields;
    } catch (error) {
      this.emitLog('error', `[DetectForm] Error: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Extract table data from page
   */
  async extractTableData(selector: string): Promise<any[][]> {
    if (!this.page) throw new Error('Page not initialized');

    try {
      const data = await this.page.$$eval(selector, (tables: Element[]) => {
        const results: any[][] = [];

        tables.forEach(table => {
          const rows = Array.from(table.querySelectorAll('tr'));
          rows.forEach(row => {
            const cells = Array.from(row.querySelectorAll('td, th'));
            const rowData = cells.map(cell => (cell as HTMLElement).innerText?.trim() || '');
            if (rowData.length > 0) {
              results.push(rowData);
            }
          });
        });

        return results;
      });

      this.emitLog('system', `[ExtractTable] Extracted ${data.length} rows from ${selector}`);
      return data;
    } catch (error) {
      this.emitLog('error', `[ExtractTable] Error: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Extract list data from page
   */
  async extractListData(selector: string): Promise<string[]> {
    if (!this.page) throw new Error('Page not initialized');

    try {
      const data = await this.page.$$eval(selector, (lists: Element[]) => {
        const results: string[] = [];

        lists.forEach(list => {
          const items = Array.from(list.querySelectorAll('li'));
          items.forEach(item => {
            const text = (item as HTMLElement).innerText?.trim();
            if (text) results.push(text);
          });
        });

        return results;
      });

      this.emitLog('system', `[ExtractList] Extracted ${data.length} items from ${selector}`);
      return data;
    } catch (error) {
      this.emitLog('error', `[ExtractList] Error: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Extract structured data based on selectors
   */
  async extractStructuredData(schema: Record<string, string>): Promise<Record<string, string>> {
    if (!this.page) throw new Error('Page not initialized');

    try {
      const result: Record<string, string> = {};

      for (const [key, selector] of Object.entries(schema)) {
        try {
          const value = await this.page.$eval(selector, (el: Element) =>
            (el as HTMLElement).innerText?.trim() || ''
          );
          result[key] = value;
        } catch {
          result[key] = '';
        }
      }

      this.emitLog('system', `[ExtractStructured] Extracted ${Object.keys(result).length} fields`);
      return result;
    } catch (error) {
      this.emitLog('error', `[ExtractStructured] Error: ${(error as Error).message}`);
      return {};
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

  /**
   * Multi-Tab Management Methods
   */

  /**
   * Create a new tab and return its ID
   */
  async createNewTab(url?: string): Promise<string> {
    if (!this.context) {
      throw new Error('Browser context is not initialized. Call launch() first.');
    }

    const newPage = await this.context.newPage();
    const tabId = `tab-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    this.tabs.set(tabId, newPage);
    this.emitLog('system', `[MultiTab] Created new tab: ${tabId}`);

    if (url) {
      await newPage.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.TIMEOUTS.NAVIGATION_DOMCONTENTLOADED
      });
      this.emitLog('system', `[MultiTab] Navigated tab ${tabId} to: ${url}`);
    }

    return tabId;
  }

  /**
   * Switch to a specific tab by ID
   */
  async switchTab(tabId: string): Promise<boolean> {
    const targetPage = this.tabs.get(tabId);

    if (!targetPage) {
      this.emitLog('error', `[MultiTab] Tab not found: ${tabId}`);
      return false;
    }

    // Switch active tab
    this.activeTabId = tabId;
    this.page = targetPage;

    // Bring tab to front
    await targetPage.bringToFront();

    this.emitLog('system', `[MultiTab] Switched to tab: ${tabId}`);
    await this.streamScreenshot(`switched-to-${tabId}`);

    return true;
  }

  /**
   * Close a specific tab by ID
   */
  async closeTab(tabId: string): Promise<boolean> {
    const targetPage = this.tabs.get(tabId);

    if (!targetPage) {
      this.emitLog('error', `[MultiTab] Tab not found: ${tabId}`);
      return false;
    }

    // Don't allow closing the main tab if it's the only one
    if (tabId === 'main' && this.tabs.size === 1) {
      this.emitLog('error', `[MultiTab] Cannot close the main tab when it's the only tab`);
      return false;
    }

    await targetPage.close();
    this.tabs.delete(tabId);

    this.emitLog('system', `[MultiTab] Closed tab: ${tabId}`);

    // If we closed the active tab, switch to another one
    if (this.activeTabId === tabId) {
      const remainingTabs = Array.from(this.tabs.keys());
      if (remainingTabs.length > 0) {
        await this.switchTab(remainingTabs[0]);
      } else {
        this.page = null;
        this.activeTabId = 'main';
      }
    }

    return true;
  }

  /**
   * List all open tabs
   */
  async listTabs(): Promise<Array<{ id: string; url: string; title: string; active: boolean }>> {
    const tabList = [];

    for (const [tabId, page] of this.tabs.entries()) {
      try {
        const url = page.url();
        const title = await page.title();

        tabList.push({
          id: tabId,
          url,
          title,
          active: tabId === this.activeTabId
        });
      } catch (error) {
        // Tab might be closed or in invalid state
        this.emitLog('warning', `[MultiTab] Could not get info for tab ${tabId}: ${(error as Error).message}`);
      }
    }

    return tabList;
  }

  /**
   * Get the currently active tab ID
   */
  getActiveTabId(): string {
    return this.activeTabId;
  }

  /**
   * Switch to tab by index (0-based)
   */
  async switchTabByIndex(index: number): Promise<boolean> {
    const tabIds = Array.from(this.tabs.keys());

    if (index < 0 || index >= tabIds.length) {
      this.emitLog('error', `[MultiTab] Invalid tab index: ${index} (total tabs: ${tabIds.length})`);
      return false;
    }

    return await this.switchTab(tabIds[index]);
  }

  /**
   * Close all tabs except the main one
   */
  async closeAllTabsExceptMain(): Promise<void> {
    const tabIds = Array.from(this.tabs.keys());

    for (const tabId of tabIds) {
      if (tabId !== 'main') {
        await this.closeTab(tabId);
      }
    }

    this.emitLog('system', `[MultiTab] Closed all tabs except main`);
  }

  /**
   * Hybrid Mode: Attach BrowserView webContents (Electron)
   * This allows BrowserController to read state from BrowserView
   */
  attachBrowserView(webContents: any): void {
    this.browserViewWebContents = webContents;
    this.controlMode = ControlMode.BROWSERVIEW;
    this.emitLog('system', '[Hybrid] Attached to BrowserView mode');
  }

  /**
   * Hybrid Mode: Detach BrowserView and switch back to Playwright mode
   */
  detachBrowserView(): void {
    this.browserViewWebContents = null;
    this.controlMode = ControlMode.PLAYWRIGHT;
    this.emitLog('system', '[Hybrid] Switched to Playwright mode');
  }

  /**
   * Get current control mode
   */
  getControlMode(): string {
    return this.controlMode;
  }

  /**
   * Get cookies from Playwright context (for syncing to BrowserView)
   */
  async getCookies(): Promise<any[]> {
    if (!this.context) {
      return [];
    }

    try {
      const cookies = await this.context.cookies();
      this.emitLog('system', `[Hybrid] Retrieved ${cookies.length} cookies from Playwright`);
      return cookies;
    } catch (error) {
      this.emitLog('error', `[Hybrid] Failed to get cookies: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Set cookies to Playwright context (for syncing from BrowserView)
   */
  async setCookies(cookies: any[]): Promise<void> {
    if (!this.context) {
      this.emitLog('error', '[Hybrid] Cannot set cookies: context not initialized');
      return;
    }

    try {
      await this.context.addCookies(cookies);
      this.emitLog('system', `[Hybrid] Set ${cookies.length} cookies to Playwright`);
    } catch (error) {
      this.emitLog('error', `[Hybrid] Failed to set cookies: ${(error as Error).message}`);
    }
  }

  // ============================================================================
  // DOM-BASED INTERACTION (Browser-Use Style)
  // ============================================================================

  /**
   * Get interactive elements from the page with browser-use style indexing
   * This provides a structured map of all clickable/interactive elements
   * that can be referenced by index number for more reliable interaction
   */
  async getInteractiveElements(): Promise<InteractiveElementMap> {
    if (!this.page) {
      throw new Error('Page is not initialized.');
    }

    try {
      const currentUrl = this.page.url();

      // Check cache validity
      if (
        this.interactiveElementsCache &&
        this.interactiveElementsCache.url === currentUrl &&
        Date.now() - this.interactiveElementsCache.timestamp < this.PAGE_CONTENT_CACHE_TTL
      ) {
        this.emitLog('system', { message: '[DOM] Using cached interactive elements' });
        return this.interactiveElementsCache;
      }

      this.emitLog('system', { message: '[DOM] Extracting interactive elements from page' });

      // Extract elements using DOMExtractor
      const elementMap = await this.domExtractor.extractInteractiveElements(this.page);

      // Cache the result
      this.interactiveElementsCache = elementMap;

      this.emitLog('system', {
        message: `[DOM] Extracted ${elementMap.elements.length} interactive elements`,
      });

      return elementMap;
    } catch (error) {
      console.error('[BrowserController] Error getting interactive elements:', error);
      this.emitLog('error', { message: `[DOM] Error extracting elements: ${(error as Error).message}` });

      // Return empty map on error
      return {
        elements: [],
        timestamp: Date.now(),
        url: this.page?.url() || '',
        summary: 'Error: Could not extract interactive elements',
      };
    }
  }

  /**
   * Click an element by its index number (browser-use style)
   * More reliable than CSS selectors as it uses the exact element reference
   */
  async clickElementByIndex(index: number): Promise<boolean> {
    if (!this.page) {
      throw new Error('Page is not initialized.');
    }

    try {
      this.emitLog('system', { message: `[DOM] Clicking element by index: ${index}` });

      // Get fresh element map
      const elementMap = await this.getInteractiveElements();

      // Find element by index
      const element = this.domExtractor.findElementByIndex(elementMap, index);

      if (!element) {
        this.emitLog('error', { message: `[DOM] Element with index ${index} not found` });
        return false;
      }

      this.emitLog('system', {
        message: `[DOM] Found element ${index}: <${element.tag}> "${element.text}" at (${element.coordinates.x}, ${element.coordinates.y})`,
      });

      // Click directly using coordinates from DOM (fastest and most reliable)
      await this.page.mouse.click(element.coordinates.x, element.coordinates.y);
      await this.streamScreenshot(`clicked-element-${index}`);
      this.emitLog('system', {
        message: `[DOM] Successfully clicked element ${index} at (${element.coordinates.x}, ${element.coordinates.y})`,
      });
      return true;
    } catch (error) {
      console.error(`[BrowserController] Error clicking element by index ${index}:`, error);
      this.emitLog('error', {
        message: `[DOM] Error clicking element ${index}: ${(error as Error).message}`,
      });
      return false;
    }
  }

  // ============================================================================
  // BROWSER-USE STYLE TYPING UTILITIES
  // ============================================================================

  /**
   * Get CDP key code for a character (browser-use style)
   */
  private getKeyCodeForChar(char: string): string {
    // Letters
    if (char >= 'a' && char <= 'z') return `Key${char.toUpperCase()}`;
    if (char >= 'A' && char <= 'Z') return `Key${char}`;

    // Digits
    if (char >= '0' && char <= '9') return `Digit${char}`;

    // Special characters mapping
    const specialKeys: { [key: string]: string } = {
      ' ': 'Space',
      '\n': 'Enter',
      '\r': 'Enter',
      '\t': 'Tab',
      '!': 'Digit1',
      '@': 'Digit2',
      '#': 'Digit3',
      '$': 'Digit4',
      '%': 'Digit5',
      '^': 'Digit6',
      '&': 'Digit7',
      '*': 'Digit8',
      '(': 'Digit9',
      ')': 'Digit0',
      '-': 'Minus',
      '_': 'Minus',
      '=': 'Equal',
      '+': 'Equal',
      '[': 'BracketLeft',
      '{': 'BracketLeft',
      ']': 'BracketRight',
      '}': 'BracketRight',
      '\\': 'Backslash',
      '|': 'Backslash',
      ';': 'Semicolon',
      ':': 'Semicolon',
      "'": 'Quote',
      '"': 'Quote',
      ',': 'Comma',
      '<': 'Comma',
      '.': 'Period',
      '>': 'Period',
      '/': 'Slash',
      '?': 'Slash',
      '`': 'Backquote',
      '~': 'Backquote',
    };

    return specialKeys[char] || 'KeyA'; // Fallback
  }

  /**
   * Get modifier and virtual key for a character (browser-use style)
   * Returns [modifier, virtualKey, baseKey]
   * modifier: 8 = Shift
   */
  private getCharModifiersAndVK(char: string): [number, string, string] {
    const needsShift = /[A-Z!@#$%^&*()_+{}|:"<>?~]/.test(char);
    const modifier = needsShift ? 8 : 0;
    const virtualKey = this.getKeyCodeForChar(char);

    return [modifier, virtualKey, char];
  }

  /**
   * Focus element with fallback strategies (browser-use style)
   * CDP focus -> JS focus -> Click
   */
  private async focusElement(element: ElementHandle): Promise<void> {
    if (!this.page) return;

    try {
      // Try CDP focus first (most reliable)
      await element.focus();
    } catch (cdpError) {
      try {
        // Fallback to JavaScript focus
        await element.evaluate((el: HTMLElement) => el.focus());
      } catch (jsError) {
        // Final fallback: click element
        try {
          await element.click();
        } catch (clickError) {
          this.emitLog('error', { message: 'All focus strategies failed' });
        }
      }
    }
  }

  /**
   * Clear text field using JS value manipulation + event dispatch (browser-use style)
   */
  private async clearTextField(element: ElementHandle): Promise<void> {
    if (!this.page) return;

    try {
      // Primary strategy: Direct JS value manipulation with events
      await element.evaluate((el: any) => {
        if ('value' in el) {
          el.value = '';
          // Dispatch events to notify frameworks (React, Vue, etc.)
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    } catch (error) {
      // Fallback: Triple-click + Delete
      try {
        await element.click({ clickCount: 3 });
        await this.page.waitForTimeout(50);
        await this.page.keyboard.press('Delete');
      } catch (fallbackError) {
        this.emitLog('error', { message: 'Failed to clear text field' });
      }
    }
  }

  /**
   * Type text using low-level keyboard events (browser-use style)
   * Uses keyboard.type() with human-like delays for better compatibility
   * This ensures proper event handling for React/Vue/Angular frameworks
   */
  private async typeTextHumanLike(text: string): Promise<void> {
    if (!this.page) return;

    // Use Playwright's keyboard.type() which properly handles all characters including Unicode
    // This sends proper keydown, keypress, input, and keyup events
    // Human-like delay between keystrokes: 15-25ms random
    const delay = 15 + Math.floor(Math.random() * 10);
    await this.page.keyboard.type(text, { delay });
  }

  /**
   * Unified typing method (browser-use style)
   * Replaces both typeElementByIndex and typeCaptchaAndSubmit
   *
   * @param target - Element index (number) or selector (string)
   * @param text - Text to type
   * @param options - Optional configuration
   */
  async typeText(
    target: number | string,
    text: string,
    options?: {
      clearFirst?: boolean;
      submit?: boolean;
      submitSelectors?: string[];
    }
  ): Promise<boolean> {
    if (!this.page) {
      throw new Error('Page is not initialized.');
    }

    const { clearFirst = true, submit = false, submitSelectors = [] } = options || {};

    try {
      this.emitLog('system', {
        message: `[TypeText] Typing into ${typeof target === 'number' ? `element ${target}` : `selector "${target}"`}: "${text}"`
      });

      let element: ElementHandle | null = null;

      // Get element by index or selector
      if (typeof target === 'number') {
        // DOM index-based (browser-use style)
        const elementMap = await this.getInteractiveElements();
        const elementInfo = this.domExtractor.findElementByIndex(elementMap, target);

        if (!elementInfo) {
          this.emitLog('error', { message: `[TypeText] Element with index ${target} not found` });
          return false;
        }

        // Click element by coordinates to focus
        await this.page.mouse.click(elementInfo.coordinates.x, elementInfo.coordinates.y);
        await this.page.waitForTimeout(150);

        // Clear existing text if requested
        if (clearFirst) {
          // Triple-click to select all, then delete
          await this.page.mouse.click(elementInfo.coordinates.x, elementInfo.coordinates.y, { clickCount: 3 });
          await this.page.waitForTimeout(50);
          await this.page.keyboard.press('Delete');
          await this.page.waitForTimeout(50);
        }
      } else {
        // Selector-based
        element = await this.page.$(target);
        if (!element) {
          this.emitLog('error', { message: `[TypeText] Element not found: ${target}` });
          return false;
        }

        // Focus element
        await this.focusElement(element);
        await this.page.waitForTimeout(100);

        // Clear existing text if requested
        if (clearFirst) {
          await this.clearTextField(element);
          await this.page.waitForTimeout(50);
        }
      }

      // Type text using browser-use style (keyDown/char/keyUp sequence)
      await this.typeTextHumanLike(text);

      await this.streamScreenshot(`typed-text`);
      this.emitLog('system', { message: `[TypeText] Successfully typed text` });

      // Submit if requested
      if (submit) {
        const defaultSubmitSelectors = [
          'input[type="submit"]',
          'button[type="submit"]',
          'button:has-text("Submit")',
          'button:has-text("확인")',
        ];

        const selectors = submitSelectors.length > 0 ? submitSelectors : defaultSubmitSelectors;
        const clicked = await this.tryClickSelectors(selectors);

        if (!clicked) {
          // Fallback: press Enter
          try {
            await this.page.keyboard.press('Enter');
          } catch (_) {}
        }

        await this.waitForPageLoad(8000);
        await this.streamScreenshot('after-submit');
      }

      return true;
    } catch (error) {
      console.error(`[BrowserController] Error typing text:`, error);
      this.emitLog('error', {
        message: `[TypeText] Error: ${(error as Error).message}`,
      });
      return false;
    }
  }

  /**
   * Type text into an element by index
   * @deprecated Use typeText() instead - this is a wrapper for backwards compatibility
   */
  async typeElementByIndex(index: number, text: string): Promise<boolean> {
    return this.typeText(index, text, { clearFirst: true, submit: false });
  }

  /**
   * Type captcha text and submit
   * @deprecated Use typeText() instead - this is a wrapper for backwards compatibility
   */
  async typeCaptchaAndSubmit(
    inputSelector: string | undefined,
    text: string,
    submitSelectorCandidates: string[] = []
  ): Promise<boolean> {
    const selector = inputSelector || 'input[name="captcha"], input#captcha, input[type="text"]';
    return this.typeText(selector, text, {
      clearFirst: true,
      submit: true,
      submitSelectors: submitSelectorCandidates,
    });
  }

  /**
   * Press a key on an element by index (DOM-based, browser-use style)
   * Clicks element to focus, then presses the key
   * @param index The element index from DOM extraction
   * @param key The key to press (e.g., 'Enter', 'Escape', 'Tab')
   * @returns true if successful
   */
  async pressKeyOnElement(index: number, key: string): Promise<boolean> {
    if (!this.page) {
      throw new Error('Page is not initialized.');
    }

    try {
      this.emitLog('system', { message: `[DOM] Pressing key '${key}' on element ${index}` });

      // Get element map
      const elementMap = await this.getInteractiveElements();
      const element = this.domExtractor.findElementByIndex(elementMap, index);

      if (!element) {
        this.emitLog('error', { message: `[DOM] Element with index ${index} not found` });
        return false;
      }

      // Click to focus element using coordinates
      await this.page.mouse.click(element.coordinates.x, element.coordinates.y);
      await this.page.waitForTimeout(100); // Brief wait for focus

      // Press the key
      await this.page.keyboard.press(key);
      await this.page.waitForTimeout(500); // Wait for key press to process

      await this.streamScreenshot(`pressed-key-${key}-element-${index}`);
      this.emitLog('system', { message: `[DOM] Successfully pressed '${key}' on element ${index}` });
      return true;
    } catch (error) {
      console.error(`[BrowserController] Error pressing key on element ${index}:`, error);
      this.emitLog('error', {
        message: `[DOM] Error pressing key on element ${index}: ${(error as Error).message}`,
      });
      return false;
    }
  }

  /**
   * Clear cache when navigating to new page
   */
  private clearInteractiveElementsCache(): void {
    this.interactiveElementsCache = null;
  }

  // ============================================================================
  // SCROLL ACTIONS (Browser-Use Style)
  // ============================================================================

  /**
   * Scroll down the page by pages (browser-use style)
   * @param pages Number of viewport pages to scroll (0.5-10.0, default 1.0)
   */
  async scrollDown(pages: number = 1.0): Promise<boolean> {
    if (!this.page) {
      throw new Error('Page is not initialized.');
    }

    try {
      // Clamp pages between 0.5 and 10.0
      pages = Math.max(0.5, Math.min(10.0, pages));

      // Get viewport height
      const viewportHeight = await this.page.evaluate(() => window.innerHeight);

      this.emitLog('system', { message: `[Scroll] Scrolling down ${pages} pages (${Math.round(viewportHeight * pages)}px)` });

      // If scrolling more than 1 page, do it in chunks with delays (browser-use style)
      if (pages >= 1.0) {
        const fullScrolls = Math.floor(pages);
        const remainingScroll = pages - fullScrolls;

        // Scroll full pages
        for (let i = 0; i < fullScrolls; i++) {
          await this.page.evaluate((vh) => {
            window.scrollBy(0, vh);
          }, viewportHeight);
          // 조건 기반 대기: 스크롤 완료되면 즉시 (requestAnimationFrame)
          await this.page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
        }

        // Scroll remaining fraction
        if (remainingScroll > 0) {
          await this.page.evaluate((px) => {
            window.scrollBy(0, px);
          }, Math.round(viewportHeight * remainingScroll));
          await this.page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
        }
      } else {
        // Single scroll less than 1 page
        const pixels = Math.round(viewportHeight * pages);
        await this.page.evaluate((px) => {
          window.scrollBy(0, px);
        }, pixels);
        await this.page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      }

      await this.streamScreenshot('after-scroll-down');
      this.emitLog('system', { message: `[Scroll] Successfully scrolled down ${pages} pages` });
      return true;
    } catch (error) {
      console.error('[BrowserController] Error scrolling down:', error);
      this.emitLog('error', { message: `[Scroll] Error scrolling down: ${(error as Error).message}` });
      return false;
    }
  }

  /**
   * Scroll up the page by pages (browser-use style)
   * @param pages Number of viewport pages to scroll (0.5-10.0, default 1.0)
   */
  async scrollUp(pages: number = 1.0): Promise<boolean> {
    if (!this.page) {
      throw new Error('Page is not initialized.');
    }

    try {
      // Clamp pages between 0.5 and 10.0
      pages = Math.max(0.5, Math.min(10.0, pages));

      // Get viewport height
      const viewportHeight = await this.page.evaluate(() => window.innerHeight);

      this.emitLog('system', { message: `[Scroll] Scrolling up ${pages} pages (${Math.round(viewportHeight * pages)}px)` });

      // If scrolling more than 1 page, do it in chunks with delays
      if (pages >= 1.0) {
        const fullScrolls = Math.floor(pages);
        const remainingScroll = pages - fullScrolls;

        // Scroll full pages
        for (let i = 0; i < fullScrolls; i++) {
          await this.page.evaluate((vh) => {
            window.scrollBy(0, -vh);
          }, viewportHeight);
          await this.page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
        }

        // Scroll remaining fraction
        if (remainingScroll > 0) {
          await this.page.evaluate((px) => {
            window.scrollBy(0, -px);
          }, Math.round(viewportHeight * remainingScroll));
          await this.page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
        }
      } else {
        // Single scroll less than 1 page
        const pixels = Math.round(viewportHeight * pages);
        await this.page.evaluate((px) => {
          window.scrollBy(0, -px);
        }, pixels);
        await this.page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      }

      await this.streamScreenshot('after-scroll-up');
      this.emitLog('system', { message: `[Scroll] Successfully scrolled up ${pages} pages` });
      return true;
    } catch (error) {
      console.error('[BrowserController] Error scrolling up:', error);
      this.emitLog('error', { message: `[Scroll] Error scrolling up: ${(error as Error).message}` });
      return false;
    }
  }

  /**
   * Scroll to the top of the page
   */
  async scrollToTop(): Promise<boolean> {
    if (!this.page) {
      throw new Error('Page is not initialized.');
    }

    try {
      this.emitLog('system', { message: '[Scroll] Scrolling to top of page' });

      await this.page.evaluate(() => {
        window.scrollTo(0, 0);
      });

      await this.page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      await this.streamScreenshot('after-scroll-top');

      this.emitLog('system', { message: '[Scroll] Successfully scrolled to top' });
      return true;
    } catch (error) {
      console.error('[BrowserController] Error scrolling to top:', error);
      this.emitLog('error', { message: `[Scroll] Error scrolling to top: ${(error as Error).message}` });
      return false;
    }
  }

  /**
   * Scroll to the bottom of the page
   */
  async scrollToBottom(): Promise<boolean> {
    if (!this.page) {
      throw new Error('Page is not initialized.');
    }

    try {
      this.emitLog('system', { message: '[Scroll] Scrolling to bottom of page' });

      await this.page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });

      await this.page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      await this.streamScreenshot('after-scroll-bottom');

      this.emitLog('system', { message: '[Scroll] Successfully scrolled to bottom' });
      return true;
    } catch (error) {
      console.error('[BrowserController] Error scrolling to bottom:', error);
      this.emitLog('error', { message: `[Scroll] Error scrolling to bottom: ${(error as Error).message}` });
      return false;
    }
  }

  /**
   * Scroll to bring an element into view by index
   */
  async scrollToElementByIndex(index: number): Promise<boolean> {
    if (!this.page) {
      throw new Error('Page is not initialized.');
    }

    try {
      this.emitLog('system', { message: `[Scroll] Scrolling to element ${index}` });

      // Get element map
      const elementMap = await this.getInteractiveElements();
      const element = this.domExtractor.findElementByIndex(elementMap, index);

      if (!element) {
        this.emitLog('error', { message: `[Scroll] Element with index ${index} not found` });
        return false;
      }

      // Try to scroll to element by XPath or selector
      try {
        const handle = await this.page.waitForSelector(`xpath=${element.xpath}`, {
          timeout: this.TIMEOUTS.SELECTOR_WAIT,
        });

        if (handle) {
          await handle.scrollIntoViewIfNeeded();
          await this.page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
          await this.streamScreenshot(`after-scroll-to-element-${index}`);
          this.emitLog('system', { message: `[Scroll] Successfully scrolled to element ${index}` });
          return true;
        }
      } catch (error) {
        // Fallback: scroll to coordinates
        this.emitLog('system', { message: `[Scroll] Using coordinate fallback for element ${index}` });
        await this.page.evaluate((y) => {
          window.scrollTo(0, y - window.innerHeight / 2);
        }, element.coordinates.y);

        await this.page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
        await this.streamScreenshot(`after-scroll-to-element-${index}-coords`);
        this.emitLog('system', { message: `[Scroll] Scrolled to element ${index} by coordinates` });
        return true;
      }

      return false;
    } catch (error) {
      console.error(`[BrowserController] Error scrolling to element ${index}:`, error);
      this.emitLog('error', { message: `[Scroll] Error scrolling to element ${index}: ${(error as Error).message}` });
      return false;
    }
  }

  /**
   * Get scroll position information (for LLM context)
   */
  async getScrollInfo(): Promise<{ scrollY: number; scrollHeight: number; viewportHeight: number; atBottom: boolean; atTop: boolean }> {
    if (!this.page) {
      throw new Error('Page is not initialized.');
    }

    try {
      const info = await this.page.evaluate(() => {
        return {
          scrollY: window.scrollY,
          scrollHeight: document.body.scrollHeight,
          viewportHeight: window.innerHeight,
          atBottom: window.scrollY + window.innerHeight >= document.body.scrollHeight - 10,
          atTop: window.scrollY <= 10,
        };
      });

      return info;
    } catch (error) {
      console.error('[BrowserController] Error getting scroll info:', error);
      return { scrollY: 0, scrollHeight: 0, viewportHeight: 0, atBottom: false, atTop: true };
    }
  }

}
