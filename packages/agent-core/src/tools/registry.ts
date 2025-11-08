/**
 * Tools Registry - Registry-based action system
 *
 * Based on browser-use's Registry architecture
 */

import { BrowserController } from '../browserController.js';

/**
 * Action result (browser-use style)
 */
export interface ActionResult {
  extractedContent?: string; // What the action extracted/did (shown to LLM)
  longTermMemory?: string; // Persistent memory (shown in next iterations)
  shortTermMemory?: string; // Short-term memory (cleared after next action)
  error?: string; // Error message if action failed
  includeExtractedContentOnlyOnce?: boolean; // Only show extractedContent once
}

/**
 * Action parameter model (base type)
 */
export interface BaseActionParams {
  [key: string]: any;
}

/**
 * Action handler function
 */
export type ActionHandler = (
  params: BaseActionParams,
  browserController: BrowserController
) => Promise<ActionResult>;

/**
 * Action registration
 */
export interface ActionRegistration {
  name: string; // Action name (e.g., 'click_element')
  description: string; // Description for LLM
  paramModel: any; // Parameter model constructor
  handler: any; // Handler function (any to support typed params)
}

/**
 * Tools Registry
 */
export class Registry {
  private actions: Map<string, ActionRegistration> = new Map();

  /**
   * Register an action
   */
  register(registration: ActionRegistration): void {
    this.actions.set(registration.name, registration);
  }

  /**
   * Get action by name
   */
  get(name: string): ActionRegistration | undefined {
    return this.actions.get(name);
  }

  /**
   * Get all registered actions
   */
  getAll(): ActionRegistration[] {
    return Array.from(this.actions.values());
  }

  /**
   * Check if action exists
   */
  has(name: string): boolean {
    return this.actions.has(name);
  }

  /**
   * Execute an action
   */
  async execute(
    actionName: string,
    params: BaseActionParams,
    browserController: BrowserController
  ): Promise<ActionResult> {
    const action = this.get(actionName);

    if (!action) {
      return {
        error: `Unknown action: ${actionName}`,
      };
    }

    try {
      return await action.handler(params, browserController);
    } catch (error: any) {
      return {
        error: `Action execution failed: ${error.message}`,
      };
    }
  }

  /**
   * Get action descriptions for LLM prompt
   */
  getActionDescriptions(): string {
    const descriptions: string[] = [];

    for (const action of this.getAll()) {
      descriptions.push(`${action.name}: ${action.description}`);
    }

    return descriptions.join('\n');
  }
}
