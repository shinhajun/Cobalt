// MacroTypes.js - Common type definitions and interfaces for the macro system

/**
 * Macro recording states
 */
const RecordingState = {
  IDLE: 'idle',
  RECORDING: 'recording',
  PAUSED: 'paused',
  SAVING: 'saving'
};

/**
 * Step types in a macro
 */
const StepType = {
  NAVIGATION: 'navigation',
  CLICK: 'click',
  INPUT: 'input',
  KEYPRESS: 'keypress',
  SCROLL: 'scroll',
  WAIT: 'wait',
  SUBMIT: 'submit',
  CONDITIONAL: 'conditional',
  LOOP_START: 'loop_start',
  LOOP_END: 'loop_end'
};

/**
 * Input modes for input steps
 */
const InputMode = {
  STATIC: 'static',      // Fixed value
  PROMPT: 'prompt',      // Ask user when running
  AI: 'ai'               // AI generated
};

/**
 * Condition types for conditional execution
 */
const ConditionType = {
  ELEMENT_EXISTS: 'element_exists',           // Check if element exists
  ELEMENT_NOT_EXISTS: 'element_not_exists',   // Check if element doesn't exist
  TEXT_CONTAINS: 'text_contains',             // Check if page contains text
  TEXT_NOT_CONTAINS: 'text_not_contains',     // Check if page doesn't contain text
  URL_MATCHES: 'url_matches',                 // Check if URL matches pattern
  URL_NOT_MATCHES: 'url_not_matches',         // Check if URL doesn't match pattern
  CUSTOM: 'custom'                            // Custom JavaScript condition
};

/**
 * Loop types for repetition
 */
const LoopType = {
  FIXED_COUNT: 'fixed_count',                 // Loop N times
  WHILE_CONDITION: 'while_condition',         // Loop while condition is true
  FOR_EACH_ELEMENT: 'for_each_element',       // Loop for each matching element
  UNTIL_CONDITION: 'until_condition'          // Loop until condition is true
};

/**
 * Event type definitions for recording
 */
const EventType = {
  CLICK: 'click',
  INPUT: 'input',
  KEYDOWN: 'keydown',
  SUBMIT: 'submit',
  NAVIGATION: 'navigation',
  SCROLL: 'scroll'
};

/**
 * Create a new macro object
 * @param {string} name - Macro name
 * @returns {Object} Macro object
 */
function createMacro(name = 'Untitled Macro') {
  return {
    id: `macro_${Date.now()}`,
    name: name,
    description: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    version: '1.0',
    steps: [],
    metadata: {
      totalSteps: 0,
      duration: 0,
      startUrl: '',
      endUrl: '',
      browserVersion: 'Cobalt 1.0'
    }
  };
}

/**
 * Create a navigation step
 * @param {number} stepNumber - Step number
 * @param {number} timestamp - Timestamp in ms
 * @param {string} url - URL to navigate to
 * @returns {Object} Navigation step
 */
function createNavigationStep(stepNumber, timestamp, url) {
  return {
    type: StepType.NAVIGATION,
    stepNumber: stepNumber,
    timestamp: timestamp,
    url: url,
    description: `Navigate to ${new URL(url).hostname}`
  };
}

/**
 * Create a click step
 * @param {number} stepNumber - Step number
 * @param {number} timestamp - Timestamp in ms
 * @param {Object} target - Target element info
 * @param {Object} coordinates - Click coordinates {x, y}
 * @returns {Object} Click step
 */
function createClickStep(stepNumber, timestamp, target, coordinates) {
  return {
    type: StepType.CLICK,
    stepNumber: stepNumber,
    timestamp: timestamp,
    target: target,
    coordinates: coordinates,
    description: `Click on ${target.description || 'element'}`
  };
}

/**
 * Create an input step
 * @param {number} stepNumber - Step number
 * @param {number} timestamp - Timestamp in ms
 * @param {Object} target - Target element info
 * @param {string} value - Input value
 * @returns {Object} Input step
 */
function createInputStep(stepNumber, timestamp, target, value) {
  return {
    type: StepType.INPUT,
    stepNumber: stepNumber,
    timestamp: timestamp,
    target: target,
    inputMode: InputMode.STATIC,
    staticValue: value,
    promptConfig: {
      enabled: false,
      question: '',
      defaultValue: value,
      placeholder: ''
    },
    aiConfig: {
      enabled: false,
      prompt: '',
      model: 'gpt-4o-mini',
      temperature: 0.7,
      examples: []
    },
    description: `Type "${value}"`,
    editable: true
  };
}

