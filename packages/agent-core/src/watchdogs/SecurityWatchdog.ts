/**
 * SecurityWatchdog - Handle security warnings and SSL errors
 * Based on browser-use's SecurityWatchdog
 */

import { BaseWatchdog } from './BaseWatchdog.js';
import { EventBus } from '../events/EventBus.js';
import { BrowserController } from '../browserController.js';
import { SecurityWarningEvent, BrowserEventTypes } from '../events/browserEvents.js';

export class SecurityWatchdog extends BaseWatchdog {
  static readonly LISTENS_TO = ['browser_launch'];
  static readonly EMITS = ['security_warning'];

  async onInitialize(): Promise<void> {
    this.info('Security watchdog initialized');
    // Playwright automatically handles some security warnings via ignoreHTTPSErrors
  }

  /**
   * Handle SSL/TLS certificate error
   */
  async handleSSLError(url: string): Promise<void> {
    this.warn(`SSL/TLS error for: ${url}`);

    const event: SecurityWarningEvent = {
      type: 'security_warning',
      warningType: 'ssl',
      bypassed: true, // We bypass by using ignoreHTTPSErrors
      timestamp: Date.now(),
    };

    await this.emit(BrowserEventTypes.SECURITY_WARNING, event);
  }

  /**
   * Event handler for browser launch
   */
  async on_BrowserLaunchEvent(event: any): Promise<void> {
    if (!this.isEnabled()) return;
    this.debug('Browser launched with security settings');
  }
}
