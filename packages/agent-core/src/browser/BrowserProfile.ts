/**
 * Browser Profile - Configuration for browser instances
 * TypeScript port of browser_use.browser.profile
 */

export interface ProxySettings {
  server: string;
  username?: string;
  password?: string;
  bypass?: string;
}

export interface BrowserProfileConfig {
  headless?: boolean;
  disableImages?: boolean;
  disableSecurity?: boolean;
  extraChromiumArgs?: string[];
  minimumWaitPageLoadTime?: number;
  waitForNetworkIdlePageLoadTime?: number;
  maximumWaitPageLoadTime?: number;
  userDataDir?: string;
  proxy?: ProxySettings;
  cookies?: any[];
  storageState?: string | { cookies: any[]; origins: any[] };
  locale?: string;
  timezone?: string;
  viewport?: { width: number; height: number };
  userAgent?: string;
  downloadsPath?: string;
}

export class BrowserProfile {
  public headless: boolean = true;
  public disableImages: boolean = false;
  public disableSecurity: boolean = false; // Changed to false - aggressive security bypass triggers bot detection
  public extraChromiumArgs: string[] = [];
  public minimumWaitPageLoadTime: number = 0.5; // seconds
  public waitForNetworkIdlePageLoadTime: number = 1.0; // seconds
  public maximumWaitPageLoadTime: number = 5.0; // seconds
  public userDataDir?: string;
  public proxy?: ProxySettings;
  public cookies?: any[];
  public storageState?: string | { cookies: any[]; origins: any[] };
  public locale: string = 'ko-KR';
  public timezone?: string;
  public viewport: { width: number; height: number } = { width: 1920, height: 1080 };
  public userAgent: string = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  public downloadsPath?: string;

  constructor(config: BrowserProfileConfig = {}) {
    Object.assign(this, config);
  }

  /**
   * Get launch args for Chromium
   */
  getLaunchArgs(): string[] {
    const args = [
      // Anti-detection (browser-use compatibility)
      '--disable-blink-features=AutomationControlled',
      '--disable-features=AutomationControlled',

      // Window settings
      '--window-size=1920,1080',
      '--start-maximized',
      '--disable-infobars',
      '--disable-notifications',
      '--disable-popup-blocking',

      // Additional browser-use args for better compatibility
      '--disable-background-networking',
      '--disable-ipc-flooding-protection',
      '--disable-hang-monitor',
      '--metrics-recording-only',
      '--no-first-run',
      '--no-service-autorun',
      '--disable-component-update',
      '--disable-client-side-phishing-detection',
      '--disable-breakpad',
    ];

    if (this.disableSecurity) {
      args.push(
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
        '--no-sandbox',
        '--disable-setuid-sandbox'
      );
    }

    if (this.disableImages) {
      args.push('--blink-settings=imagesEnabled=false');
    }

    // Performance optimizations
    args.push(
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu'
    );

    // Add extra args
    args.push(...this.extraChromiumArgs);

    return args;
  }

  /**
   * Get context options for Playwright
   */
  getContextOptions(): any {
    const options: any = {
      viewport: this.viewport,
      userAgent: this.userAgent,
      locale: this.locale,
      acceptDownloads: true,
      bypassCSP: this.disableSecurity,
      ignoreHTTPSErrors: this.disableSecurity,
      javaScriptEnabled: true,
      extraHTTPHeaders: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': `${this.locale},ko;q=0.9,en-US;q=0.8,en;q=0.7`,
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
      },
    };

    if (this.timezone) {
      options.timezoneId = this.timezone;
    }

    if (this.proxy) {
      options.proxy = this.proxy;
    }

    if (this.storageState) {
      options.storageState = this.storageState;
    }

    if (this.downloadsPath) {
      options.downloadsPath = this.downloadsPath;
    }

    return options;
  }

  /**
   * Create default profile
   */
  static createDefault(): BrowserProfile {
    return new BrowserProfile();
  }

  /**
   * Create profile with custom user data directory
   */
  static withUserDataDir(userDataDir: string): BrowserProfile {
    return new BrowserProfile({ userDataDir });
  }

  /**
   * Create profile with proxy
   */
  static withProxy(proxy: ProxySettings): BrowserProfile {
    return new BrowserProfile({ proxy });
  }

  /**
   * Clone profile with modifications
   */
  clone(modifications: Partial<BrowserProfileConfig> = {}): BrowserProfile {
    return new BrowserProfile({
      headless: this.headless,
      disableImages: this.disableImages,
      disableSecurity: this.disableSecurity,
      extraChromiumArgs: [...this.extraChromiumArgs],
      minimumWaitPageLoadTime: this.minimumWaitPageLoadTime,
      waitForNetworkIdlePageLoadTime: this.waitForNetworkIdlePageLoadTime,
      maximumWaitPageLoadTime: this.maximumWaitPageLoadTime,
      userDataDir: this.userDataDir,
      proxy: this.proxy ? { ...this.proxy } : undefined,
      cookies: this.cookies ? [...this.cookies] : undefined,
      storageState: this.storageState,
      locale: this.locale,
      timezone: this.timezone,
      viewport: { ...this.viewport },
      userAgent: this.userAgent,
      downloadsPath: this.downloadsPath,
      ...modifications,
    });
  }
}