/**
 * Create a keypress step
 * @param {number} stepNumber - Step number
 * @param {number} timestamp - Timestamp in ms
 * @param {string} key - Key name
 * @param {number} keyCode - Key code
 * @returns {Object} Keypress step
 */
function createKeypressStep(stepNumber, timestamp, key, keyCode) {
  return {
    type: StepType.KEYPRESS,
    stepNumber: stepNumber,
    timestamp: timestamp,
    key: key,
    keyCode: keyCode,
    description: `Press ${key}`
  };
}

/**
 * Create a wait step
 * @param {number} stepNumber - Step number
 * @param {number} timestamp - Timestamp in ms
 * @param {string} condition - Wait condition
 * @param {number} timeout - Timeout in ms
 * @returns {Object} Wait step
 */
function createWaitStep(stepNumber, timestamp, condition = 'page-load', timeout = 5000) {
  return {
    type: StepType.WAIT,
    stepNumber: stepNumber,
    timestamp: timestamp,
    condition: condition,
    timeout: timeout,
    description: `Wait for ${condition}`
  };
}

/**
 * Create a conditional step
 * @param {number} stepNumber - Step number
 * @param {number} timestamp - Timestamp in ms
 * @param {string} conditionType - Type of condition (from ConditionType)
 * @param {Object} conditionConfig - Condition configuration
 * @param {number[]} trueSteps - Step numbers to execute if true
 * @param {number[]} falseSteps - Step numbers to execute if false (optional)
 * @returns {Object} Conditional step
 */
function createConditionalStep(stepNumber, timestamp, conditionType, conditionConfig, trueSteps, falseSteps = []) {
  return {
    type: StepType.CONDITIONAL,
    stepNumber: stepNumber,
    timestamp: timestamp,
    conditionType: conditionType,
    conditionConfig: conditionConfig,
    trueSteps: trueSteps,
    falseSteps: falseSteps,
    description: `If ${conditionType}: ${conditionConfig.description || ''}`
  };
}

/**
 * Create a loop start step
 * @param {number} stepNumber - Step number
 * @param {number} timestamp - Timestamp in ms
 * @param {string} loopType - Type of loop (from LoopType)
 * @param {Object} loopConfig - Loop configuration
 * @returns {Object} Loop start step
 */
function createLoopStartStep(stepNumber, timestamp, loopType, loopConfig) {
  return {
    type: StepType.LOOP_START,
    stepNumber: stepNumber,
    timestamp: timestamp,
    loopType: loopType,
    loopConfig: loopConfig,
    loopId: `loop_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    description: `Loop start (${loopType}): ${loopConfig.description || ''}`
  };
}

/**
 * Create a loop end step
 * @param {number} stepNumber - Step number
 * @param {number} timestamp - Timestamp in ms
 * @param {string} loopId - ID of the corresponding loop start
 * @returns {Object} Loop end step
 */
function createLoopEndStep(stepNumber, timestamp, loopId) {
  return {
    type: StepType.LOOP_END,
    stepNumber: stepNumber,
    timestamp: timestamp,
    loopId: loopId,
    description: 'Loop end'
  };
}

/**
 * Create target element info
 * @param {string} selector - CSS selector
 * @param {string} xpath - XPath
 * @param {string} tagName - Tag name
 * @param {string} description - Human-readable description
 * @returns {Object} Target info
 */
function createTargetInfo(selector, xpath, tagName, description) {
  return {
    selector: selector,
    xpath: xpath,
    tagName: tagName,
    description: description,
    id: '',
    className: ''
  };
}

/**
 * Validate macro structure
 * @param {Object} macro - Macro object
 * @returns {boolean} True if valid
 */
function validateMacro(macro) {
  if (!macro || typeof macro !== 'object') return false;
  if (!macro.id || !macro.name) return false;
  if (!Array.isArray(macro.steps)) return false;

  // Validate steps
  for (const step of macro.steps) {
    if (!step.type || !Object.values(StepType).includes(step.type)) {
      return false;
    }
    if (typeof step.stepNumber !== 'number') return false;
    if (typeof step.timestamp !== 'number') return false;
  }

  return true;
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    RecordingState,
    StepType,
    InputMode,
    EventType,
    ConditionType,
    LoopType,
    createMacro,
    createNavigationStep,
    createClickStep,
    createInputStep,
    createKeypressStep,
    createWaitStep,
    createConditionalStep,
    createLoopStartStep,
    createLoopEndStep,
    createTargetInfo,
    validateMacro
  };
}
