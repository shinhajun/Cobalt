/**
 * Watchdogs - Browser monitoring and auto-handling
 */

export { BaseWatchdog, WatchdogConfig } from './BaseWatchdog.js';
export { CrashWatchdog } from './CrashWatchdog.js';
export { PermissionsWatchdog, PermissionsConfig } from './PermissionsWatchdog.js';
export { PopupsWatchdog, PopupsConfig } from './PopupsWatchdog.js';
export { SecurityWatchdog } from './SecurityWatchdog.js';
export { DOMWatchdog } from './DOMWatchdog.js';

import { BaseWatchdog } from './BaseWatchdog.js';
import { CrashWatchdog } from './CrashWatchdog.js';
import { PermissionsWatchdog } from './PermissionsWatchdog.js';
import { PopupsWatchdog } from './PopupsWatchdog.js';
import { SecurityWatchdog } from './SecurityWatchdog.js';
import { DOMWatchdog } from './DOMWatchdog.js';
import { EventBus } from '../events/EventBus.js';
import { BrowserController } from '../browserController.js';

/**
 * Create and initialize all default watchdogs
 */
export async function createDefaultWatchdogs(
  eventBus: EventBus,
  browserController: BrowserController
): Promise<BaseWatchdog[]> {
  const watchdogs: BaseWatchdog[] = [
    new CrashWatchdog(eventBus, browserController, { enabled: true, debug: false }),
    new PermissionsWatchdog(eventBus, browserController, { enabled: true, debug: false }),
    new PopupsWatchdog(eventBus, browserController, { enabled: true, debug: false }),
    new SecurityWatchdog(eventBus, browserController, { enabled: true, debug: false }),
    new DOMWatchdog(eventBus, browserController, { enabled: true, debug: false }),
  ];

  // Initialize all watchdogs
  for (const watchdog of watchdogs) {
    try {
      await watchdog.onInitialize();
    } catch (error: any) {
      console.error(`Failed to initialize ${watchdog.getName()}:`, error.message);
    }
  }

  return watchdogs;
}

/**
 * Destroy all watchdogs
 */
export async function destroyWatchdogs(watchdogs: BaseWatchdog[]): Promise<void> {
  for (const watchdog of watchdogs) {
    try {
      await watchdog.onDestroy();
    } catch (error: any) {
      console.error(`Failed to destroy ${watchdog.getName()}:`, error.message);
    }
  }
}
