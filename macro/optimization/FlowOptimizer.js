// FlowOptimizer.js - AI-powered macro flow optimization

const OptimizationPrompts = require('./OptimizationPrompts');

class FlowOptimizer {
  constructor(llmService = null) {
    this.llmService = llmService;
  }

  /**
   * Get LLM service instance
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
   * Optimize a macro flow
   * @param {Object} macro - Macro object
   * @returns {Promise<Object>} Optimization result
   */
  async optimize(macro) {
    console.log('[FlowOptimizer] Optimizing macro:', macro.name);

    const originalSteps = [...macro.steps];
    let optimizedSteps = [...macro.steps];

    // Step 1: AI가 불필요한 단계 분석 (먼저 실행!)
    console.log('[FlowOptimizer] Step 1: AI analyzing unnecessary steps...');
    const aiAnalysis = await this.analyzeWithAI(macro, optimizedSteps);

    if (aiAnalysis && aiAnalysis.stepsToRemove && aiAnalysis.stepsToRemove.length > 0) {
      console.log('[FlowOptimizer] AI identified unnecessary steps:', aiAnalysis.stepsToRemove);
      optimizedSteps = this.removeStepsByNumbers(optimizedSteps, aiAnalysis.stepsToRemove);
    }

    // Step 2: Remove duplicate clicks
    console.log('[FlowOptimizer] Step 2: Removing duplicate clicks...');
    optimizedSteps = this.removeDuplicateClicks(optimizedSteps);

    // Step 3: Remove useless waits
    console.log('[FlowOptimizer] Step 3: Removing useless waits...');
    optimizedSteps = this.removeUselessWaits(optimizedSteps);

    // Step 4: Merge consecutive inputs
    console.log('[FlowOptimizer] Step 4: Merging consecutive inputs...');
    optimizedSteps = this.mergeConsecutiveInputs(optimizedSteps);

    // Step 5: Calculate what was removed (before renumbering!)
    const removedSteps = this.getRemovedSteps(originalSteps, optimizedSteps);

    // Step 6: Renumber steps
    optimizedSteps = this.renumberSteps(optimizedSteps);

    console.log('[FlowOptimizer] Optimization complete');
    console.log(`  Original: ${originalSteps.length} steps`);
    console.log(`  Optimized: ${optimizedSteps.length} steps`);
    console.log(`  Removed: ${removedSteps.length} steps`);

    return {
      optimizedSteps,
      removedSteps,
      aiSuggestions: aiAnalysis ? aiAnalysis.suggestions : [],
      aiRemovals: aiAnalysis ? aiAnalysis.stepsToRemove : [],
      savings: {
        stepsRemoved: removedSteps.length,
        percentageReduced: originalSteps.length > 0
          ? ((removedSteps.length / originalSteps.length) * 100).toFixed(1)
          : '0'
      }
    };
  }

  /**
   * Remove duplicate clicks on same element within short time
   */
  removeDuplicateClicks(steps) {
    const result = [];
    let lastClick = null;

    for (const step of steps) {
      if (step.type === 'click') {
        // Check if it's a duplicate click
        if (lastClick &&
            lastClick.target?.selector === step.target?.selector &&
            (step.timestamp - lastClick.timestamp) < 1000) {
          console.log('[FlowOptimizer] Removed duplicate click:', step.target?.selector);
          continue; // Skip this duplicate
        }
        lastClick = step;
      }

      result.push(step);
    }

    return result;
  }

  /**
   * Remove useless wait steps
   */
  removeUselessWaits(steps) {
    const result = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      if (step.type === 'wait') {
        // Remove wait if:
        // 1. It's short (< 2000ms) - most auto-added waits are unnecessary
        if (step.timeout < 2000) {
          console.log('[FlowOptimizer] Removed short wait:', step.timeout, 'ms');
          continue;
        }

        // 2. It's the last step
        if (i === steps.length - 1) {
          console.log('[FlowOptimizer] Removed final wait');
          continue;
        }

        // 3. It's a page-load wait immediately after navigation (MacroExecutor auto-waits)
        if (step.condition === 'page-load' && i > 0 && steps[i - 1].type === 'navigation') {
          console.log('[FlowOptimizer] Removed redundant page-load wait after navigation:', step.timeout, 'ms');
          continue;
        }

        // 4. Next step is also a wait (merge them)
        if (i < steps.length - 1 && steps[i + 1].type === 'wait') {
          console.log('[FlowOptimizer] Merged consecutive waits');
          steps[i + 1].timeout += step.timeout;
          continue;
        }
      }

      result.push(step);
    }

