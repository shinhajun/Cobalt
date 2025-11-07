/**
 * PopupsWatchdog - Handle popup windows and new tabs
 * Based on browser-use's PopupsWatchdog
 */

import { BaseWatchdog } from './BaseWatchdog.js';
import { EventBus } from '../events/EventBus.js';
import { BrowserController } from '../browserController.js';
import { PopupDetectedEvent, BrowserEventTypes } from '../events/browserEvents.js';
import { Page } from 'playwright';

export interface PopupsConfig {
  enabled?: boolean;
  debug?: boolean;
  blockPopups?: boolean; // Whether to block popups by default
  allowlist?: string[]; // Domains to allow popups from
}

export class PopupsWatchdog extends BaseWatchdog {
  static readonly LISTENS_TO = ['browser_launch'];
  static readonly EMITS = ['popup_detected'];

  private popupsConfig: PopupsConfig;
  private popupPages: Set<Page> = new Set();

  constructor(
    eventBus: EventBus,
    browserController: BrowserController,
    config: PopupsConfig = {}
  ) {
    super(eventBus, browserController, config);

    this.popupsConfig = {
      enabled: config.enabled ?? true,
      debug: config.debug ?? false,
      blockPopups: config.blockPopups ?? true,
      allowlist: config.allowlist ?? [],
    };
  }

  async onInitialize(): Promise<void> {
    this.info('Popups watchdog initialized');
    await this.setupPopupHandlers();
  }

  /**
   * Setup popup detection handlers
   */
  private async setupPopupHandlers(): Promise<void> {
    try {
      const page = (this.browserController as any).page;
      if (!page) {
        this.warn('No page available for popup handling');
        return;
      }

      // Listen for new popups
      page.on('popup', async (popup: Page) => {
        await this.handlePopup(popup);
      });

      this.debug('Popup handlers configured');
    } catch (error: any) {
      this.error('Failed to setup popup handlers:', error.message);
    }
  }

  /**
   * Handle a popup page
   */
  private async handlePopup(popup: Page): Promise<void> {
    try {
      let url = 'about:blank';
      try {
        url = await popup.url();
      } catch (err) {
        // Page might not be ready yet
      }
      this.debug(`Popup detected: ${url}`);

      const shouldBlock = this.shouldBlockPopup(url);

      // Emit event
      const event: PopupDetectedEvent = {
        type: 'popup_detected',
        url,
        blocked: shouldBlock,
        timestamp: Date.now(),
      };
      await this.emit(BrowserEventTypes.POPUP_DETECTED, event);

      if (shouldBlock) {
        this.info(`Blocking popup: ${url}`);
        await popup.close();
      } else {
        this.info(`Allowing popup: ${url}`);
        this.popupPages.add(popup);

        // Cleanup when popup closes
        popup.on('close', () => {
          this.popupPages.delete(popup);
        });
      }
    } catch (error: any) {
      this.error('Error handling popup:', error.message);
    }
  }

  /**
   * Determine if a popup should be blocked
   */
  private shouldBlockPopup(url: string): boolean {
    if (!this.popupsConfig.blockPopups) {
      return false;
    }

    // Check allowlist
    if (this.popupsConfig.allowlist && this.popupsConfig.allowlist.length > 0) {
      try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname;

        for (const allowed of this.popupsConfig.allowlist) {
          if (hostname.includes(allowed) || allowed.includes(hostname)) {
            this.debug(`Popup URL ${url} is in allowlist`);
            return false;
          }
        }
      } catch (error) {
        // Invalid URL, block it
        return true;
      }
    }

    return true;
  }

  /**
   * Get all currently open popups
   */
  getOpenPopups(): Page[] {
    return Array.from(this.popupPages);
  }

  /**
   * Close all open popups
   */
  async closeAllPopups(): Promise<void> {
    this.info(`Closing ${this.popupPages.size} open popups`);

    for (const popup of this.popupPages) {
      try {
        await popup.close();
      } catch (error: any) {
        this.error('Failed to close popup:', error.message);
      }
    }

    this.popupPages.clear();
  }

  /**
   * Event handler for browser launch
   */
  async on_BrowserLaunchEvent(event: any): Promise<void> {
    if (!this.isEnabled()) return;
    this.debug('Browser launched, setting up popup handlers');
    await this.setupPopupHandlers();
  }
}
