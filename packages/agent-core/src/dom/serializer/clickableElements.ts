/**
 * Clickable Element Detector
 * Based on browser-use's clickable_elements.py
 * Detects interactive/clickable elements using enhanced scoring
 */

import { EnhancedDOMTreeNode, NodeType } from '../views';

export class ClickableElementDetector {
  /**
   * Check if a node is clickable/interactive using enhanced scoring
   */
  static isInteractive(node: EnhancedDOMTreeNode): boolean {
    // Skip non-element nodes
    if (node.nodeType !== NodeType.ELEMENT_NODE) {
      return false;
    }

    // Remove html and body nodes
    if (node.tagName === 'html' || node.tagName === 'body') {
      return false;
    }

    // IFRAME elements should be interactive if they're large enough
    // Small iframes (< 100px width or height) are unlikely to have scrollable content
    if (node.tagName === 'iframe' || node.tagName === 'frame') {
      if (node.snapshotNode && node.snapshotNode.bounds) {
        const width = node.snapshotNode.bounds.width;
        const height = node.snapshotNode.bounds.height;
        // Only include iframes larger than 100x100px
        if (width > 100 && height > 100) {
          return true;
        }
      }
    }

    // SEARCH ELEMENT DETECTION
    if (node.attributes) {
      const searchIndicators = [
        'search',
        'magnify',
        'glass',
        'lookup',
        'find',
        'query',
        'search-icon',
        'search-btn',
        'search-button',
        'searchbox',
      ];

      // Check class names
      const classList = (node.attributes.class || '').toLowerCase().split(/\s+/);
      if (searchIndicators.some(indicator => classList.some(cls => cls.includes(indicator)))) {
        return true;
      }

      // Check id
      const elementId = (node.attributes.id || '').toLowerCase();
      if (searchIndicators.some(indicator => elementId.includes(indicator))) {
        return true;
      }

      // Check data attributes
      for (const [attrName, attrValue] of Object.entries(node.attributes)) {
        if (attrName.startsWith('data-') && searchIndicators.some(indicator => attrValue.toLowerCase().includes(indicator))) {
          return true;
        }
      }
    }

    // Enhanced accessibility property checks
    if (node.axNode && node.axNode.properties) {
      for (const prop of node.axNode.properties) {
        try {
          // aria disabled
          if (prop.name === 'disabled' && prop.value) {
            return false;
          }

          // aria hidden
          if (prop.name === 'hidden' && prop.value) {
            return false;
          }

          // Direct interactiveness indicators
          if (['focusable', 'editable', 'settable'].includes(prop.name) && prop.value) {
            return true;
          }

          // Interactive state properties (presence indicates interactive widget)
          if (['checked', 'expanded', 'pressed', 'selected'].includes(prop.name)) {
            return true;
          }

          // Form-related interactiveness
          if (['required', 'autocomplete'].includes(prop.name) && prop.value) {
            return true;
          }

          // Elements with keyboard shortcuts are interactive
          if (prop.name === 'keyshortcuts' && prop.value) {
            return true;
          }
        } catch (error) {
          // Skip properties we can't process
          continue;
        }
      }
    }

    // ENHANCED TAG CHECK: Include truly interactive elements
    const interactiveTags = new Set([
      'button',
      'input',
      'select',
      'textarea',
      'a',
      'details',
      'summary',
      'option',
      'optgroup',
    ]);

    if (interactiveTags.has(node.tagName)) {
      return true;
    }

    // Tertiary check: elements with interactive attributes
    if (node.attributes) {
      // Check for event handlers or interactive attributes
      const interactiveAttributes = ['onclick', 'onmousedown', 'onmouseup', 'onkeydown', 'onkeyup', 'tabindex'];
      if (interactiveAttributes.some(attr => attr in node.attributes)) {
        return true;
      }

      // Check for interactive ARIA roles
      if (node.attributes.role) {
        const interactiveRoles = new Set([
          'button',
          'link',
          'menuitem',
          'option',
          'radio',
          'checkbox',
          'tab',
          'textbox',
          'combobox',
          'slider',
          'spinbutton',
          'search',
          'searchbox',
        ]);

        if (interactiveRoles.has(node.attributes.role)) {
          return true;
        }
      }
    }

    // Quaternary check: accessibility tree roles
    if (node.axNode && node.axNode.role) {
      const interactiveAxRoles = new Set([
        'button',
        'link',
        'menuitem',
        'option',
        'radio',
        'checkbox',
        'tab',
        'textbox',
        'combobox',
        'slider',
        'spinbutton',
        'listbox',
        'search',
        'searchbox',
      ]);

      if (interactiveAxRoles.has(node.axNode.role)) {
        return true;
      }
    }

    // ICON AND SMALL ELEMENT CHECK
    if (node.snapshotNode && node.snapshotNode.bounds) {
      const width = node.snapshotNode.bounds.width;
      const height = node.snapshotNode.bounds.height;

      // Icon-sized elements (10-50px)
      if (width >= 10 && width <= 50 && height >= 10 && height <= 50) {
        if (node.attributes) {
          // Small elements with these attributes are likely interactive icons
          const iconAttributes = ['class', 'role', 'onclick', 'data-action', 'aria-label'];
          if (iconAttributes.some(attr => attr in node.attributes)) {
            return true;
          }
        }
      }
    }

    // Final fallback: cursor style indicates interactivity
    if (node.snapshotNode && node.snapshotNode.cursorStyle === 'pointer') {
      return true;
    }

    return false;
  }
}