    return result;
  }

  /**
   * Merge consecutive input steps on same field
   */
  mergeConsecutiveInputs(steps) {
    const result = [];
    let lastInput = null;

    for (const step of steps) {
      if (step.type === 'input') {
        // Check if it's consecutive input on same field
        if (lastInput &&
            lastInput.target?.selector === step.target?.selector &&
            (step.timestamp - lastInput.timestamp) < 2000) {
          // Merge: update the last input's value
          console.log('[FlowOptimizer] Merged consecutive inputs:', lastInput.staticValue, '+', step.staticValue);
          lastInput.staticValue = (lastInput.staticValue || '') + step.staticValue;
          lastInput.timestamp = step.timestamp;
          continue;
        }

        lastInput = step;
      } else {
        lastInput = null;
      }

      result.push(step);
    }

    return result;
  }

  /**
   * AI가 불필요한 단계를 분석
   */
  async analyzeWithAI(macro, steps) {
    try {
      const llm = await this.getLLMService();

      // AI에게 불필요한 단계를 찾도록 요청
      const prompt = OptimizationPrompts.buildAnalysisPrompt(macro, steps);

      console.log('[FlowOptimizer] Asking AI to analyze workflow...');

      const response = await llm.chat([
        { role: 'system', content: 'You are an expert at analyzing web automation workflows. Identify redundant, unnecessary, or inefficient steps.' },
        { role: 'user', content: prompt }
      ]);

      console.log('[FlowOptimizer] AI response:', response);

      // AI 응답 파싱
      const analysis = OptimizationPrompts.parseAnalysisResponse(response);

      return {
        stepsToRemove: analysis.stepsToRemove || [],
        suggestions: analysis.suggestions || []
      };

    } catch (error) {
      console.error('[FlowOptimizer] AI analysis failed:', error.message);
      // AI 실패해도 계속 진행
      return null;
    }
  }

  /**
   * AI가 지정한 단계 번호들을 제거
   */
  removeStepsByNumbers(steps, stepNumbers) {
    const numbersToRemove = new Set(stepNumbers);
    const result = steps.filter(step => !numbersToRemove.has(step.stepNumber));

    console.log(`[FlowOptimizer] Removed ${stepNumbers.length} steps identified by AI`);
    return result;
  }

  /**
   * Get AI suggestions for optimization (deprecated - use analyzeWithAI instead)
   */
  async getAISuggestions(macro, optimizedSteps) {
    try {
      const llm = await this.getLLMService();
      const prompt = OptimizationPrompts.buildOptimizationPrompt(macro, optimizedSteps);

      const response = await llm.chat([
        { role: 'user', content: prompt }
      ]);

      const suggestions = OptimizationPrompts.parseOptimizationResponse(response);
      return suggestions;
    } catch (error) {
      console.error('[FlowOptimizer] Failed to get AI suggestions:', error);
      return [];
    }
  }

  /**
   * Renumber steps sequentially
   */
  renumberSteps(steps) {
    return steps.map((step, index) => ({
      ...step,
      stepNumber: index + 1
    }));
  }

  /**
   * Calculate which steps were removed
   */
  getRemovedSteps(original, optimized) {
    // Use timestamp as unique key (stepNumber changes during optimization)
    const optimizedTimestamps = new Set(
      optimized.map(s => s.timestamp)
    );

    // Find steps that are in original but not in optimized
    return original.filter(s => {
      return !optimizedTimestamps.has(s.timestamp);
    });
  }

  /**
   * Apply AI suggestions to steps
   */
  applySuggestions(steps, suggestions) {
    // TODO: Implement applying AI suggestions
    // This would modify steps based on AI recommendations
    return steps;
  }
}

module.exports = FlowOptimizer;
