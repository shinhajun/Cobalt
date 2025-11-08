/**
 * EventBus - Simple event bus implementation for browser-use style events
 * TypeScript port of Python's bubus EventBus
 */

import { v4 as uuidv4 } from 'uuid';

export type EventHandler<T = any> = (event: T) => void | Promise<void>;

interface EventSubscription {
  handler: EventHandler;
  once: boolean;
}

export interface EnrichedEvent<T = any> {
  eventId: string;
  eventType: string;
  eventParentId?: string;
  eventCreatedAt: Date;
  data: T;
}

export class EventBus {
  private listeners: Map<string, EventSubscription[]> = new Map();
  private wildcardListeners: EventSubscription[] = [];

  // Event history for debugging and watchdog access
  public eventHistory: Map<string, EnrichedEvent> = new Map();
  private maxHistorySize: number = 100;

  // Track current event being processed (for parent/child relationships)
  private currentEventId?: string;

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
    // Generate event ID and enrich event
    const eventId = this.generateEventId();
    const enrichedEvent: EnrichedEvent<T> = {
      eventId,
      eventType,
      eventParentId: this.currentEventId,
      eventCreatedAt: new Date(),
      data: event,
    };

    // Add to history
    this.addToHistory(enrichedEvent);

    // Set as current event for child events
    const previousEventId = this.currentEventId;
    this.currentEventId = eventId;

    try {
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
    } finally {
      // Restore previous event ID
      this.currentEventId = previousEventId;
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

  /**
   * Generate a unique event ID
   */
  private generateEventId(): string {
    return uuidv4();
  }

  /**
   * Add event to history with size limit
   */
  private addToHistory(event: EnrichedEvent): void {
    this.eventHistory.set(event.eventId, event);

    // Limit history size (remove oldest)
    if (this.eventHistory.size > this.maxHistorySize) {
      const oldestKey = this.eventHistory.keys().next().value;
      if (oldestKey) {
        this.eventHistory.delete(oldestKey);
      }
    }
  }

  /**
   * Get recent events (most recent first)
   */
  getRecentEvents(limit: number = 10): EnrichedEvent[] {
    const events = Array.from(this.eventHistory.values());
    return events
      .sort((a, b) => b.eventCreatedAt.getTime() - a.eventCreatedAt.getTime())
      .slice(0, limit);
  }

  /**
   * Get events by type
   */
  getEventsByType(eventType: string, limit?: number): EnrichedEvent[] {
    const events = Array.from(this.eventHistory.values()).filter(
      (e) => e.eventType === eventType
    );
    const sorted = events.sort(
      (a, b) => b.eventCreatedAt.getTime() - a.eventCreatedAt.getTime()
    );
    return limit ? sorted.slice(0, limit) : sorted;
  }

  /**
   * Clear event history
   */
  clearHistory(): void {
    this.eventHistory.clear();
  }

  /**
   * Set maximum history size
   */
  setMaxHistorySize(size: number): void {
    this.maxHistorySize = size;
  }
}
