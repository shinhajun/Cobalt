// AIVariationEngine.js - Generates dynamic values using AI

const AIPromptBuilder = require('../analysis/AIPromptBuilder');

class AIVariationEngine {
  constructor(llmService = null) {
    this.llmService = llmService;
  }

  /**
   * Initialize LLM service
   * @returns {Promise<Object>} LLM service instance
   */
  async getLLMService() {
    if (this.llmService) {
      return this.llmService;
    }

    // Fallback to default if not provided
    const { LLMService } = require('../../packages/agent-core/dist/llmService');
    this.llmService = new LLMService('gpt-5-mini');

    return this.llmService;
  }

  /**
   * Generate a value for an input step using AI
   * @param {Object} step - Input step with AI config
   * @param {Object} previousValues - Previously entered values (context)
   * @returns {Promise<string>} Generated value
   */
  async generateValue(step, previousValues = {}) {
    console.log('[AIVariationEngine] Generating value for step:', step.stepNumber);

    if (!step.aiConfig || !step.aiConfig.prompt) {
      throw new Error('AI config or prompt is missing');
    }

    try {
      // Build context
      const context = AIPromptBuilder.buildContext({ steps: [] }, { inputValues: previousValues });

      // Build prompt
      const prompt = AIPromptBuilder.buildInputPrompt(step, context);
      console.log('[AIVariationEngine] Prompt:', prompt);

      // Get LLM service
      const llm = await this.getLLMService();

      // Generate response
      const response = await llm.chat([
        { role: 'user', content: prompt }
      ]);

      console.log('[AIVariationEngine] AI response:', response);

      // Parse response
      const value = AIPromptBuilder.parseInputResponse(response);

      console.log('[AIVariationEngine] Generated value:', value);
      return value;
    } catch (error) {
      console.error('[AIVariationEngine] Failed to generate value:', error);

      // Fallback to default value if available
      if (step.staticValue) {
        console.log('[AIVariationEngine] Using fallback static value:', step.staticValue);
        return step.staticValue;
      }

      throw new Error('Failed to generate AI value: ' + error.message);
    }
  }

  /**
   * Generate variations of a macro
   * @param {Object} macro - Original macro
   * @param {string} variationRequest - User's variation request
   * @returns {Promise<Object>} Modified macro with variations
   */
  async generateVariations(macro, variationRequest) {
    console.log('[AIVariationEngine] Generating variations for macro:', macro.name);
    console.log('[AIVariationEngine] Request:', variationRequest);

    try {
      // Build prompt
      const prompt = AIPromptBuilder.buildVariationPrompt(macro, variationRequest);

      // Get LLM service
      const llm = await this.getLLMService();

      // Generate response
      const response = await llm.chat([
        { role: 'user', content: prompt }
      ]);

      console.log('[AIVariationEngine] AI response:', response);

      // Parse variations
      const variations = AIPromptBuilder.parseVariationResponse(response);

      // Apply variations to macro
      const variedMacro = this.applyVariations(macro, variations);

      return variedMacro;
    } catch (error) {
      console.error('[AIVariationEngine] Failed to generate variations:', error);
      throw error;
    }
  }

  /**
   * Apply variations to a macro
   * @param {Object} macro - Original macro
   * @param {Object} variations - Variations map (stepNumber -> new value)
   * @returns {Object} Modified macro
   */
  applyVariations(macro, variations) {
    // Clone macro
    const variedMacro = JSON.parse(JSON.stringify(macro));

    // Apply variations to input steps
    for (const [stepNum, newValue] of Object.entries(variations)) {
      const stepIndex = variedMacro.steps.findIndex(s => s.stepNumber === parseInt(stepNum));

      if (stepIndex >= 0) {
        const step = variedMacro.steps[stepIndex];

        if (step.type === 'input') {
          step.staticValue = newValue;
          console.log(`[AIVariationEngine] Updated step ${stepNum} with value:`, newValue);
        }
      }
    }

    // Update macro metadata
    variedMacro.id = `macro_${Date.now()}`;
    variedMacro.name = `${macro.name} (Variation)`;
    variedMacro.createdAt = Date.now();
    variedMacro.updatedAt = Date.now();

    return variedMacro;
  }

  /**
   * Generate explanation for a macro
   * @param {Object} macro - Macro object
   * @returns {Promise<string>} Explanation text
   */
  async explainMacro(macro) {
    console.log('[AIVariationEngine] Generating explanation for macro:', macro.name);

    try {
      // Build prompt
      const prompt = AIPromptBuilder.buildExplanationPrompt(macro);

      // Get LLM service
      const llm = await this.getLLMService();

      // Generate response
      const explanation = await llm.chat([
        { role: 'user', content: prompt }
      ]);

      console.log('[AIVariationEngine] Explanation generated');
      return explanation;
    } catch (error) {
      console.error('[AIVariationEngine] Failed to generate explanation:', error);
      throw error;
    }
  }

  /**
   * Generate a name for a macro based on its steps
   * @param {Array} steps - Macro steps
   * @returns {Promise<string>} Suggested name
   */
  async suggestName(steps) {
    console.log('[AIVariationEngine] Suggesting name for macro');

    try {
      // Build prompt
      const prompt = AIPromptBuilder.buildNamingPrompt(steps);

      // Get LLM service
      const llm = await this.getLLMService();

      // Generate response
      const name = await llm.chat([
        { role: 'user', content: prompt }
      ]);

      console.log('[AIVariationEngine] Suggested name:', name);
      return name.trim();
    } catch (error) {
      console.error('[AIVariationEngine] Failed to suggest name:', error);
      return 'Untitled Macro';
    }
  }

  /**
   * Suggest improvements for a macro
   * @param {Object} macro - Macro object
   * @returns {Promise<Array>} Array of improvement suggestions
   */
  async suggestImprovements(macro) {
    console.log('[AIVariationEngine] Suggesting improvements for macro:', macro.name);

    try {
      // Build prompt
      const prompt = AIPromptBuilder.buildImprovementPrompt(macro);

      // Get LLM service
      const llm = await this.getLLMService();

      // Generate response
      const response = await llm.chat([
        { role: 'user', content: prompt }
      ]);

      // Parse suggestions (simple line-by-line)
      const suggestions = response
        .split('\n')
        .filter(line => line.trim().length > 0)
        .map(line => line.trim());

      console.log('[AIVariationEngine] Generated', suggestions.length, 'suggestions');
      return suggestions;
    } catch (error) {
      console.error('[AIVariationEngine] Failed to suggest improvements:', error);
      return [];
    }
  }

  /**
   * Batch generate values for multiple input steps
   * @param {Array} steps - Input steps with AI config
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Map of stepNumber -> generated value
   */
  async batchGenerateValues(steps, context = {}) {
    console.log('[AIVariationEngine] Batch generating values for', steps.length, 'steps');

    const values = {};

    for (const step of steps) {
      try {
        const value = await this.generateValue(step, context.previousValues || {});
        values[step.stepNumber] = value;

        // Add to context for subsequent generations
        if (!context.previousValues) {
          context.previousValues = {};
        }
        const fieldName = step.target?.description || `Step ${step.stepNumber}`;
        context.previousValues[fieldName] = value;
      } catch (error) {
        console.error('[AIVariationEngine] Failed to generate value for step', step.stepNumber, error);
        // Use fallback if available
        if (step.staticValue) {
          values[step.stepNumber] = step.staticValue;
        }
      }
    }

    return values;
  }
}

module.exports = AIVariationEngine;
