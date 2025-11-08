/**
 * Utility functions for DOM processing
 * Based on browser-use's utils.py
 */

import { EnhancedDOMTreeNode } from './views';

/**
 * Cap text length for display
 */
export function capTextLength(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength) + '...';
}

/**
 * Generate a CSS selector using node properties
 * Based on browser-use's version 0.5.0 approach
 */
export function generateCssSelectorForElement(enhancedNode: EnhancedDOMTreeNode | null): string | null {
  if (!enhancedNode || !enhancedNode.tagName) {
    return null;
  }

  // Get base selector from tag name
  const tagName = enhancedNode.tagName.toLowerCase().trim();
  if (!tagName || !/^[a-zA-Z][a-zA-Z0-9-]*$/.test(tagName)) {
    return null;
  }

  let cssSelector = tagName;

  // Add ID if available (most specific)
  if (enhancedNode.attributes && enhancedNode.attributes.id) {
    const elementId = enhancedNode.attributes.id.trim();
    if (elementId) {
      // Validate ID contains only valid characters for # selector
      if (/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(elementId)) {
        return `#${elementId}`;
      } else {
        // For IDs with special characters, use attribute selector
        const escapedId = elementId.replace(/"/g, '\\"');
        return `${tagName}[id="${escapedId}"]`;
      }
    }
  }

  // Handle class attributes
  if (enhancedNode.attributes && enhancedNode.attributes.class) {
    const validClassNamePattern = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
    const classes = enhancedNode.attributes.class.split(/\s+/);

    for (const className of classes) {
      if (!className.trim()) continue;

      if (validClassNamePattern.test(className)) {
        cssSelector += `.${className}`;
      }
    }
  }

  // Expanded set of safe attributes
  const SAFE_ATTRIBUTES = new Set([
    'id',
    'name',
    'type',
    'placeholder',
    'aria-label',
    'aria-labelledby',
    'aria-describedby',
    'role',
    'for',
    'autocomplete',
    'required',
    'readonly',
    'alt',
    'title',
    'src',
    'href',
    'target',
    'data-id',
    'data-qa',
    'data-cy',
    'data-testid',
  ]);

  // Handle other attributes
  if (enhancedNode.attributes) {
    for (const [attribute, value] of Object.entries(enhancedNode.attributes)) {
      if (attribute === 'class' || !attribute.trim()) continue;
      if (!SAFE_ATTRIBUTES.has(attribute)) continue;

      // Escape special characters in attribute names
      const safeAttribute = attribute.replace(/:/g, '\\:');

      // Handle different value cases
      if (value === '') {
        cssSelector += `[${safeAttribute}]`;
      } else if (/["'<>`\n\r\t]/.test(value)) {
        // Use contains for values with special characters
        let processedValue = value;
        if (value.includes('\n')) {
          processedValue = value.split('\n')[0];
        }
        // Collapse whitespace
        const collapsedValue = processedValue.replace(/\s+/g, ' ').trim();
        const safeValue = collapsedValue.replace(/"/g, '\\"');
        cssSelector += `[${safeAttribute}*="${safeValue}"]`;
      } else {
        cssSelector += `[${safeAttribute}="${value}"]`;
      }
    }
  }

  // Final validation
  if (cssSelector && !/[\n\r\t]/.test(cssSelector)) {
    return cssSelector;
  }

  return tagName;
}

/**
 * Check if two rectangles intersect
 */
export function rectIntersects(r1: { x: number; y: number; width: number; height: number }, r2: { x: number; y: number; width: number; height: number }): boolean {
  return !(
    r1.x + r1.width < r2.x ||
    r2.x + r2.width < r1.x ||
    r1.y + r1.height < r2.y ||
    r2.y + r2.height < r1.y
  );
}

/**
 * Calculate intersection area of two rectangles
 */
export function rectIntersectionArea(r1: { x: number; y: number; width: number; height: number }, r2: { x: number; y: number; width: number; height: number }): number {
  const xOverlap = Math.max(0, Math.min(r1.x + r1.width, r2.x + r2.width) - Math.max(r1.x, r2.x));
  const yOverlap = Math.max(0, Math.min(r1.y + r1.height, r2.y + r2.height) - Math.max(r1.y, r2.y));
  return xOverlap * yOverlap;
}

/**
 * Calculate area of a rectangle
 */
export function rectArea(r: { x: number; y: number; width: number; height: number }): number {
  return r.width * r.height;
}

/**
 * Check if r1 is contained within r2 by a certain threshold
 */
export function rectContainedWithin(r1: { x: number; y: number; width: number; height: number }, r2: { x: number; y: number; width: number; height: number }, threshold: number = 0.99): boolean {
  const r1Area = rectArea(r1);
  if (r1Area === 0) return false;

  const intersectionArea = rectIntersectionArea(r1, r2);
  const containment = intersectionArea / r1Area;

  return containment >= threshold;
}

/**
 * Parse float safely with default value
 */
export function safeParseFloat(value: string | number | null | undefined, defaultValue: number): number {
  if (value === null || value === undefined) return defaultValue;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return isNaN(num) ? defaultValue : num;
}

/**
 * Parse float safely, returning null for invalid values
 */
export function safeParseOptionalFloat(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return isNaN(num) ? null : num;
}
