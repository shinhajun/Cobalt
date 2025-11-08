// ActionAnalyzer.js - Analyzes recorded events and groups them into meaningful steps

const { StepType, EventType, createNavigationStep, createClickStep, createInputStep, createKeypressStep, createWaitStep } = require('../types/MacroTypes');

class ActionAnalyzer {
  constructor() {
    this.mergeThreshold = 500; // ms - events within this time are considered part of same action
  }

  /**
   * Analyze recorded events and convert to steps
   * @param {Array} events - Raw recorded events
   * @returns {Array} Analyzed steps
   */
  analyze(events) {
    console.log('[ActionAnalyzer] Analyzing', events.length, 'events');

    if (!events || events.length === 0) {
      return [];
    }

    const steps = [];
    let stepNumber = 1;

    // Group and merge similar events
    const mergedEvents = this.mergeEvents(events);
    console.log('[ActionAnalyzer] Merged into', mergedEvents.length, 'events');

    // Convert events to steps
    for (const event of mergedEvents) {
      const step = this.eventToStep(event, stepNumber);
      if (step) {
        steps.push(step);
        stepNumber++;
      }
    }

    // Add wait steps between actions if needed
    const stepsWithWaits = this.addWaitSteps(steps);

    console.log('[ActionAnalyzer] Generated', stepsWithWaits.length, 'steps');
    return stepsWithWaits;
  }

  /**
   * Merge similar consecutive events
   * @param {Array} events - Raw events
   * @returns {Array} Merged events
   */
  mergeEvents(events) {
    const merged = [];
    let currentInputEvent = null;

    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      // Merge consecutive input events on the same field
      if (event.type === EventType.INPUT) {
        if (currentInputEvent &&
            currentInputEvent.target?.selector === event.target?.selector &&
            (event.timestamp - currentInputEvent.timestamp) < this.mergeThreshold) {
          // Update the value
          currentInputEvent.data.value = event.data.value;
          currentInputEvent.timestamp = event.timestamp;
        } else {
          // New input event
          if (currentInputEvent) {
            merged.push(currentInputEvent);
          }
          currentInputEvent = { ...event };
        }
      } else {
        // Push any pending input event
        if (currentInputEvent) {
          merged.push(currentInputEvent);
          currentInputEvent = null;
        }

        // Filter out duplicate events
        if (!this.isDuplicate(merged[merged.length - 1], event)) {
          merged.push(event);
        }
      }
    }

    // Push any remaining input event
    if (currentInputEvent) {
      merged.push(currentInputEvent);
    }

    return merged;
  }

  /**
   * Check if two events are duplicates
   * @param {Object} prev - Previous event
   * @param {Object} current - Current event
   * @returns {boolean} True if duplicate
   */
  isDuplicate(prev, current) {
    if (!prev || !current) return false;

    // Different types are never duplicates
    if (prev.type !== current.type) return false;

    // Different targets are never duplicates
    if (prev.target?.selector !== current.target?.selector) return false;

    const timeDiff = current.timestamp - prev.timestamp;

    // For click events, check coordinates and timing
    if (prev.type === EventType.CLICK) {
      // Less than 100ms with same/similar coordinates = accidental duplicate
      if (timeDiff < 100) {
        const prevCoords = prev.data?.coordinates || prev.coordinates;
        const currCoords = current.data?.coordinates || current.coordinates;

        if (prevCoords && currCoords) {
          const dx = Math.abs(prevCoords.x - currCoords.x);
          const dy = Math.abs(prevCoords.y - currCoords.y);

          // Within 5 pixels = duplicate
          if (dx <= 5 && dy <= 5) {
            return true;
          }
        } else {
          // No coordinate info, assume duplicate if same target
          return true;
        }
      }

      // 100-500ms with similar coordinates = potential double-click (NOT a duplicate)
      // We want to preserve double-clicks as they might be intentional
      if (timeDiff >= 100 && timeDiff <= 500) {
        return false; // Keep both clicks
      }
    }

    // For other event types, use original simple logic
    if (timeDiff < 100) {
      return true;
    }

    return false;
  }

  /**
   * Convert an event to a step
   * @param {Object} event - Event object
   * @param {number} stepNumber - Step number
   * @returns {Object|null} Step object or null
   */
  eventToStep(event, stepNumber) {
    switch (event.type) {
      case EventType.NAVIGATION:
        return createNavigationStep(
          stepNumber,
          event.timestamp,
          event.data.url || event.url
        );

      case EventType.CLICK:
        return createClickStep(
          stepNumber,
          event.timestamp,
          event.target,
          event.data.coordinates || event.coordinates
        );

      case EventType.INPUT:
        return createInputStep(
          stepNumber,
          event.timestamp,
          event.target,
          event.data.value || ''
        );

      case EventType.KEYDOWN:
        // Only include important keys
        if (this.isImportantKey(event.data.key || event.key)) {
          return createKeypressStep(
            stepNumber,
            event.timestamp,
            event.data.key || event.key,
            event.data.keyCode || event.keyCode
          );
        }
        return null;

      case EventType.SCROLL:
        // Skip scroll events for now - can be added later
        return null;

      case EventType.SUBMIT:
        // Convert to keypress Enter or click depending on context
        return createKeypressStep(
          stepNumber,
          event.timestamp,
          'Enter',
          13
        );

      default:
        console.warn('[ActionAnalyzer] Unknown event type:', event.type);
        return null;
    }
  }

  /**
   * Check if a key is important enough to record
   * @param {string} key - Key name
   * @returns {boolean} True if important
   */
  isImportantKey(key) {
    const importantKeys = [
      'Enter', 'Tab', 'Escape',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'Backspace', 'Delete'
    ];
    return importantKeys.includes(key);
  }

  /**
   * Add wait steps between actions if there are significant delays
   * @param {Array} steps - Steps array
   * @returns {Array} Steps with wait steps added
   */
  addWaitSteps(steps) {
    const result = [];
    const waitThreshold = 2000; // Add wait step if gap > 2 seconds

    for (let i = 0; i < steps.length; i++) {
      result.push(steps[i]);

      // Check gap to next step
      if (i < steps.length - 1) {
        const currentStep = steps[i];
        const nextStep = steps[i + 1];
        const gap = nextStep.timestamp - currentStep.timestamp;

        // If gap is significant and next step is navigation or click, add wait
        if (gap > waitThreshold) {
          const waitStep = createWaitStep(
            result.length + 1,
            currentStep.timestamp + 100,
            'page-load',
            Math.min(gap, 5000) // Cap at 5 seconds
          );
          result.push(waitStep);
        }
      }
    }

    // Renumber steps
    result.forEach((step, index) => {
      step.stepNumber = index + 1;
    });

    return result;
  }

  /**
   * Detect patterns in steps (loops, conditionals, etc.)
   * Future enhancement
   * @param {Array} steps - Steps array
   * @returns {Object} Detected patterns
   */
  detectPatterns(steps) {
    // TODO: Implement pattern detection
    // - Repeated sequences (loops)
    // - Conditional branches
    // - Common workflows
    return {};
  }
}

module.exports = ActionAnalyzer;
