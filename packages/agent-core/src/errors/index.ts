/**
 * Error handling module exports
 */

export {
  BrowserError,
  BrowserErrorOptions,
  PageCrashError,
  NavigationError,
  ElementNotFoundError,
  TimeoutError,
} from './BrowserError.js';

export {
  ErrorHandler,
  ErrorHandlerOptions,
  ActionResult,
  globalErrorHandler,
} from './ErrorHandler.js';
