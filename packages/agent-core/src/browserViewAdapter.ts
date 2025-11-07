/**
 * BrowserViewAdapter - Electron BrowserView를 Playwright Page처럼 사용할 수 있게 해주는 어댑터
 * AI가 사용자가 보는 BrowserView에서 직접 작업할 수 있도록 지원
 */

export class BrowserViewAdapter {
  private webContents: any;

  constructor(webContents: any) {
    this.webContents = webContents;
  }

  /**
   * Navigate to URL
   */
  async goto(url: string): Promise<void> {
    await this.webContents.loadURL(url);
    // Wait for page to load
    await this.waitForLoad();
  }

  /**
   * Wait for page load
   */
  private async waitForLoad(timeout: number = 30000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Page load timeout'));
      }, timeout);

      const onLoad = () => {
        clearTimeout(timer);
        this.webContents.removeListener('did-finish-load', onLoad);
        this.webContents.removeListener('did-fail-load', onFail);
        resolve();
      };

      const onFail = (_event: any, errorCode: number, errorDescription: string) => {
        clearTimeout(timer);
        this.webContents.removeListener('did-finish-load', onLoad);
        this.webContents.removeListener('did-fail-load', onFail);
        reject(new Error(`Page load failed: ${errorDescription} (${errorCode})`));
      };

      this.webContents.on('did-finish-load', onLoad);
      this.webContents.on('did-fail-load', onFail);
    });
  }

  /**
   * Get current URL
   */
  url(): string {
    return this.webContents.getURL();
  }

  /**
   * Get page title
   */
  async title(): Promise<string> {
    return this.webContents.getTitle();
  }

  /**
   * Take screenshot
   */
  async screenshot(): Promise<Buffer> {
    const image = await this.webContents.capturePage();
    return image.toPNG();
  }

  /**
   * Execute JavaScript in page
   */
  async evaluate<T>(pageFunction: string | ((...args: any[]) => T), ...args: any[]): Promise<T> {
    const funcString = typeof pageFunction === 'function' ? `(${pageFunction.toString()})(${args.map(a => JSON.stringify(a)).join(',')})` : pageFunction;
    return await this.webContents.executeJavaScript(funcString);
  }

  /**
   * Click element by selector
   */
  async click(selector: string): Promise<void> {
    await this.evaluate((sel: string) => {
      const element = document.querySelector(sel) as HTMLElement;
      if (!element) throw new Error(`Element not found: ${sel}`);
      element.click();
    }, selector);
    await this.wait(500); // Stabilization
  }

  /**
   * Type text into input field
   */
  async fill(selector: string, text: string): Promise<void> {
    await this.evaluate((sel: string, value: string) => {
      const element = document.querySelector(sel) as HTMLInputElement;
      if (!element) throw new Error(`Element not found: ${sel}`);
      element.value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }, selector, text);
  }

  /**
   * Press keyboard key
   */
  async press(key: string): Promise<void> {
    // Convert Playwright key names to Electron key names
    const keyMap: Record<string, string> = {
      'Enter': 'Return',
      'Escape': 'Escape',
      'Backspace': 'Backspace',
      'Tab': 'Tab',
      'Space': 'Space',
    };

    const electronKey = keyMap[key] || key;

    await this.evaluate((k: string) => {
      const event = new KeyboardEvent('keydown', { key: k, bubbles: true });
      document.activeElement?.dispatchEvent(event);

      const pressEvent = new KeyboardEvent('keypress', { key: k, bubbles: true });
      document.activeElement?.dispatchEvent(pressEvent);

      const upEvent = new KeyboardEvent('keyup', { key: k, bubbles: true });
      document.activeElement?.dispatchEvent(upEvent);
    }, key);
  }

  /**
   * Get page content (HTML)
   */
  async content(): Promise<string> {
    return await this.evaluate(() => document.documentElement.outerHTML);
  }

  /**
   * Wait for selector to appear
   */
  async waitForSelector(selector: string, timeout: number = 5000): Promise<void> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const exists = await this.evaluate((sel: string) => {
        return !!document.querySelector(sel);
      }, selector);

      if (exists) return;
      await this.wait(100);
    }
    throw new Error(`Selector not found: ${selector}`);
  }

  /**
   * Check if selector exists
   */
  async isVisible(selector: string): Promise<boolean> {
    return await this.evaluate((sel: string) => {
      const element = document.querySelector(sel) as HTMLElement;
      if (!element) return false;
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && element.offsetParent !== null;
    }, selector);
  }

  /**
   * Get element text content
   */
  async textContent(selector: string): Promise<string | null> {
    return await this.evaluate((sel: string) => {
      const element = document.querySelector(sel);
      return element?.textContent || null;
    }, selector);
  }

  /**
   * Wait for navigation
   */
  async waitForNavigation(timeout: number = 30000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Navigation timeout'));
      }, timeout);

      const onNavigate = () => {
        clearTimeout(timer);
        this.webContents.removeListener('did-navigate', onNavigate);
        resolve();
      };

      this.webContents.on('did-navigate', onNavigate);
    });
  }

  /**
   * Wait utility
   */
  private async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Reload page
   */
  async reload(): Promise<void> {
    this.webContents.reload();
    await this.waitForLoad();
  }

  /**
   * Go back
   */
  async goBack(): Promise<void> {
    if (this.webContents.canGoBack()) {
      this.webContents.goBack();
      await this.waitForLoad();
    }
  }

  /**
   * Go forward
   */
  async goForward(): Promise<void> {
    if (this.webContents.canGoForward()) {
      this.webContents.goForward();
      await this.waitForLoad();
    }
  }
}
