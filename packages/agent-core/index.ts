export const greet = (name: string): string => {
  return `Hello, ${name}! This is the AI Agent Core.`;
};

// Export browser-use style services (actual implementations)
export { BrowserController } from './src/browserController.js';
export { LLMService } from './src/llmService.js';
export type { AgentLogCallback, AgentOutput, ActionResult } from './src/llmService.js';
export type { BrowserStateSummary, TabInfo } from './src/browserController.js';

// Export watchdogs
export * from './src/watchdogs/index.js';

// Export errors
export * from './src/errors/index.js';

// Export events
export * from './src/events/browserEvents.js';
export { EventBus } from './src/events/EventBus.js'; 