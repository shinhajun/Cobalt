/**
 * PermissionsWatchdog - Auto handle browser permission requests
 * Based on browser-use's PermissionsWatchdog
 */

import { BaseWatchdog } from './BaseWatchdog.js';
import { EventBus } from '../events/EventBus.js';
import { BrowserController } from '../browserController.js';
import { PermissionRequestEvent, BrowserEventTypes } from '../events/browserEvents.js';

export interface PermissionsConfig {
  enabled?: boolean;
  debug?: boolean;
  autoGrant?: string[]; // List of permissions to auto-grant
  autoDeny?: string[]; // List of permissions to auto-deny
}

export class PermissionsWatchdog extends BaseWatchdog {
  static readonly LISTENS_TO = ['browser_launch'];
  static readonly EMITS = ['permission_request'];

  private permissionsConfig: PermissionsConfig;

  constructor(
    eventBus: EventBus,
    browserController: BrowserController,
    config: PermissionsConfig = {}
  ) {
    super(eventBus, browserController, config);

    this.permissionsConfig = {
      enabled: config.enabled ?? true,
      debug: config.debug ?? false,
      // Auto-deny by default for privacy/security
      autoDeny: config.autoDeny ?? ['notifications', 'push', 'midi'],
      // Auto-grant only specific permissions
      autoGrant: config.autoGrant ?? [],
    };
  }

  async onInitialize(): Promise<void> {
    this.info('Permissions watchdog initialized');
    await this.setupPermissionHandlers();
  }

  /**
   * Setup permission request handlers
   */
  private async setupPermissionHandlers(): Promise<void> {
    try {
      const context = (this.browserController as any).context;
      if (!context) {
        this.warn('No browser context available for permission handling');
        return;
      }

      // Grant specific permissions by default
      const grantsToSet = this.permissionsConfig.autoGrant || [];
      if (grantsToSet.length > 0) {
        this.debug(`Auto-granting permissions: ${grantsToSet.join(', ')}`);
        await context.grantPermissions(grantsToSet);
      }

      // Note: Playwright doesn't have a direct way to listen to permission requests
      // We set defaults via grantPermissions/clearPermissions

    } catch (error: any) {
      this.error('Failed to setup permission handlers:', error.message);
    }
  }

  /**
   * Grant a specific permission
   */
  async grantPermission(permission: string): Promise<void> {
    try {
      const context = (this.browserController as any).context;
      if (!context) {
        this.warn('No browser context available');
        return;
      }

      await context.grantPermissions([permission]);
      this.info(`Granted permission: ${permission}`);

      // Emit event
      const event: PermissionRequestEvent = {
        type: 'permission_request',
        permission,
        granted: true,
        timestamp: Date.now(),
      };
      await this.emit(BrowserEventTypes.PERMISSION_REQUEST, event);
    } catch (error: any) {
      this.error(`Failed to grant permission ${permission}:`, error.message);
    }
  }

  /**
   * Deny a specific permission
   */
  async denyPermission(permission: string): Promise<void> {
    try {
      const context = (this.browserController as any).context;
      if (!context) {
        this.warn('No browser context available');
        return;
      }

      await context.clearPermissions();
      this.info(`Denied permission: ${permission}`);

      // Emit event
      const event: PermissionRequestEvent = {
        type: 'permission_request',
        permission,
        granted: false,
        timestamp: Date.now(),
      };
      await this.emit(BrowserEventTypes.PERMISSION_REQUEST, event);
    } catch (error: any) {
      this.error(`Failed to deny permission ${permission}:`, error.message);
    }
  }

  /**
   * Event handler for browser launch
   */
  async on_BrowserLaunchEvent(event: any): Promise<void> {
    if (!this.isEnabled()) return;
    this.debug('Browser launched, setting up permissions');
    await this.setupPermissionHandlers();
  }
}
