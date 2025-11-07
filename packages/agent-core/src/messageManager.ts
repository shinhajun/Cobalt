/**
 * Message Manager
 * Based on browser-use's MessageManager
 * Manages conversation history and formats browser state for LLM
 */

import { BrowserStateSummary } from './browserController';
import { SerializedDOMState } from './dom/views';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StateMessageOptions {
  browserStateSummary: BrowserStateSummary;
  previousModelOutput?: any;
  previousResult?: any;
  stepInfo?: any;
}

export class MessageManager {
  private messages: Message[] = [];
  private systemPrompt: string;
  private task: string;
  private maxDOMLength: number;
  private lastStateMessageIndex: number = -1;

  constructor(
    task: string,
    systemPromptTemplate: string,
    maxDOMLength: number = 40000
  ) {
    this.task = task;
    this.systemPrompt = systemPromptTemplate;
    this.maxDOMLength = maxDOMLength;

    // Add system message
    this.addSystemMessage();

    // Add initial task message
    this.addTaskMessage(task);
  }

  /**
   * Add system message to conversation
   */
  private addSystemMessage(): void {
    this.messages.push({
      role: 'system',
      content: this.systemPrompt,
    });
  }

  /**
   * Add task message to conversation
   */
  private addTaskMessage(task: string): void {
    this.messages.push({
      role: 'user',
      content: `## Task\n\n${task}\n\nPlease complete this task step by step. Think carefully about each action.`,
    });
  }

  /**
   * Create state messages for current step (browser-use style)
   * This is called EVERY step to update the browser context
   *
   * Replaces the previous state message with current state
   */
  createStateMessages(options: StateMessageOptions): void {
    // Remove previous state message if it exists
    if (this.lastStateMessageIndex >= 0 && this.lastStateMessageIndex < this.messages.length) {
      this.messages.splice(this.lastStateMessageIndex, 1);
    }

    // Build new state message
    const stateContent = this.buildStateContent(
      options.browserStateSummary,
      options.previousModelOutput,
      options.previousResult
    );

    // Add as user message
    this.messages.push({
      role: 'user',
      content: stateContent,
    });

    // Track the index for next replacement
    this.lastStateMessageIndex = this.messages.length - 1;
  }

  /**
   * Build state content message (browser-use style)
   */
  private buildStateContent(
    browserState: BrowserStateSummary,
    prevOutput: any | null | undefined,
    prevResult: any | null | undefined
  ): string {
    const sections: string[] = [];

    // 1. Previous step evaluation (if exists)
    if (prevOutput && prevResult) {
      sections.push(this.buildPreviousEvaluation(prevOutput, prevResult));
    }

    // 2. Current page information
    sections.push(this.buildCurrentPageInfo(browserState));

    // 3. Page statistics
    sections.push(this.buildPageStatistics(browserState));

    // 4. Interactive elements (CRITICAL - DOM representation)
    sections.push(this.buildInteractiveElements(browserState));

    // 5. Scroll and viewport info
    sections.push(this.buildViewportInfo(browserState));

    return sections.filter(s => s).join('\n\n');
  }

  /**
   * Build previous step evaluation section
   */
  private buildPreviousEvaluation(prevOutput: any, prevResult: any): string {
    let section = '## Previous Step Evaluation\n\n';

    section += `**Action taken:** ${JSON.stringify(prevOutput)}\n\n`;

    const success = prevResult.success !== false;
    const emoji = success ? '✓' : '✗';
    const message = prevResult.message || prevResult.error || 'No message';

    section += `**Result:** ${emoji} ${message}\n`;

    return section;
  }

  /**
   * Build current page info section
   */
  private buildCurrentPageInfo(browserState: BrowserStateSummary): string {
    let section = '## Current Page\n\n';

    section += `**URL:** ${browserState.url}\n`;
    section += `**Title:** ${browserState.title}\n`;

    return section;
  }

