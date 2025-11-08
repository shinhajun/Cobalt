// AIPromptBuilder.js - Builds AI prompts for macro steps

class AIPromptBuilder {
  /**
   * Build an AI prompt for generating input value
   * @param {Object} step - Input step
   * @param {Object} context - Execution context
   * @returns {string} AI prompt
   */
  static buildInputPrompt(step, context = {}) {
    if (!step.aiConfig || !step.aiConfig.prompt) {
      throw new Error('AI config or prompt is missing');
    }

    const userPrompt = step.aiConfig.prompt;
    const fieldDescription = step.target?.description || 'input field';

    let prompt = `You are helping automate a web browser task. `;
    prompt += `The user needs a value for the following input field: "${fieldDescription}".\n\n`;
    prompt += `User's request: ${userPrompt}\n\n`;

    // Add examples if provided
    if (step.aiConfig.examples && step.aiConfig.examples.length > 0) {
      prompt += `Examples of good values:\n`;
      step.aiConfig.examples.forEach((example, index) => {
        prompt += `${index + 1}. ${example}\n`;
      });
      prompt += `\n`;
    }

    // Add context
    if (context.previousValues) {
      prompt += `Previous values used in this macro:\n`;
      for (const [field, value] of Object.entries(context.previousValues)) {
        prompt += `- ${field}: ${value}\n`;
      }
      prompt += `\n`;
    }

    prompt += `Please generate a single appropriate value for this field. `;
    prompt += `Return ONLY the value, without any explanation or quotes.`;

    return prompt;
  }

  /**
   * Build a prompt for generating variations of a macro
   * @param {Object} macro - Macro object
   * @param {string} variationRequest - User's variation request
   * @returns {string} AI prompt
   */
  static buildVariationPrompt(macro, variationRequest) {
    let prompt = `You are helping create a variation of a web automation macro.\n\n`;
    prompt += `Original macro: "${macro.name}"\n`;
    prompt += `Description: ${macro.description || 'N/A'}\n\n`;

    prompt += `Original steps:\n`;
    macro.steps.forEach((step, index) => {
      prompt += `${index + 1}. ${step.description}\n`;
    });
    prompt += `\n`;

    prompt += `User's variation request: ${variationRequest}\n\n`;

    prompt += `Please suggest modifications to the input values to achieve the requested variation. `;
    prompt += `Return a JSON object with step numbers as keys and new values as values.\n`;
    prompt += `Example: {"3": "new search term", "5": "different option"}`;

    return prompt;
  }

  /**
   * Build a prompt for explaining a macro
   * @param {Object} macro - Macro object
   * @returns {string} AI prompt
   */
  static buildExplanationPrompt(macro) {
    let prompt = `Explain what this web automation macro does in simple terms:\n\n`;

    prompt += `Macro: "${macro.name}"\n\n`;
    prompt += `Steps:\n`;

    macro.steps.forEach((step, index) => {
      prompt += `${index + 1}. ${step.description}\n`;

      // Add details for input steps
      if (step.type === 'input' && step.staticValue) {
        prompt += `   Value: "${step.staticValue}"\n`;
      }
    });

    prompt += `\nPlease provide a concise explanation (2-3 sentences) of what this macro accomplishes.`;

    return prompt;
  }

  /**
   * Build a prompt for naming a macro based on its actions
   * @param {Array} steps - Macro steps
   * @returns {string} AI prompt
   */
  static buildNamingPrompt(steps) {
    let prompt = `Suggest a short, descriptive name for this web automation macro:\n\n`;

    prompt += `Actions:\n`;
    steps.forEach((step, index) => {
      prompt += `${index + 1}. ${step.description}\n`;
    });

    prompt += `\nProvide a concise name (2-5 words) that describes what this macro does. `;
    prompt += `Return ONLY the name, without quotes or explanation.`;

    return prompt;
  }

  /**
   * Build a prompt for suggesting improvements to a macro
   * @param {Object} macro - Macro object
   * @returns {string} AI prompt
   */
  static buildImprovementPrompt(macro) {
    let prompt = `Analyze this web automation macro and suggest improvements:\n\n`;

    prompt += `Macro: "${macro.name}"\n\n`;
    prompt += `Steps:\n`;

    macro.steps.forEach((step, index) => {
      prompt += `${index + 1}. ${step.type}: ${step.description}\n`;
    });

    prompt += `\nSuggest:\n`;
    prompt += `1. Missing error handling or wait steps\n`;
    prompt += `2. Values that should be made dynamic (user input or AI-generated)\n`;
    prompt += `3. Potential robustness improvements\n\n`;

    prompt += `Format your response as a numbered list.`;

    return prompt;
  }

  /**
   * Parse AI response for input value
   * @param {string} response - AI response
   * @returns {string} Parsed value
   */
  static parseInputResponse(response) {
    // Remove quotes if present
    let value = response.trim();

    // Remove common quote patterns
    value = value.replace(/^["']|["']$/g, '');

    // Remove explanation text (take first line only)
    const lines = value.split('\n');
    value = lines[0].trim();

    return value;
  }

  /**
   * Parse AI response for variation suggestions
   * @param {string} response - AI response
   * @returns {Object} Parsed variations
   */
  static parseVariationResponse(response) {
    try {
      // Try to parse as JSON
      const parsed = JSON.parse(response);
      return parsed;
    } catch (error) {
      console.warn('[AIPromptBuilder] Failed to parse variation response as JSON');

      // Fallback: try to extract key-value pairs
      const variations = {};
      const lines = response.split('\n');

      for (const line of lines) {
        // Match patterns like "3: new value" or "Step 3: new value"
        const match = line.match(/(?:step\s*)?(\d+)\s*[:=]\s*(.+)/i);
        if (match) {
          const stepNum = match[1];
          const value = match[2].trim().replace(/^["']|["']$/g, '');
          variations[stepNum] = value;
        }
      }

      return variations;
    }
  }

  /**
   * Build context from previous macro execution
   * @param {Object} macro - Macro object
   * @param {Object} previousRun - Previous execution data
   * @returns {Object} Context object
   */
  static buildContext(macro, previousRun = null) {
    const context = {
      macroName: macro.name,
      stepCount: macro.steps.length,
      previousValues: {}
    };

    // Extract previous input values
    if (previousRun && previousRun.inputValues) {
      context.previousValues = previousRun.inputValues;
    } else {
      // Use static values from macro
      macro.steps
        .filter(step => step.type === 'input' && step.staticValue)
        .forEach(step => {
          const fieldName = step.target?.description || `Step ${step.stepNumber}`;
          context.previousValues[fieldName] = step.staticValue;
        });
    }

    return context;
  }
}

module.exports = AIPromptBuilder;
