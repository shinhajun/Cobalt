// OptimizationPrompts.js - AI prompts for macro optimization

class OptimizationPrompts {
  /**
   * Build prompt for macro optimization
   */
  static buildOptimizationPrompt(macro, optimizedSteps) {
    let prompt = `Analyze this web automation macro and suggest additional optimizations:\n\n`;

    prompt += `Macro: "${macro.name}"\n`;
    prompt += `Total Steps: ${optimizedSteps.length}\n\n`;

    prompt += `Steps:\n`;
    optimizedSteps.forEach((step, i) => {
      let stepDesc = `${i + 1}. [${step.type}] `;

      switch (step.type) {
        case 'navigation':
          stepDesc += `Navigate to ${step.url}`;
          break;
        case 'click':
          stepDesc += `Click on "${step.target?.description}"`;
          break;
        case 'input':
          stepDesc += `Type "${step.staticValue}" in "${step.target?.description}"`;
          break;
        case 'keypress':
          stepDesc += `Press ${step.key}`;
          break;
        case 'wait':
          stepDesc += `Wait ${step.timeout}ms for ${step.condition}`;
          break;
        default:
          stepDesc += step.description;
      }

      prompt += stepDesc + '\n';
    });

    prompt += `\nPlease identify:\n`;
    prompt += `1. Redundant or duplicate steps that can be removed\n`;
    prompt += `2. Steps that can be merged or combined\n`;
    prompt += `3. Opportunities to add error handling or validation\n`;
    prompt += `4. Input steps that could benefit from AI generation\n`;
    prompt += `5. Overall workflow improvements\n\n`;

    prompt += `Return your analysis as a JSON object:\n`;
    prompt += `{\n`;
    prompt += `  "redundantSteps": [step numbers],\n`;
    prompt += `  "mergeSuggestions": [{from: [steps], to: "new description"}],\n`;
    prompt += `  "aiCandidates": [step numbers that should use AI],\n`;
    prompt += `  "recommendations": ["text descriptions of improvements"]\n`;
    prompt += `}\n`;

    return prompt;
  }

  /**
   * Parse AI optimization response
   */
  static parseOptimizationResponse(response) {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.recommendations || [];
      }

      // Fallback: treat each line as a suggestion
      return response
        .split('\n')
        .filter(line => line.trim().length > 0)
        .map(line => line.trim());

    } catch (error) {
      console.warn('[OptimizationPrompts] Failed to parse response:', error);
      return [];
    }
  }

  /**
   * Build prompt for detecting unnecessary steps
   */
  static buildDetectionPrompt(steps) {
    let prompt = `Analyze these automation steps and identify any that are unnecessary:\n\n`;

    steps.forEach((step, i) => {
      prompt += `${i + 1}. ${step.type}: ${step.description}\n`;
    });

    prompt += `\nWhich step numbers are redundant, duplicate, or unnecessary?\n`;
    prompt += `Return only the step numbers as a comma-separated list (e.g., "3,7,12")`;

    return prompt;
  }

  /**
   * Build prompt for AI to analyze and identify unnecessary steps
   * This is the main analysis function used by FlowOptimizer
   */
  static buildAnalysisPrompt(macro, steps) {
    let prompt = `You are an expert at analyzing web automation workflows. Please analyze the following macro and identify which steps are redundant, unnecessary, or inefficient.\n\n`;

    prompt += `Macro Name: "${macro.name}"\n`;
    prompt += `Total Steps: ${steps.length}\n\n`;

    prompt += `Workflow Steps:\n`;
    steps.forEach((step) => {
      let stepDesc = `${step.stepNumber}. [${step.type}] `;

      switch (step.type) {
        case 'navigation':
          stepDesc += `Navigate to ${step.url}`;
          break;
        case 'click':
          stepDesc += `Click on "${step.target?.description || step.target?.selector}"`;
          if (step.target?.selector) {
            stepDesc += ` (${step.target.selector})`;
          }
          break;
        case 'input':
          stepDesc += `Type "${step.staticValue}" into "${step.target?.description || step.target?.selector}"`;
          break;
        case 'keypress':
          stepDesc += `Press key "${step.key}"`;
          break;
        case 'wait':
          stepDesc += `Wait ${step.timeout}ms`;
          if (step.condition) {
            stepDesc += ` (condition: ${step.condition})`;
          }
          break;
        default:
          stepDesc += step.description || 'Unknown action';
      }

      prompt += stepDesc + '\n';
    });

    prompt += `\nPlease analyze this workflow and identify:\n`;
    prompt += `1. Steps that are completely redundant or duplicate\n`;
    prompt += `2. Steps that serve no meaningful purpose in the workflow\n`;
    prompt += `3. Wait steps that are unnecessary (the system auto-waits between actions)\n`;
    prompt += `4. Clicks or inputs that could be consolidated\n\n`;

    prompt += `IMPORTANT: Return your response as a JSON object with this exact structure:\n`;
    prompt += `{\n`;
    prompt += `  "stepsToRemove": [array of step numbers to remove, e.g., [3, 5, 7]],\n`;
    prompt += `  "suggestions": [array of text explanations for why each step should be removed]\n`;
    prompt += `}\n\n`;

    prompt += `Example response:\n`;
    prompt += `{\n`;
    prompt += `  "stepsToRemove": [3, 6],\n`;
    prompt += `  "suggestions": [\n`;
    prompt += `    "Step 3 is a duplicate click on the same element",\n`;
    prompt += `    "Step 6 is an unnecessary wait - the system already waits for page loads"\n`;
    prompt += `  ]\n`;
    prompt += `}\n\n`;

    prompt += `If no steps should be removed, return: {"stepsToRemove": [], "suggestions": []}`;

    return prompt;
  }

  /**
   * Parse AI analysis response to extract steps to remove
   */
  static parseAnalysisResponse(response) {
    try {
      // The response might be plain text, so extract JSON if present
      let jsonText = response;

      // Try to find JSON block in the response
      const jsonMatch = response.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        jsonText = jsonMatch[0];
      }

      // Parse the JSON
      const parsed = JSON.parse(jsonText);

      // Validate structure
      if (!parsed.stepsToRemove) {
        console.warn('[OptimizationPrompts] Response missing stepsToRemove array');
        return { stepsToRemove: [], suggestions: [] };
      }

      return {
        stepsToRemove: Array.isArray(parsed.stepsToRemove) ? parsed.stepsToRemove : [],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : []
      };

    } catch (error) {
      console.error('[OptimizationPrompts] Failed to parse AI analysis response:', error.message);
      console.error('[OptimizationPrompts] Response was:', response);

      // Fallback: try to extract numbers from text
      const numberMatches = response.match(/\d+/g);
      if (numberMatches) {
        console.log('[OptimizationPrompts] Fallback: extracted step numbers from text:', numberMatches);
        return {
          stepsToRemove: numberMatches.map(n => parseInt(n, 10)),
          suggestions: ['AI suggested removing these steps (fallback parsing)']
        };
      }

      // Complete fallback: no steps to remove
      return { stepsToRemove: [], suggestions: [] };
    }
  }
}

module.exports = OptimizationPrompts;
