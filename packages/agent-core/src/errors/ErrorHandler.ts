/**
 * ErrorHandler - Centralized error handling and recovery
 * Based on browser-use's error handling patterns
 */

import { BrowserError, PageCrashError, NavigationError, TimeoutError } from './BrowserError.js';

export interface ErrorHandlerOptions {
  maxRetries?: number;
  retryDelay?: number;
  onError?: (error: BrowserError) => void;
  onRecovery?: (error: BrowserError, attempt: number) => void;
}

export interface ActionResult {
  success: boolean;
  error?: string;
  longTermMemory?: string;
  shortTermMemory?: string;
  extracted_content?: string;
  include_extracted_content_only_once?: boolean;
}

export class ErrorHandler {
  private maxRetries: number;
  private retryDelay: number;
  private onError?: (error: BrowserError) => void;
  private onRecovery?: (error: BrowserError, attempt: number) => void;

  // Track error counts for rate limiting
  private errorCounts: Map<string, { count: number; lastReset: number }> = new Map();
  private readonly ERROR_WINDOW_MS = 60000; // 1 minute
  private readonly MAX_ERRORS_PER_WINDOW = 10;

  constructor(options: ErrorHandlerOptions = {}) {
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelay = options.retryDelay ?? 1000;
    this.onError = options.onError;
    this.onRecovery = options.onRecovery;
  }

  /**
   * Handle a browser error and convert to ActionResult
   */
  handleBrowserError(error: BrowserError): ActionResult {
    // Call error callback
    if (this.onError) {
      this.onError(error);
    }

    // Check if we have long_term_memory (for LLM)
    if (error.longTermMemory) {
      const result: ActionResult = {
        success: false,
        error: error.longTermMemory,
      };

      // Add short_term_memory if available
      if (error.shortTermMemory) {
        result.extracted_content = error.shortTermMemory;
        result.include_extracted_content_only_once = true;
      }

      return result;
    }

    // Fallback to basic error handling
    console.warn('[ErrorHandler] BrowserError raised without longTermMemory - this should be avoided');
    return {
      success: false,
      error: error.message,
    };
  }

  /**
   * Handle a standard Error
   */
  handleError(error: Error, context?: string): ActionResult {
    const browserError = BrowserError.fromError(
      error,
      context ? `Error in ${context}: ${error.message}` : error.message
    );
    return this.handleBrowserError(browserError);
  }

  /**
   * Execute an action with automatic retry on recoverable errors
   */
  async executeWithRetry<T>(
    action: () => Promise<T>,
    actionName: string,
    isRecoverable?: (error: Error) => boolean
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await action();
      } catch (error: any) {
        lastError = error;

        // Convert to BrowserError if needed
        const browserError =
          error instanceof BrowserError ? error : BrowserError.fromError(error);

        // Check if error is recoverable
        const recoverable =
          browserError.isRecoverable() || (isRecoverable && isRecoverable(error));

        if (!recoverable || attempt === this.maxRetries) {
          throw browserError;
        }

        // Log recovery attempt
        console.warn(
          `[ErrorHandler] Attempt ${attempt}/${this.maxRetries} failed for ${actionName}: ${error.message}`
        );

        // Call recovery callback
        if (this.onRecovery) {
          this.onRecovery(browserError, attempt);
        }

        // Wait before retry (exponential backoff)
        const delay = this.retryDelay * Math.pow(2, attempt - 1);
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * Check if error rate limit is exceeded
   */
  isErrorRateLimitExceeded(errorType: string): boolean {
    const now = Date.now();
    const errorData = this.errorCounts.get(errorType);

    if (!errorData) {
      this.errorCounts.set(errorType, { count: 1, lastReset: now });
      return false;
    }

    // Reset if window expired
    if (now - errorData.lastReset > this.ERROR_WINDOW_MS) {
      errorData.count = 1;
      errorData.lastReset = now;
      return false;
    }

    // Increment and check
    errorData.count++;
    return errorData.count > this.MAX_ERRORS_PER_WINDOW;
  }

  /**
   * Reset error count for a specific error type
   */
  resetErrorCount(errorType: string): void {
    this.errorCounts.delete(errorType);
  }

  /**
   * Parse error message to determine error type
   */
  parseErrorType(error: Error): string {
    const message = error.message.toLowerCase();

    if (message.includes('crash')) {
      return 'PAGE_CRASH';
    } else if (message.includes('timeout')) {
      return 'TIMEOUT';
    } else if (message.includes('navigation') || message.includes('navigate')) {
      return 'NAVIGATION_ERROR';
    } else if (message.includes('not found') || message.includes('element')) {
      return 'ELEMENT_NOT_FOUND';
    } else if (
      message.includes('connection') ||
      message.includes('network') ||
      message.includes('net::')
    ) {
      return 'NETWORK_ERROR';
    }

    return 'UNKNOWN_ERROR';
  }

  /**
   * Create appropriate BrowserError from standard Error
   */
  createBrowserError(error: Error): BrowserError {
    const errorType = this.parseErrorType(error);

    switch (errorType) {
      case 'PAGE_CRASH':
        return new PageCrashError(error.message);

      case 'TIMEOUT':
        return new TimeoutError('operation', 30000);

      case 'NAVIGATION_ERROR':
        return new NavigationError('unknown', error.message);

      default:
        return BrowserError.fromError(error);
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Global error handler instance
 */
export const globalErrorHandler = new ErrorHandler({
  maxRetries: 3,
  retryDelay: 1000,
  onError: (error) => {
    console.error('[GlobalErrorHandler]', error.getDetails());
  },
  onRecovery: (error, attempt) => {
    console.warn(`[GlobalErrorHandler] Recovering from error (attempt ${attempt}):`, error.message);
  },
});
