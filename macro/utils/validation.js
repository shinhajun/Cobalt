/**
 * Validation utilities for macros
 */

/**
 * Validate macro name
 * @param {string} name - Macro name to validate
 * @returns {string|null} Error message or null if valid
 */
function validateMacroName(name) {
  // Check if name exists
  if (!name || typeof name !== 'string') {
    return 'Name is required';
  }

  const trimmedName = name.trim();

  // Check empty
  if (trimmedName.length === 0) {
    return 'Name cannot be empty';
  }

  // Check minimum length
  if (trimmedName.length < 3) {
    return 'Name must be at least 3 characters';
  }

  // Check maximum length
  if (trimmedName.length > 100) {
    return 'Name must be less than 100 characters';
  }

  // Check for invalid filename characters
  // Include control characters (\x00-\x1f) for server-side compatibility
  const invalidChars = /[<>:"/\\|?*\x00-\x1f]/g;
  if (invalidChars.test(trimmedName)) {
    return 'Name cannot contain: < > : " / \\ | ? * or control characters';
  }

  // Check for reserved names (Windows)
  const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5',
                         'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4',
                         'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'];
  const upperName = trimmedName.toUpperCase();
  if (reservedNames.includes(upperName) || reservedNames.some(r => upperName.startsWith(r + '.'))) {
    return 'Name cannot be a reserved system name';
  }

  return null; // Valid
}

/**
 * Sanitize macro name for safe file system usage
 * @param {string} name - Macro name to sanitize
 * @returns {string} Sanitized name
 */
function sanitizeMacroName(name) {
  if (!name || typeof name !== 'string') {
    return 'untitled';
  }

  return name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') // Replace invalid chars with underscore
    .substring(0, 100); // Limit length
}

// Export for both Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    validateMacroName,
    sanitizeMacroName
  };
} else if (typeof window !== 'undefined') {
  window.MacroValidation = {
    validateMacroName,
    sanitizeMacroName
  };
}
