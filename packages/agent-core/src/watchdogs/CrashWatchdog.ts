/**
 * CrashWatchdog - Detect and recover from browser/page crashes
 * Enhanced with network timeout monitoring and health checks (browser-use style)
 */

import { BaseWatchdog } from './BaseWatchdog.js';
import { EventBus } from '../events/EventBus.js';
import { BrowserController } from '../browserController.js';
import {
  BrowserCrashEvent,
  BrowserCrashRecoveredEvent,
  BrowserEventTypes,
  BrowserConnectedEvent,
  BrowserStoppedEvent,
} from '../events/browserEvents.js';
import { PageCrashError } from '../errors/BrowserError.js';

/**
 * Network request tracker
 */
interface NetworkRequestTracker {
  requestId: string;
  startTime: number;
  url: string;
  method: string;
  resourceType?: string;
}

/**
 * Browser error event data
 */
interface BrowserErrorEvent {
  type: 'browser_error';
  errorType: 'NetworkTimeout' | 'TargetCrash' | 'BrowserProcessCrashed' | 'HealthCheckFailed';
  message: string;
  details: Record<string, any>;
  timestamp: number;
}

export class CrashWatchdog extends BaseWatchdog {
  static readonly LISTENS_TO = [
    'navigation_complete',
    'navigation_started',
    'browser_launch',
    'browser_stopped',
  ];
  static readonly EMITS = ['browser_crash', 'browser_crash_recovered', 'browser_error'];

  // Configuration
  private maxRecoveryAttempts = 3;
  private networkTimeoutSeconds = 10.0;
  private checkIntervalSeconds = 5.0;

  // State
  private recoveryAttempts: Map<string, number> = new Map();
  private crashMonitoringActive = false;
  private activeRequests: Map<string, NetworkRequestTracker> = new Map();
  private monitoringTask: NodeJS.Timeout | null = null;
  private cdpSession: any = null;

  async onInitialize(): Promise<void> {
    this.info('Crash watchdog initialized with network monitoring and health checks');
    await this.startCrashMonitoring();
  }

  async onDestroy(): Promise<void> {
    this.crashMonitoringActive = false;
    await this.stopMonitoring();
  }

  /**
   * Start monitoring for page crashes and network issues
   */
  private async startCrashMonitoring(): Promise<void> {
    if (this.crashMonitoringActive) {
      return;
    }

    this.crashMonitoringActive = true;
    this.debug('Started crash monitoring with network timeout detection');

    try {
      const page = (this.browserController as any).page;
      if (!page) {
        this.warn('No page available for crash monitoring');
        return;
      }

      // Get CDP session for network monitoring
      try {
        this.cdpSession = await page.context().newCDPSession(page);

        // Enable network tracking
        await this.cdpSession.send('Network.enable');

        // Set up network event listeners
        this.cdpSession.on('Network.requestWillBeSent', (event: any) => {
          this.onRequestWillBeSent(event);
        });

        this.cdpSession.on('Network.responseReceived', (event: any) => {
          this.onResponseReceived(event);
        });

        this.cdpSession.on('Network.loadingFailed', (event: any) => {
          this.onLoadingFailed(event);
        });

        this.cdpSession.on('Network.loadingFinished', (event: any) => {
          this.onLoadingFinished(event);
        });

        this.debug('Network monitoring enabled');
      } catch (error: any) {
        this.warn('Failed to enable network monitoring:', error.message);
      }

      // Listen for page crash events
      page.on('crash', async () => {
        this.error('Page crashed!');
        await this.handlePageCrash('main');
      });

      // Listen for page errors
      page.on('pageerror', (error: Error) => {
        this.debug('Page error detected:', error.message);
        if (this.isFatalError(error)) {
          this.handlePageCrash('main');
        }
      });

      // Start health check monitoring loop
      this.startMonitoringLoop();
    } catch (error: any) {
      this.error('Failed to start crash monitoring:', error.message);
    }
  }

  /**
   * Track new network request
   */
  private onRequestWillBeSent(event: any): void {
    const requestId = event.requestId;
    const request = event.request;

    this.activeRequests.set(requestId, {
      requestId,
      startTime: Date.now(),
      url: request.url,
      method: request.method,
      resourceType: event.type,
    });

    this.debug(`Tracking network request: ${request.method} ${request.url.substring(0, 50)}...`);
  }

  /**
   * Remove request from tracking on response
   */
  private onResponseReceived(event: any): void {
    const requestId = event.requestId;
    if (this.activeRequests.has(requestId)) {
      const tracker = this.activeRequests.get(requestId)!;
      const elapsed = Date.now() - tracker.startTime;
      this.debug(`Request completed in ${elapsed}ms: ${tracker.url.substring(0, 50)}...`);
      // Don't remove yet - wait for loadingFinished
    }
  }

