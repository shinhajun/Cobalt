/**
 * BrowserError - Custom error class for browser-related errors
 * Based on browser-use's BrowserError with long_term_memory/short_term_memory
 */

export interface BrowserErrorOptions {
  message: string;
  longTermMemory?: string;
  shortTermMemory?: string;
  code?: string;
  recoverable?: boolean;
  cause?: Error;
}

export class BrowserError extends Error {
  public readonly longTermMemory?: string;
  public readonly shortTermMemory?: string;
  public readonly code?: string;
  public readonly recoverable: boolean;
  public readonly cause?: Error;

  constructor(options: BrowserErrorOptions | string) {
    if (typeof options === 'string') {
      super(options);
      this.longTermMemory = options;
      this.recoverable = false;
    } else {
      super(options.message);
      this.longTermMemory = options.longTermMemory || options.message;
      this.shortTermMemory = options.shortTermMemory;
      this.code = options.code;
      this.recoverable = options.recoverable ?? false;
      this.cause = options.cause;
    }

    this.name = 'BrowserError';
    Object.setPrototypeOf(this, BrowserError.prototype);
  }

  /**
   * Get error message for LLM (long term memory)
   */
  getLLMMessage(): string {
    return this.longTermMemory || this.message;
  }

  /**
   * Get short term context for debugging
   */
  getShortTermContext(): string | undefined {
    return this.shortTermMemory;
  }

  /**
   * Check if error is recoverable
   */
  isRecoverable(): boolean {
    return this.recoverable;
  }

  /**
   * Get full error details
   */
  getDetails(): {
    message: string;
    longTermMemory?: string;
    shortTermMemory?: string;
    code?: string;
    recoverable: boolean;
    stack?: string;
  } {
    return {
      message: this.message,
      longTermMemory: this.longTermMemory,
      shortTermMemory: this.shortTermMemory,
      code: this.code,
      recoverable: this.recoverable,
      stack: this.stack,
    };
  }

  /**
   * Create a browser error from a standard Error
   */
  static fromError(error: Error, longTermMemory?: string): BrowserError {
    return new BrowserError({
      message: error.message,
      longTermMemory: longTermMemory || error.message,
      cause: error,
      recoverable: false,
    });
  }

  /**
   * Create a recoverable browser error
   */
  static recoverable(message: string, shortTermMemory?: string): BrowserError {
    return new BrowserError({
      message,
      longTermMemory: message,
      shortTermMemory,
      recoverable: true,
    });
  }

  /**
   * Create a fatal browser error (non-recoverable)
   */
  static fatal(message: string, code?: string): BrowserError {
    return new BrowserError({
      message,
      longTermMemory: message,
      code,
      recoverable: false,
    });
  }
}

/**
 * Specific error types
 */

export class PageCrashError extends BrowserError {
  constructor(message: string = 'Page crashed') {
    super({
      message,
      longTermMemory: 'The browser page has crashed. This has been automatically recovered.',
      shortTermMemory: message,
      code: 'PAGE_CRASH',
      recoverable: true,
    });
    this.name = 'PageCrashError';
  }
}

export class NavigationError extends BrowserError {
  constructor(url: string, reason: string) {
    super({
      message: `Failed to navigate to ${url}: ${reason}`,
      longTermMemory: `Navigation failed: ${reason}`,
      shortTermMemory: `URL: ${url}, Reason: ${reason}`,
      code: 'NAVIGATION_ERROR',
      recoverable: true,
    });
    this.name = 'NavigationError';
  }
}

export class ElementNotFoundError extends BrowserError {
  constructor(index: number) {
    super({
      message: `Element at index ${index} not found`,
      longTermMemory: `The element you tried to interact with is no longer available on the page. The page might have changed.`,
      shortTermMemory: `Element index: ${index}`,
      code: 'ELEMENT_NOT_FOUND',
      recoverable: true,
    });
    this.name = 'ElementNotFoundError';
  }
}

export class TimeoutError extends BrowserError {
  constructor(operation: string, timeout: number) {
    super({
      message: `Operation "${operation}" timed out after ${timeout}ms`,
      longTermMemory: `The operation timed out. The page might be loading slowly or stuck.`,
      shortTermMemory: `Operation: ${operation}, Timeout: ${timeout}ms`,
      code: 'TIMEOUT',
      recoverable: true,
    });
    this.name = 'TimeoutError';
  }
}
