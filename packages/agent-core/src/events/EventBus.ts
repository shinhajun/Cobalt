/**
 * EventBus - Simple event bus implementation for browser-use style events
 * TypeScript port of Python's bubus EventBus
 */

export type EventHandler<T = any> = (event: T) => void | Promise<void>;

interface EventSubscription {
  handler: EventHandler;
  once: boolean;
}

export class EventBus {
  private listeners: Map<string, EventSubscription[]> = new Map();
  private wildcardListeners: EventSubscription[] = [];

  /**
   * Subscribe to an event
   * @param eventType - Event type to listen for (use '*' for all events)
   * @param handler - Event handler function
   * @returns Unsubscribe function
   */
  on<T = any>(eventType: string, handler: EventHandler<T>): () => void {
    if (eventType === '*') {
      this.wildcardListeners.push({ handler, once: false });
      return () => {
        const index = this.wildcardListeners.findIndex((sub) => sub.handler === handler);
        if (index !== -1) {
          this.wildcardListeners.splice(index, 1);
        }
      };
    }

    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }

    const subscriptions = this.listeners.get(eventType)!;
    subscriptions.push({ handler, once: false });

    return () => {
      const index = subscriptions.findIndex((sub) => sub.handler === handler);
      if (index !== -1) {
        subscriptions.splice(index, 1);
      }
    };
  }

  /**
   * Subscribe to an event once
   * @param eventType - Event type to listen for
   * @param handler - Event handler function
   * @returns Unsubscribe function
   */
  once<T = any>(eventType: string, handler: EventHandler<T>): () => void {
    if (eventType === '*') {
      this.wildcardListeners.push({ handler, once: true });
      return () => {
        const index = this.wildcardListeners.findIndex((sub) => sub.handler === handler);
        if (index !== -1) {
          this.wildcardListeners.splice(index, 1);
        }
      };
    }

    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }

    const subscriptions = this.listeners.get(eventType)!;
    subscriptions.push({ handler, once: true });

    return () => {
      const index = subscriptions.findIndex((sub) => sub.handler === handler);
      if (index !== -1) {
        subscriptions.splice(index, 1);
      }
    };
  }

  /**
   * Unsubscribe from an event
   * @param eventType - Event type to unsubscribe from
   * @param handler - Event handler to remove (optional, removes all if not provided)
   */
  off(eventType: string, handler?: EventHandler): void {
    if (eventType === '*') {
      if (handler) {
        const index = this.wildcardListeners.findIndex((sub) => sub.handler === handler);
        if (index !== -1) {
          this.wildcardListeners.splice(index, 1);
        }
      } else {
        this.wildcardListeners = [];
      }
      return;
    }

    if (!this.listeners.has(eventType)) {
      return;
    }

    if (handler) {
      const subscriptions = this.listeners.get(eventType)!;
      const index = subscriptions.findIndex((sub) => sub.handler === handler);
      if (index !== -1) {
        subscriptions.splice(index, 1);
      }
    } else {
      this.listeners.delete(eventType);
    }
  }

  /**
   * Emit an event
   * @param eventType - Event type to emit
   * @param event - Event data
   */
  async emit<T = any>(eventType: string, event: T): Promise<void> {
    // Call wildcard listeners first
    for (let i = this.wildcardListeners.length - 1; i >= 0; i--) {
      const subscription = this.wildcardListeners[i];
      try {
        await subscription.handler(event);
      } catch (error) {
        console.error(`[EventBus] Error in wildcard listener for ${eventType}:`, error);
      }

      if (subscription.once) {
        this.wildcardListeners.splice(i, 1);
      }
    }

    // Call specific event listeners
    const subscriptions = this.listeners.get(eventType);
    if (!subscriptions) {
      return;
    }

    for (let i = subscriptions.length - 1; i >= 0; i--) {
      const subscription = subscriptions[i];
      try {
        await subscription.handler(event);
      } catch (error) {
        console.error(`[EventBus] Error in listener for ${eventType}:`, error);
      }

      if (subscription.once) {
        subscriptions.splice(i, 1);
      }
    }
  }

  /**
   * Emit an event synchronously (for compatibility)
   * @param eventType - Event type to emit
   * @param event - Event data
   */
  emitSync<T = any>(eventType: string, event: T): void {
    // Call wildcard listeners first
    for (let i = this.wildcardListeners.length - 1; i >= 0; i--) {
      const subscription = this.wildcardListeners[i];
      try {
        subscription.handler(event);
      } catch (error) {
        console.error(`[EventBus] Error in wildcard listener for ${eventType}:`, error);
      }

      if (subscription.once) {
        this.wildcardListeners.splice(i, 1);
      }
    }

    // Call specific event listeners
    const subscriptions = this.listeners.get(eventType);
    if (!subscriptions) {
      return;
    }

    for (let i = subscriptions.length - 1; i >= 0; i--) {
      const subscription = subscriptions[i];
      try {
        subscription.handler(event);
      } catch (error) {
        console.error(`[EventBus] Error in listener for ${eventType}:`, error);
      }

      if (subscription.once) {
        subscriptions.splice(i, 1);
      }
    }
  }

  /**
   * Wait for an event to be emitted
   * @param eventType - Event type to wait for
   * @param timeout - Optional timeout in milliseconds
   * @returns Promise that resolves with the event data
   */
  waitFor<T = any>(eventType: string, timeout?: number): Promise<T> {
    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout | null = null;

      const unsubscribe = this.once(eventType, (event: T) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        resolve(event);
      });

      if (timeout) {
        timeoutId = setTimeout(() => {
          unsubscribe();
          reject(new Error(`Timeout waiting for event: ${eventType}`));
        }, timeout);
      }
    });
  }

  /**
   * Remove all listeners
   */
  removeAllListeners(): void {
    this.listeners.clear();
    this.wildcardListeners = [];
  }

  /**
   * Get the number of listeners for an event
   * @param eventType - Event type to count listeners for
   * @returns Number of listeners
   */
  listenerCount(eventType: string): number {
    if (eventType === '*') {
      return this.wildcardListeners.length;
    }
    return this.listeners.get(eventType)?.length || 0;
  }
}
