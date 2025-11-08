// EventSerializer.js - Serializes DOM events to JSON format with element info

const { EventType, createTargetInfo } = require('../types/MacroTypes');

class EventSerializer {
  /**
   * Serialize a DOM event to a JSON-compatible object
   * @param {Object} rawEvent - Raw event data from browser
   * @returns {Object} Serialized event
   */
  static serialize(rawEvent) {
    const event = {
      type: rawEvent.type,
      timestamp: rawEvent.timestamp || 0,
      target: null,
      data: {}
    };

    // Serialize target element info
    if (rawEvent.target) {
      event.target = this.serializeTarget(rawEvent.target);
    }

    // Add type-specific data
    switch (rawEvent.type) {
      case EventType.CLICK:
        event.data.coordinates = rawEvent.coordinates || { x: 0, y: 0 };
        event.data.button = rawEvent.button || 0;
        break;

      case EventType.INPUT:
        event.data.value = rawEvent.value || '';
        event.data.inputType = rawEvent.inputType || 'text';
        break;

      case EventType.KEYDOWN:
        event.data.key = rawEvent.key || '';
        event.data.keyCode = rawEvent.keyCode || 0;
        event.data.ctrlKey = rawEvent.ctrlKey || false;
        event.data.altKey = rawEvent.altKey || false;
        event.data.shiftKey = rawEvent.shiftKey || false;
        break;

      case EventType.NAVIGATION:
        event.data.url = rawEvent.url || '';
        event.data.title = rawEvent.title || '';
        break;

      case EventType.SCROLL:
        event.data.scrollX = rawEvent.scrollX || 0;
        event.data.scrollY = rawEvent.scrollY || 0;
        break;

      case EventType.SUBMIT:
        event.data.formAction = rawEvent.formAction || '';
        break;
    }

    return event;
  }

  /**
   * Serialize target element information
   * @param {Object} targetData - Target element data
   * @returns {Object} Serialized target info
   */
  static serializeTarget(targetData) {
    // Generate CSS selector
    const selector = this.generateSelector(targetData);

    // Generate XPath
    const xpath = this.generateXPath(targetData);

    // Generate human-readable description
    const description = this.generateDescription(targetData);

    return createTargetInfo(
      selector,
      xpath,
      targetData.tagName || '',
      description
    );
  }

  /**
   * Generate CSS selector for an element
   * @param {Object} targetData - Target element data
   * @returns {string} CSS selector
   */
  static generateSelector(targetData) {
    const parts = [];

    // Tag name
    const tagName = targetData.tagName ? targetData.tagName.toLowerCase() : '';
    if (tagName) {
      parts.push(tagName);
    }

    // ID (most specific)
    if (targetData.id) {
      return `#${targetData.id}`;
    }

    // Name attribute (for inputs)
    if (targetData.name) {
      parts.push(`[name="${targetData.name}"]`);
      return parts.join('');
    }

    // Class names - use multiple classes for better specificity
    if (targetData.className && typeof targetData.className === 'string') {
      const classes = targetData.className.trim().split(/\s+/).filter(c => c && !c.match(/^[0-9]/));
      if (classes.length > 0) {
        // Use up to 3 classes for better specificity
        const classesToUse = classes.slice(0, 3);
        classesToUse.forEach(className => {
          parts.push(`.${className}`);
        });
      }
    }

    // Placeholder for inputs
    if (targetData.placeholder) {
      parts.push(`[placeholder="${targetData.placeholder}"]`);
    }

    // Type for inputs
    if (targetData.type) {
      parts.push(`[type="${targetData.type}"]`);
    }

    // If no specific selector, use data-* attributes or fallback to tag
    if (parts.length === 0) {
      parts.push(tagName || '*');
    }

    return parts.join('');
  }

  /**
   * Generate XPath for an element
   * @param {Object} targetData - Target element data
   * @returns {string} XPath
   */
  static generateXPath(targetData) {
    // Simple XPath generation
    // In production, this should be generated in the browser context

    if (targetData.id) {
      return `//*[@id="${targetData.id}"]`;
    }

    if (targetData.name) {
      const tag = targetData.tagName ? targetData.tagName.toLowerCase() : '*';
      return `//${tag}[@name="${targetData.name}"]`;
    }

    // Fallback
    const tag = targetData.tagName ? targetData.tagName.toLowerCase() : '*';
    return `//${tag}`;
  }

  /**
   * Generate human-readable description for an element
   * @param {Object} targetData - Target element data
   * @returns {string} Description
   */
  static generateDescription(targetData) {
    // Try to create a meaningful description

    // For inputs with labels
    if (targetData.label) {
      return targetData.label;
    }

    // For inputs with placeholders
    if (targetData.placeholder) {
      return targetData.placeholder;
    }

    // For inputs with names
    if (targetData.name) {
      return this.humanize(targetData.name);
    }

    // For buttons with text
    if (targetData.text) {
      return targetData.text;
    }

    // For inputs with types
    if (targetData.type && targetData.tagName === 'INPUT') {
      return `${this.humanize(targetData.type)} field`;
    }

    // For links
    if (targetData.tagName === 'A') {
      return targetData.text || 'Link';
    }

    // For buttons
    if (targetData.tagName === 'BUTTON') {
      return targetData.text || 'Button';
    }

    // Fallback to tag name
    return targetData.tagName || 'Element';
  }

  /**
   * Convert camelCase or snake_case to human-readable text
   * @param {string} text - Text to humanize
   * @returns {string} Humanized text
   */
  static humanize(text) {
    return text
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase())
      .trim();
  }

  /**
   * Deserialize an event (reverse operation)
   * @param {Object} serializedEvent - Serialized event
   * @returns {Object} Event object
   */
  static deserialize(serializedEvent) {
    // Simple pass-through for now
    // Could add validation or transformation here
    return serializedEvent;
  }
}

module.exports = EventSerializer;
