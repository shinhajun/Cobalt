export const greet = (name: string): string => {
  return `Hello, ${name}! This is the AI Agent Core.`;
};

// Export new browser-use style services
export { NewBrowserController } from './src/newBrowserController.js';
export { NewLLMService } from './src/newLLMService.js';
export type { AgentLogCallback, AgentOutput, ActionResult } from './src/newLLMService.js';
export type { BrowserStateSummary, TabInfo } from './src/newBrowserController.js'; 