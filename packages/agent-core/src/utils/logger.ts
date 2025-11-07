/**
 * Simple logger utility with DEBUG toggle
 *
 * Usage:
 *   import { debug, info, warn, error } from './utils/logger.js';
 *
 *   debug('This only shows when DEBUG=true');
 *   info('This always shows');
 *   warn('Warning message');
 *   error('Error message');
 *
 * Environment variables:
 *   DEBUG=true           - Enable debug logging
 *   LOG_LEVEL=debug      - Alternative way to enable debug logging
 */

// Check if DEBUG mode is enabled
const isDebugEnabled = (): boolean => {
  return (
    process.env.DEBUG === 'true' ||
    process.env.LOG_LEVEL === 'debug' ||
    process.env.NODE_ENV === 'development'
  );
};

const DEBUG = isDebugEnabled();

/**
 * Debug logging (only when DEBUG=true)
 */
export const debug = (...args: any[]): void => {
  if (DEBUG) {
    console.log('[DEBUG]', ...args);
  }
};

/**
 * Info logging (always shown)
 */
export const info = (...args: any[]): void => {
  console.log('[INFO]', ...args);
};

/**
 * Warning logging (always shown)
 */
export const warn = (...args: any[]): void => {
  console.warn('[WARN]', ...args);
};

/**
 * Error logging (always shown)
 */
export const error = (...args: any[]): void => {
  console.error('[ERROR]', ...args);
};

/**
 * Check if debug mode is enabled
 */
export const isDebug = (): boolean => DEBUG;
