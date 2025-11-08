/**
 * Watchdogs - Browser monitoring and auto-handling
 */

export { BaseWatchdog, WatchdogConfig } from './BaseWatchdog.js';
export { CrashWatchdog } from './CrashWatchdog.js';
export { PermissionsWatchdog, PermissionsConfig } from './PermissionsWatchdog.js';
export { PopupsWatchdog, PopupsConfig } from './PopupsWatchdog.js';
export { SecurityWatchdog } from './SecurityWatchdog.js';
export { DOMWatchdog } from './DOMWatchdog.js';
export { ScreenshotWatchdog } from './ScreenshotWatchdog.js';
export { DownloadsWatchdog, DownloadsConfig } from './DownloadsWatchdog.js';

import { BaseWatchdog } from './BaseWatchdog.js';
import { CrashWatchdog } from './CrashWatchdog.js';
import { PermissionsWatchdog } from './PermissionsWatchdog.js';
import { PopupsWatchdog } from './PopupsWatchdog.js';
import { SecurityWatchdog } from './SecurityWatchdog.js';
import { DOMWatchdog } from './DOMWatchdog.js';
import { ScreenshotWatchdog } from './ScreenshotWatchdog.js';
import { DownloadsWatchdog } from './DownloadsWatchdog.js';
import { EventBus } from '../events/EventBus.js';
import { BrowserController } from '../browserController.js';
import { error as logError } from '../utils/logger.js';

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
    new ScreenshotWatchdog(eventBus, browserController, { enabled: true, debug: false }),
    new DownloadsWatchdog(eventBus, browserController, { enabled: true, debug: false, autoDownloadPDFs: true }),
  ];

  // Initialize all watchdogs
  for (const watchdog of watchdogs) {
    try {
      await watchdog.onInitialize();
    } catch (error: any) {
      logError(`Failed to initialize ${watchdog.getName()}:`, error.message);
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
      logError(`Failed to destroy ${watchdog.getName()}:`, error.message);
    }
  }
}
