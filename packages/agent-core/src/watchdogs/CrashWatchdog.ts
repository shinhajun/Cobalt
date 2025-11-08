/**
 * CrashWatchdog - Detect and recover from browser/page crashes
 * Based on browser-use's CrashWatchdog
 */

import { BaseWatchdog } from './BaseWatchdog.js';
import { EventBus } from '../events/EventBus.js';
import { BrowserController } from '../browserController.js';
import {
  BrowserCrashEvent,
  BrowserCrashRecoveredEvent,
  BrowserEventTypes,
} from '../events/browserEvents.js';
import { PageCrashError } from '../errors/BrowserError.js';

export class CrashWatchdog extends BaseWatchdog {
  static readonly LISTENS_TO = ['navigation_complete', 'navigation_started'];
  static readonly EMITS = ['browser_crash', 'browser_crash_recovered'];

  private maxRecoveryAttempts = 3;
  private recoveryAttempts: Map<string, number> = new Map();
  private crashMonitoringActive = false;

  async onInitialize(): Promise<void> {
    this.info('Crash watchdog initialized');
    await this.startCrashMonitoring();
  }

  async onDestroy(): Promise<void> {
    this.crashMonitoringActive = false;
  }

  /**
   * Start monitoring for page crashes
   */
  private async startCrashMonitoring(): Promise<void> {
    if (this.crashMonitoringActive) {
      return;
    }

    this.crashMonitoringActive = true;
    this.debug('Started crash monitoring');

    try {
      const page = (this.browserController as any).page;
      if (!page) {
        this.warn('No page available for crash monitoring');
        return;
      }

      // Listen for page crash events
      page.on('crash', async () => {
        this.error('Page crashed!');
        await this.handlePageCrash('main');
      });

      // Listen for page errors
      page.on('pageerror', (error: Error) => {
        this.debug('Page error detected:', error.message);
        // Don't treat all page errors as crashes, only fatal ones
        if (this.isFatalError(error)) {
          this.handlePageCrash('main');
        }
      });

    } catch (error: any) {
      this.error('Failed to start crash monitoring:', error.message);
    }
  }

  /**
   * Handle page crash event
   */
  private async handlePageCrash(tabId: string): Promise<void> {
    const attemptCount = (this.recoveryAttempts.get(tabId) || 0) + 1;
    this.recoveryAttempts.set(tabId, attemptCount);

    // Emit crash event
    const crashEvent: BrowserCrashEvent = {
      type: 'browser_crash',
      tabId,
      errorMessage: 'Page crashed',
      timestamp: Date.now(),
    };
    await this.emit(BrowserEventTypes.BROWSER_CRASH, crashEvent);

    // Attempt recovery
    if (attemptCount <= this.maxRecoveryAttempts) {
      this.warn(`Attempting crash recovery (attempt ${attemptCount}/${this.maxRecoveryAttempts})`);

      try {
        await this.recoverFromCrash(tabId);

        // Emit recovery success event
        const recoveryEvent: BrowserCrashRecoveredEvent = {
          type: 'browser_crash_recovered',
          tabId,
          attemptNumber: attemptCount,
          timestamp: Date.now(),
        };
        await this.emit(BrowserEventTypes.BROWSER_CRASH_RECOVERED, recoveryEvent);

        this.info(`Successfully recovered from crash (attempt ${attemptCount})`);

        // Reset attempt count on success
        this.recoveryAttempts.set(tabId, 0);
      } catch (error: any) {
        this.error(`Crash recovery failed (attempt ${attemptCount}):`, error.message);

        if (attemptCount >= this.maxRecoveryAttempts) {
          this.error('Max recovery attempts reached. Giving up.');
          throw new PageCrashError('Failed to recover from page crash after multiple attempts');
        }
      }
    } else {
      throw new PageCrashError('Max crash recovery attempts exceeded');
    }
  }

  /**
   * Recover from a page crash
   */
  private async recoverFromCrash(tabId: string): Promise<void> {
    this.info('Recovering from crash...');

    try {
      const page = (this.browserController as any).page;
      if (!page) {
        throw new Error('No page available');
      }

      // Get current URL before reload
      const currentUrl = await page.url().catch(() => 'about:blank');

      // Wait a bit before reload
      await this.sleep(1000);

      // Reload the page
      if (currentUrl && currentUrl !== 'about:blank') {
        this.debug(`Reloading page: ${currentUrl}`);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      } else {
        this.debug('Navigating to new page');
        await page.goto('about:blank');
      }

      this.info('Page reloaded successfully');
    } catch (error: any) {
      this.error('Failed to recover from crash:', error.message);
      throw error;
    }
  }

  /**
   * Check if an error is fatal (should be treated as crash)
   */
  private isFatalError(error: Error): boolean {
    const fatalPatterns = [
      /out of memory/i,
      /maximum call stack/i,
      /script execution/i,
      /unhandled promise rejection/i,
    ];

    return fatalPatterns.some((pattern) => pattern.test(error.message));
  }

  /**
   * Reset recovery attempts for a tab
   */
  resetRecoveryAttempts(tabId: string): void {
    this.recoveryAttempts.set(tabId, 0);
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Event handler for navigation complete (reset attempts on successful navigation)
   */
  async on_NavigationCompleteEvent(event: any): Promise<void> {
    if (!this.isEnabled()) return;

    if (event.success) {
      this.debug('Navigation successful, resetting crash recovery attempts');
      this.resetRecoveryAttempts(event.tabId || 'main');
    }
  }
}
