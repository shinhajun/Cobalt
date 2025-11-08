/**
 * BaseWatchdog - Base class for all browser watchdogs
 * Based on browser-use's BaseWatchdog
 *
 * Watchdogs monitor browser state and automatically handle specific events.
 * They follow the convention: on_EventTypeName(event: EventType)
 */

import { EventBus, EventHandler } from '../events/EventBus.js';
import { BrowserController } from '../browserController.js';

export interface WatchdogConfig {
  enabled?: boolean;
  debug?: boolean;
}

export abstract class BaseWatchdog {
  protected eventBus: EventBus;
  protected browserController: BrowserController;
  protected config: Required<WatchdogConfig>;
  protected logger: Console;

  // List of event types this watchdog listens to (for documentation)
  static readonly LISTENS_TO: string[] = [];
  // List of event types this watchdog emits (for documentation)
  static readonly EMITS: string[] = [];

  constructor(
    eventBus: EventBus,
    browserController: BrowserController,
    config: WatchdogConfig = {}
  ) {
    this.eventBus = eventBus;
    this.browserController = browserController;
    this.config = {
      enabled: config.enabled ?? true,
      debug: config.debug ?? false,
    };
    this.logger = console;

    if (this.config.enabled) {
      this.registerHandlers();
    }
  }

  /**
   * Register all event handlers automatically
   * Looks for methods named on_EventTypeName and registers them
   */
  private registerHandlers(): void {
    const proto = Object.getPrototypeOf(this);
    const methodNames = Object.getOwnPropertyNames(proto);

    for (const methodName of methodNames) {
      // Check if method follows naming convention: on_EventName
      if (methodName.startsWith('on_') && typeof (this as any)[methodName] === 'function') {
        const eventType = this.methodNameToEventType(methodName);
        const handler = (this as any)[methodName].bind(this);

        if (this.config.debug) {
          this.logger.log(
            `[${this.constructor.name}] Registering handler for event: ${eventType}`
          );
        }

        this.eventBus.on(eventType, handler as EventHandler);
      }
    }
  }

  /**
   * Convert method name to event type
   * Example: on_BrowserCrashEvent -> browser_crash
   */
  private methodNameToEventType(methodName: string): string {
    // Remove 'on_' prefix
    const withoutPrefix = methodName.substring(3);

    // Convert PascalCase to snake_case
    const snakeCase = withoutPrefix
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .substring(1);

    // Remove Event suffix if present
    return snakeCase.replace(/_event$/, '');
  }

  /**
   * Log debug message if debug mode is enabled
   */
  protected debug(...args: any[]): void {
    if (this.config.debug) {
      this.logger.log(`[${this.constructor.name}]`, ...args);
    }
  }

  /**
   * Log info message
   */
  protected info(...args: any[]): void {
    this.logger.log(`[${this.constructor.name}]`, ...args);
  }

  /**
   * Log warning message
   */
  protected warn(...args: any[]): void {
    this.logger.warn(`[${this.constructor.name}]`, ...args);
  }

  /**
   * Log error message
   */
  protected error(...args: any[]): void {
    this.logger.error(`[${this.constructor.name}]`, ...args);
  }

  /**
   * Emit an event through the event bus
   */
  protected async emit<T>(eventType: string, data: T): Promise<void> {
    await this.eventBus.emit(eventType, data);
  }

  /**
   * Wait for an event
   */
  protected async waitFor<T>(eventType: string, timeout?: number): Promise<T> {
    return this.eventBus.waitFor<T>(eventType, timeout);
  }

  /**
   * Enable this watchdog
   */
  enable(): void {
    if (!this.config.enabled) {
      this.config.enabled = true;
      this.registerHandlers();
      this.info('Enabled');
    }
  }

  /**
   * Disable this watchdog
   */
  disable(): void {
    if (this.config.enabled) {
      this.config.enabled = false;
      // Note: We don't unregister handlers to avoid complexity
      // Instead, handlers should check this.config.enabled
      this.info('Disabled');
    }
  }

  /**
   * Check if watchdog is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Lifecycle method called when watchdog is initialized
   * Override in subclasses for custom initialization
   */
  async onInitialize(): Promise<void> {
    // Override in subclasses
  }

  /**
   * Lifecycle method called when watchdog is destroyed
   * Override in subclasses for custom cleanup
   */
  async onDestroy(): Promise<void> {
    // Override in subclasses
  }

  /**
   * Get watchdog name
   */
  getName(): string {
    return this.constructor.name;
  }

  /**
   * Get watchdog status
   */
  getStatus(): {
    name: string;
    enabled: boolean;
    listensTo: string[];
    emits: string[];
  } {
    return {
      name: this.getName(),
      enabled: this.isEnabled(),
      listensTo: (this.constructor as typeof BaseWatchdog).LISTENS_TO,
      emits: (this.constructor as typeof BaseWatchdog).EMITS,
    };
  }
}