  /**
   * Build page statistics section
   */
  private buildPageStatistics(browserState: BrowserStateSummary): string {
    const stats = this.extractPageStats(browserState);

    let section = '## Page Statistics\n\n';
    section += `**Interactive elements:** ${stats.interactive}\n`;
    section += `**Links:** ${stats.links}\n`;
    section += `**Form inputs:** ${stats.inputs}\n`;
    section += `**Buttons:** ${stats.buttons}\n`;

    if (stats.scrollable > 0) {
      section += `**Scroll containers:** ${stats.scrollable}\n`;
    }

    if (browserState.tabs.length > 1) {
      section += `**Open tabs:** ${browserState.tabs.length}\n`;
    }

    return section;
  }

  /**
   * Build interactive elements section (CRITICAL!)
   */
  private buildInteractiveElements(browserState: BrowserStateSummary): string {
    let section = '## Interactive Elements\n\n';

    if (!browserState.llmRepresentation || browserState.llmRepresentation === 'No interactive elements found.') {
      section += 'No interactive elements found on this page.\n';
      return section;
    }

    // Add usage instructions
    section += '**How to interact with elements:**\n';
    section += '- Click: `{"type": "BROWSER_ACTION", "command": "clickElement", "index": 5}`\n';
    section += '- Type: `{"type": "BROWSER_ACTION", "command": "typeElement", "index": 3, "text": "hello"}`\n';
    section += '- Press key: `{"type": "BROWSER_ACTION", "command": "pressKeyOnElement", "index": 3, "key": "Enter"}`\n\n';

    // Add DOM representation (truncated if too long)
    const domText = this.truncateText(browserState.llmRepresentation, this.maxDOMLength);
    section += '**Available elements:**\n\n';
    section += '```\n';
    section += domText;
    section += '\n```\n';

    if (browserState.llmRepresentation.length > this.maxDOMLength) {
      section += `\n*Note: DOM truncated (${browserState.llmRepresentation.length} chars total, showing first ${this.maxDOMLength})*\n`;
    }

    return section;
  }

  /**
   * Build viewport info section
   */
  private buildViewportInfo(browserState: BrowserStateSummary): string {
    let section = '## Viewport & Scroll\n\n';

    section += `**Scroll position:** Y=${browserState.scrollPosition.y}\n`;
    section += `**Viewport size:** ${browserState.viewportSize.width}x${browserState.viewportSize.height}\n`;

    return section;
  }

  /**
   * Extract page statistics from browser state
   */
  private extractPageStats(browserState: BrowserStateSummary): {
    interactive: number;
    links: number;
    inputs: number;
    buttons: number;
    scrollable: number;
  } {
    const stats = {
      interactive: 0,
      links: 0,
      inputs: 0,
      buttons: 0,
      scrollable: 0,
    };

    if (!browserState.llmRepresentation) {
      return stats;
    }

    // Count from DOM representation
    const lines = browserState.llmRepresentation.split('\n');
    for (const line of lines) {
      if (line.includes('<a ') || line.includes('<a>')) {
        stats.links++;
        stats.interactive++;
      } else if (line.includes('<button')) {
        stats.buttons++;
        stats.interactive++;
      } else if (line.includes('<input')) {
        stats.inputs++;
        stats.interactive++;
      } else if (line.match(/\[\d+\]/)) {
        // Any indexed element is interactive
        stats.interactive++;
      }

      if (line.includes('|SCROLL|')) {
        stats.scrollable++;
      }
    }

    return stats;
  }

  /**
   * Truncate text to maximum length
   */
  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }

    return text.substring(0, maxLength) + '\n\n... [truncated]';
  }

  /**
   * Add assistant message to conversation
   */
  addAssistantMessage(content: string): void {
    this.messages.push({
      role: 'assistant',
      content,
    });
  }

  /**
   * Get all messages for LLM
   */
  getMessages(): Message[] {
    return this.messages;
  }

  /**
   * Get message count
   */
  getMessageCount(): number {
    return this.messages.length;
  }

  /**
   * Clear all messages except system prompt
   */
  clear(): void {
    this.messages = [];
    this.addSystemMessage();
    this.addTaskMessage(this.task);
    this.lastStateMessageIndex = -1;
  }
}