  /**
   * Remove request from tracking on failure
   */
  private onLoadingFailed(event: any): void {
    const requestId = event.requestId;
    if (this.activeRequests.has(requestId)) {
      const tracker = this.activeRequests.get(requestId)!;
      const elapsed = Date.now() - tracker.startTime;
      this.debug(`Request failed after ${elapsed}ms: ${tracker.url.substring(0, 50)}...`);
      this.activeRequests.delete(requestId);
    }
  }

  /**
   * Remove request from tracking when loading finished
   */
  private onLoadingFinished(event: any): void {
    const requestId = event.requestId;
    this.activeRequests.delete(requestId);
  }

  /**
   * Start monitoring loop for network timeouts and health checks
   */
  private startMonitoringLoop(): void {
    if (this.monitoringTask) {
      return;
    }

    this.debug('Starting monitoring loop (check interval: 5s)');

    this.monitoringTask = setInterval(async () => {
      try {
        await this.checkNetworkTimeouts();
        await this.checkBrowserHealth();
      } catch (error: any) {
        this.error('Error in monitoring loop:', error.message);
      }
    }, this.checkIntervalSeconds * 1000);
  }

  /**
   * Stop monitoring loop
   */
  private async stopMonitoring(): Promise<void> {
    if (this.monitoringTask) {
      clearInterval(this.monitoringTask);
      this.monitoringTask = null;
      this.debug('Monitoring loop stopped');
    }

    if (this.cdpSession) {
      try {
        await this.cdpSession.detach();
        this.cdpSession = null;
      } catch (error) {
        // Ignore detach errors
      }
    }

    this.activeRequests.clear();
  }

  /**
   * Check for network requests exceeding timeout
   */
  private async checkNetworkTimeouts(): Promise<void> {
    const currentTime = Date.now();
    const timedOutRequests: [string, NetworkRequestTracker][] = [];

    for (const [requestId, tracker] of this.activeRequests.entries()) {
      const elapsed = (currentTime - tracker.startTime) / 1000;
      if (elapsed >= this.networkTimeoutSeconds) {
        timedOutRequests.push([requestId, tracker]);
      }
    }

    // Emit events for timed out requests
    for (const [requestId, tracker] of timedOutRequests) {
      this.warn(
        `Network request timeout after ${this.networkTimeoutSeconds}s: ${tracker.method} ${tracker.url.substring(0, 100)}...`
      );

      const errorEvent: BrowserErrorEvent = {
        type: 'browser_error',
        errorType: 'NetworkTimeout',
        message: `Network request timed out after ${this.networkTimeoutSeconds}s`,
        details: {
          url: tracker.url,
          method: tracker.method,
          resourceType: tracker.resourceType,
          elapsedSeconds: (currentTime - tracker.startTime) / 1000,
        },
        timestamp: currentTime,
      };

      await this.emit('browser_error', errorEvent);

      // Remove from tracking
      this.activeRequests.delete(requestId);
    }
  }

  /**
   * Check if browser and page are still responsive
   */
  private async checkBrowserHealth(): Promise<void> {
    try {
      const page = (this.browserController as any).page;
      if (!page) {
        this.debug('No page available for health check');
        return;
      }

      // Quick ping to check if page is alive - evaluate simple expression
      this.debug('Running browser health check (1+1 test)');

      const result = await Promise.race([
        page.evaluate(() => 1 + 1),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), 1000)
        ),
      ]);

      if (result === 2) {
        this.debug('Browser health check passed');
      }
    } catch (error: any) {
      this.error('❌ Browser health check failed:', error.message);

      const errorEvent: BrowserErrorEvent = {
        type: 'browser_error',
        errorType: 'HealthCheckFailed',
        message: `Browser health check failed: ${error.message}`,
        details: {
          error: error.message,
          type: error.constructor.name,
        },
        timestamp: Date.now(),
      };

      await this.emit('browser_error', errorEvent);
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
   * Event handler for browser launch
   */
  async on_BrowserLaunchEvent(event: any): Promise<void> {
    if (!this.isEnabled()) return;
    this.debug('Browser launched, starting enhanced monitoring');
  }

  /**
   * Event handler for browser stopped
   */
  async on_BrowserStoppedEvent(event: any): Promise<void> {
    if (!this.isEnabled()) return;
    this.debug('Browser stopped, ending monitoring');
    await this.stopMonitoring();
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
