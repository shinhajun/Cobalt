// FlowchartGenerator.js - Generates flowchart data from analyzed steps

class FlowchartGenerator {
  /**
   * Generate flowchart data from macro and steps
   * @param {Object} macro - Base macro object
   * @param {Array} steps - Analyzed steps
   * @returns {Object} Complete macro with flowchart data
   */
  generate(macro, steps) {
    console.log('[FlowchartGenerator] Generating flowchart for', steps.length, 'steps');

    if (!macro) {
      throw new Error('Macro object is required');
    }

    if (!steps || steps.length === 0) {
      console.warn('[FlowchartGenerator] No steps to generate flowchart');
      return macro;
    }

    // Update macro with steps
    macro.steps = steps;

    // Update metadata
    macro.metadata.totalSteps = steps.length;

    // Calculate duration (last step timestamp)
    if (steps.length > 0) {
      const lastStep = steps[steps.length - 1];
      macro.metadata.duration = lastStep.timestamp;
    }

    // Extract start and end URLs
    this.extractURLs(macro, steps);

    // Generate descriptions if missing
    this.generateDescriptions(steps);

    // Add flowchart-specific metadata
    macro.flowchart = {
      nodes: this.generateNodes(steps),
      edges: this.generateEdges(steps),
      layout: 'vertical'
    };

    console.log('[FlowchartGenerator] Flowchart generated successfully');
    return macro;
  }

  /**
   * Extract start and end URLs from steps
   * @param {Object} macro - Macro object
   * @param {Array} steps - Steps array
   */
  extractURLs(macro, steps) {
    // Find first navigation step for start URL
    const firstNav = steps.find(step => step.type === 'navigation');
    if (firstNav) {
      macro.metadata.startUrl = firstNav.url;
    }

    // Find last navigation step for end URL
    const navSteps = steps.filter(step => step.type === 'navigation');
    if (navSteps.length > 0) {
      macro.metadata.endUrl = navSteps[navSteps.length - 1].url;
    }
  }

  /**
   * Generate descriptions for steps if missing
   * @param {Array} steps - Steps array
   */
  generateDescriptions(steps) {
    for (const step of steps) {
      if (!step.description) {
        step.description = this.generateDescription(step);
      }
    }
  }

  /**
   * Generate description for a step
   * @param {Object} step - Step object
   * @returns {string} Description
   */
  generateDescription(step) {
    switch (step.type) {
      case 'navigation':
        try {
          const url = new URL(step.url);
          return `Navigate to ${url.hostname}`;
        } catch {
          return `Navigate to ${step.url}`;
        }

      case 'click':
        return `Click on ${step.target?.description || 'element'}`;

      case 'input':
        const value = step.staticValue || step.value || '';
        const truncated = value.length > 30 ? value.substring(0, 30) + '...' : value;
        return `Type "${truncated}"`;

      case 'keypress':
        return `Press ${step.key}`;

      case 'wait':
        const seconds = (step.timeout / 1000).toFixed(1);
        return `Wait ${seconds}s for ${step.condition}`;

      default:
        return step.type;
    }
  }

  /**
   * Generate nodes for flowchart visualization
   * @param {Array} steps - Steps array
   * @returns {Array} Nodes array
   */
  generateNodes(steps) {
    return steps.map((step, index) => ({
      id: `step-${step.stepNumber}`,
      type: step.type,
      label: step.description,
      data: step,
      position: {
        x: 0,
        y: index * 120 // Vertical spacing
      }
    }));
  }

  /**
   * Generate edges (connections) between nodes
   * @param {Array} steps - Steps array
   * @returns {Array} Edges array
   */
  generateEdges(steps) {
    const edges = [];

    for (let i = 0; i < steps.length - 1; i++) {
      edges.push({
        id: `edge-${i}`,
        source: `step-${steps[i].stepNumber}`,
        target: `step-${steps[i + 1].stepNumber}`,
        type: 'default',
        label: ''
      });
    }

    return edges;
  }

  /**
   * Optimize flowchart layout
   * Future enhancement: auto-layout algorithm
   * @param {Object} flowchart - Flowchart object
   * @returns {Object} Optimized flowchart
   */
  optimizeLayout(flowchart) {
    // TODO: Implement smart layout algorithm
    // - Detect branches and loops
    // - Arrange nodes for minimal crossing
    // - Group related actions
    return flowchart;
  }

  /**
   * Add metadata to flowchart
   * @param {Object} macro - Macro object
   * @returns {Object} Macro with metadata
   */
  addMetadata(macro) {
    if (!macro.metadata) {
      macro.metadata = {};
    }

    // Count step types
    const typeCounts = {};
    for (const step of macro.steps) {
      typeCounts[step.type] = (typeCounts[step.type] || 0) + 1;
    }

    macro.metadata.stepTypes = typeCounts;

    // Calculate complexity score (simple heuristic)
    macro.metadata.complexityScore = this.calculateComplexity(macro.steps);

    return macro;
  }

  /**
   * Calculate complexity score
   * @param {Array} steps - Steps array
   * @returns {number} Complexity score (1-10)
   */
  calculateComplexity(steps) {
    if (!steps || steps.length === 0) return 0;

    let score = 0;

    // More steps = more complex
    score += Math.min(steps.length / 10, 3);

    // More input steps = more complex
    const inputSteps = steps.filter(s => s.type === 'input').length;
    score += Math.min(inputSteps / 5, 3);

    // Navigation changes = more complex
    const navSteps = steps.filter(s => s.type === 'navigation').length;
    score += Math.min(navSteps / 3, 2);

    // More unique targets = more complex
    const uniqueTargets = new Set(
      steps
        .filter(s => s.target)
        .map(s => s.target.selector)
    ).size;
    score += Math.min(uniqueTargets / 10, 2);

    return Math.min(Math.ceil(score), 10);
  }
}

module.exports = FlowchartGenerator;
