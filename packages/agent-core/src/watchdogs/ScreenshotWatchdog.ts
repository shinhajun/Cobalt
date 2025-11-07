import { BaseWatchdog, WatchdogConfig } from './BaseWatchdog.js';
import { EventBus } from '../events/EventBus.js';
import { BrowserController } from '../browserController.js';
import { ScreenshotEvent } from '../events/browserEvents.js';
import { debug, error as logError } from '../utils/logger.js';

/**
 * Screenshot Watchdog for handling screenshot requests using CDP
 *
 * Based on browser-use's ScreenshotWatchdog
 */
export class ScreenshotWatchdog extends BaseWatchdog {
  constructor(eventBus: EventBus, browserController: BrowserController, config: WatchdogConfig) {
    super(eventBus, browserController, config);
  }

  async onInitialize(): Promise<void> {
    debug('[ScreenshotWatchdog] Initializing...');

    // Listen to screenshot events
    this.eventBus.on('screenshot', async (event: ScreenshotEvent) => {
      await this.handleScreenshotEvent(event);
    });

    debug('[ScreenshotWatchdog] Initialized');
  }

  async onDestroy(): Promise<void> {
    debug('[ScreenshotWatchdog] Destroying...');
    // Event listeners are automatically cleaned up by EventBus
  }

  /**
   * Handle screenshot request using CDP
   */
  private async handleScreenshotEvent(event: ScreenshotEvent): Promise<string | null> {
    debug('[ScreenshotWatchdog] Screenshot request received');

    try {
      // Get CDP session for current target
      if (!this.browserController['browserSession']) {
        throw new Error('BrowserSession not initialized');
      }

      const browserSession = this.browserController['browserSession'];
      const sessionInfo = await browserSession.getOrCreateCDPSession();

      // Prepare screenshot parameters
      const params: any = {
        format: 'jpeg',
        quality: 60,
        captureBeyondViewport: false,
      };

      // Take screenshot using CDP
      debug(`[ScreenshotWatchdog] Taking screenshot with params: ${JSON.stringify(params)}`);
      const result = await (sessionInfo.cdpSession as any).send('Page.captureScreenshot', params);

      // Return base64-encoded screenshot data
      if (result && result.data) {
        debug('[ScreenshotWatchdog] Screenshot captured successfully');
        return result.data;
      }

      throw new Error('[ScreenshotWatchdog] Screenshot result missing data');
    } catch (error: any) {
      logError('[ScreenshotWatchdog] Screenshot failed:', error.message);
      throw error;
    }
  }

  /**
   * ScreenshotWatchdog doesn't need to monitor individual targets
   */
  async attachToTarget(targetId: string): Promise<void> {
    // No-op: Screenshot watchdog operates on the current active target only
  }
}