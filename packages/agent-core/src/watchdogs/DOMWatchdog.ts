/**
 * DOMWatchdog - Monitor DOM state and updates
 * Based on browser-use's DOMWatchdog
 */

import { BaseWatchdog } from './BaseWatchdog.js';
import { EventBus } from '../events/EventBus.js';
import { BrowserController } from '../browserController.js';
import { DOMStateUpdatedEvent, BrowserEventTypes } from '../events/browserEvents.js';

export class DOMWatchdog extends BaseWatchdog {
  static readonly LISTENS_TO = ['navigation_complete'];
  static readonly EMITS = ['dom_state_updated'];

  private lastDOMStateTime = 0;
  private DOM_UPDATE_THROTTLE = 500; // ms

  async onInitialize(): Promise<void> {
    this.info('DOM watchdog initialized');
  }

  /**
   * Handle DOM state update
   */
  async handleDOMUpdate(elementCount: number, timing: Record<string, number>): Promise<void> {
    // Throttle updates
    const now = Date.now();
    if (now - this.lastDOMStateTime < this.DOM_UPDATE_THROTTLE) {
      return;
    }
    this.lastDOMStateTime = now;

    const event: DOMStateUpdatedEvent = {
      type: 'dom_state_updated',
      elementCount,
      timing,
      timestamp: now,
    };

    await this.emit(BrowserEventTypes.DOM_STATE_UPDATED, event);
    this.debug(`DOM updated: ${elementCount} elements, timing:`, timing);
  }

  /**
   * Event handler for navigation complete
   */
  async on_NavigationCompleteEvent(event: any): Promise<void> {
    if (!this.isEnabled()) return;

    if (event.success) {
      this.debug('Navigation complete, DOM will be updated');
    }
  }
}
