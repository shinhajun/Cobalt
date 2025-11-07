// MacroToPrompt.js - Convert macro flow to AI-understandable prompt

class MacroToPrompt {
  /**
   * Convert macro to AI prompt
   * @param {Object} macro - Macro object
   * @returns {string} AI prompt
   */
  static convert(macro) {
    let prompt = `Execute this web automation workflow:\n\n`;

    prompt += `Goal: ${macro.name}\n`;
    if (macro.description) {
      prompt += `Description: ${macro.description}\n`;
    }
    prompt += `\n`;

    prompt += `Steps to perform:\n`;

    macro.steps.forEach((step, index) => {
      prompt += `${index + 1}. `;

      switch (step.type) {
        case 'navigation':
          prompt += `Navigate to ${step.url}\n`;
          break;

        case 'click':
          prompt += `Click on "${step.target?.description}"`;
          if (step.target?.selector) {
            prompt += ` (selector: ${step.target.selector})`;
          }
          prompt += `\n`;
          break;

        case 'input':
          if (step.inputMode === 'ai' && step.aiConfig?.prompt) {
            prompt += `Type text in "${step.target?.description}": ${step.aiConfig.prompt}`;
          } else {
            prompt += `Type "${step.staticValue}" in "${step.target?.description}"`;
          }
          if (step.target?.selector) {
            prompt += ` (selector: ${step.target.selector})`;
          }
          prompt += `\n`;
          break;

        case 'keypress':
          prompt += `Press ${step.key} key\n`;
          break;

        case 'wait':
          prompt += `Wait ${step.timeout}ms for ${step.condition}\n`;
          break;

        default:
          prompt += `${step.description}\n`;
      }
    });

    prompt += `\n`;
    prompt += `Use the browser automation tools to execute these steps.\n`;
    prompt += `If any selector doesn't work, try to find the element intelligently.\n`;
    prompt += `Report success or failure for each step.`;

    return prompt;
  }

  /**
   * Convert to detailed format with context
   * @param {Object} macro - Macro object
   * @param {Object} context - Additional context
   * @returns {string} Detailed prompt
   */
  static convertDetailed(macro, context = {}) {
    let prompt = this.convert(macro);

    if (context.currentUrl) {
      prompt += `\n\nCurrent URL: ${context.currentUrl}`;
    }

    if (context.previousValues) {
      prompt += `\n\nPrevious values used:\n`;
      for (const [field, value] of Object.entries(context.previousValues)) {
        prompt += `- ${field}: ${value}\n`;
      }
    }

    return prompt;
  }

  /**
   * Convert to structured format for function calling
   * @param {Object} macro - Macro object
   * @returns {Array} Array of function calls
   */
  static convertToFunctionCalls(macro) {
    const calls = [];

    for (const step of macro.steps) {
      const call = {
        stepNumber: step.stepNumber,
        timestamp: step.timestamp
      };

      switch (step.type) {
        case 'navigation':
          call.function = 'navigate';
          call.parameters = { url: step.url };
          break;

        case 'click':
          call.function = 'click';
          call.parameters = {
            selector: step.target?.selector,
            description: step.target?.description
          };
          break;

        case 'input':
          call.function = 'type';
          call.parameters = {
            selector: step.target?.selector,
            text: step.staticValue,
            description: step.target?.description
          };
          break;

        case 'keypress':
          call.function = 'press';
          call.parameters = { key: step.key };
          break;

        case 'wait':
          call.function = 'wait';
          call.parameters = {
            timeout: step.timeout,
            condition: step.condition
          };
          break;

        default:
          call.function = 'unknown';
          call.parameters = {};
      }

      calls.push(call);
    }

    return calls;
  }

  /**
   * Generate summary of macro for AI
   * @param {Object} macro - Macro object
   * @returns {string} Summary
   */
  static summarize(macro) {
    const stepCounts = {};
    for (const step of macro.steps) {
      stepCounts[step.type] = (stepCounts[step.type] || 0) + 1;
    }

    let summary = `Macro: ${macro.name}\n`;
    summary += `Total steps: ${macro.steps.length}\n`;
    summary += `Breakdown:\n`;

    for (const [type, count] of Object.entries(stepCounts)) {
      summary += `- ${type}: ${count}\n`;
    }

    // Extract URLs
    const navSteps = macro.steps.filter(s => s.type === 'navigation');
    if (navSteps.length > 0) {
      summary += `\nURLs visited:\n`;
      navSteps.forEach(s => {
        summary += `- ${s.url}\n`;
      });
    }

    return summary;
  }
}

module.exports = MacroToPrompt;
