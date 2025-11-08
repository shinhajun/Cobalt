import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { BrowserController } from "./browserController.js";

export type AgentLogCallback = (log: { type: 'thought' | 'observation' | 'system' | 'error', data: any }) => void;

export interface ActionResult {
  success: boolean;
  observation: string;
  error?: string;
}

export interface AgentOutput {
  success: boolean;
  result?: any;
  error?: string;
  iterations: number;
}

// Action types matching browser-use
interface ClickElementAction {
  type: 'click_element';
  index: number;
}

interface InputTextAction {
  type: 'input_text';
  index: number;
  text: string;
  clear?: boolean;
}

interface NavigateAction {
  type: 'navigate';
  url: string;
  new_tab?: boolean;
}

interface ScrollAction {
  type: 'scroll';
  down: boolean;
  pages?: number;
}

interface SendKeysAction {
  type: 'send_keys';
  keys: string;
}

interface SwitchTabAction {
  type: 'switch_tab';
  tab_id: string;
}

interface CloseTabAction {
  type: 'close_tab';
  tab_id: string;
}

interface DoneAction {
  type: 'done';
  text: string;
  success?: boolean;
}

type BrowserAction =
  | ClickElementAction
  | InputTextAction
  | NavigateAction
  | ScrollAction
  | SendKeysAction
  | SwitchTabAction
  | CloseTabAction
  | DoneAction;

export class LLMService {
  private model: any;
  private maxIterations: number = 100;

  constructor(modelName: string = "gpt-4o-mini") {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
    const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

    const isGemini = (name: string) => /^gemini[-\d\.]/.test(name);
    const isClaude = (name: string) => /^claude[-\d\.]/.test(name);

    console.log("[LLMService] Initializing with model:", modelName);

    if (isClaude(modelName)) {
      if (!CLAUDE_API_KEY) {
        throw new Error("Claude API key not configured");
      }
      this.model = new ChatAnthropic({
        apiKey: CLAUDE_API_KEY,
        modelName: modelName,
      });
    } else if (isGemini(modelName)) {
      if (!GOOGLE_API_KEY) {
        throw new Error("Google API key not configured");
      }
      this.model = new ChatGoogleGenerativeAI({
        apiKey: GOOGLE_API_KEY,
        model: modelName,
      });
    } else {
      if (!OPENAI_API_KEY) {
        throw new Error("OpenAI API key not configured");
      }
      this.model = new ChatOpenAI({
        openAIApiKey: OPENAI_API_KEY,
        modelName: modelName,
        temperature: 0.0,
      });
    }
  }

  /**
   * Get system prompt for the agent
   */
  private getSystemPrompt(): string {
    return `You are a browser automation agent. Your task is to accomplish user goals by interacting with web pages.

AVAILABLE ACTIONS:
1. click_element: Click on an interactive element by its index
   Example: {"type": "click_element", "index": 5}

2. input_text: Type text into an input field
   Example: {"type": "input_text", "index": 3, "text": "search query", "clear": true}

3. navigate: Go to a URL
   Example: {"type": "navigate", "url": "https://example.com", "new_tab": false}

4. scroll: Scroll the page up or down
   Example: {"type": "scroll", "down": true, "pages": 1.0}

5. send_keys: Send keyboard keys (Enter, Escape, PageDown, etc.) or shortcuts (Control+a)
   Example: {"type": "send_keys", "keys": "Enter"}

6. switch_tab: Switch to another tab by ID
   Example: {"type": "switch_tab", "tab_id": "0001"}

7. close_tab: Close a tab by ID
   Example: {"type": "close_tab", "tab_id": "0002"}

8. done: Mark the task as complete
   Example: {"type": "done", "text": "Successfully completed the task", "success": true}

INSTRUCTIONS:
- Think step by step about what you need to do
- Examine the current page state carefully (URL, title, interactive elements)
- Choose the most appropriate action to progress toward the goal
- Always respond with valid JSON containing a "thinking" field and an "action" field
- The "thinking" field should contain your reasoning
- The "action" field should contain one of the actions above

RESPONSE FORMAT:
{
  "thinking": "I need to click the search button to submit the query",
  "action": {"type": "click_element", "index": 5}
}

Remember:
- Element indices start from 1
- Always check if the page has loaded correctly before taking action
- Use "done" action when you've accomplished the user's goal
- Be precise and careful with your actions`;
  }

  /**
   * Main agent loop - browser-use pattern
   */
  async executeTask(
    taskDescription: string,
    browserController: BrowserController,
    logCallback?: AgentLogCallback,
    stopSignal?: () => boolean
  ): Promise<AgentOutput> {
    const emitLog = (type: 'thought' | 'observation' | 'system' | 'error', data: any) => {
      if (logCallback) {
        logCallback({ type, data });
      }
    };

    emitLog('system', { message: `Starting task: ${taskDescription}` });

    const messages: any[] = [
      new SystemMessage(this.getSystemPrompt()),
      new HumanMessage(`Task: ${taskDescription}\n\nPlease accomplish this task step by step.`),
    ];

    let iterationCount = 0;
    let isComplete = false;
    let finalResult: any = null;

    while (iterationCount < this.maxIterations && !isComplete) {
      if (stopSignal && stopSignal()) {
        emitLog('system', { message: 'Task stopped by user' });
        break;
      }

      iterationCount++;
      emitLog('system', { message: `--- Iteration ${iterationCount} ---` });

      try {
        // Phase 1: Get current browser state
        emitLog('system', { message: 'Getting browser state...' });
        const browserState = await browserController.getBrowserState(true, true);

        emitLog('observation', {
          url: browserState.url,
          title: browserState.title,
          elementsCount: Object.keys(browserState.selectorMap).length,
          timing: browserState.timing,
        });

        // Phase 2: Create state message for LLM
        const stateMessage = this.formatBrowserStateForLLM(browserState);
        messages.push(new HumanMessage(stateMessage));

        // Phase 3: Call LLM
        emitLog('system', { message: 'Calling LLM...' });
        const response = await this.model.invoke(messages);
        const responseText = response.content;

        emitLog('system', { message: `LLM response: ${responseText.substring(0, 200)}...` });

        // Phase 4: Parse LLM response
        const parsed = this.parseLLMResponse(responseText);

        if (!parsed) {
          emitLog('error', { message: 'Failed to parse LLM response' });
          messages.push(new AIMessage(responseText));
          messages.push(
            new HumanMessage('Invalid response format. Please respond with valid JSON containing "thinking" and "action" fields.')
          );
          continue;
        }

        const { thinking, action } = parsed;

        emitLog('thought', { thinking });

        // Add LLM response to messages
        messages.push(new AIMessage(responseText));

        // Phase 5: Execute action
        const actionResult = await this.executeAction(action, browserController);

        emitLog('observation', {
          action: action.type,
          success: actionResult.success,
          observation: actionResult.observation,
        });

        // Check if task is complete
        if (action.type === 'done') {
          isComplete = true;
          finalResult = {
            text: (action as DoneAction).text,
            success: (action as DoneAction).success ?? true,
          };
        }

        // Add action result to messages
        if (actionResult.success) {
          messages.push(new HumanMessage(`Action result: ${actionResult.observation}`));
        } else {
          messages.push(new HumanMessage(`Action failed: ${actionResult.error || 'Unknown error'}`));
        }

        // Keep message history manageable
        if (messages.length > 20) {
          // Keep system prompt and first message, remove oldest interactions
          const systemMsgs = messages.slice(0, 2);
          const recentMsgs = messages.slice(-16);
          messages.length = 0;
          messages.push(...systemMsgs, ...recentMsgs);
        }

      } catch (error: any) {
        emitLog('error', { message: error.message, stack: error.stack });

        // Add error to conversation
        messages.push(new HumanMessage(`Error occurred: ${error.message}. Please try a different approach.`));

        // Don't break, let the agent try to recover
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (iterationCount >= this.maxIterations) {
      emitLog('system', { message: 'Max iterations reached' });
    }

    emitLog('system', { message: `Task completed in ${iterationCount} iterations` });

    return {
      success: isComplete,
      result: finalResult,
      iterations: iterationCount,
    };
  }

  /**
   * Format browser state for LLM
   */
  private formatBrowserStateForLLM(browserState: any): string {
    let message = `Current Browser State:\n`;
    message += `URL: ${browserState.url}\n`;
    message += `Title: ${browserState.title}\n`;
    message += `Scroll Position: (${browserState.scrollPosition.x}, ${browserState.scrollPosition.y})\n`;
    message += `Viewport: ${browserState.viewportSize.width}x${browserState.viewportSize.height}\n\n`;

    if (browserState.tabs.length > 1) {
      message += `Open Tabs:\n`;
      browserState.tabs.forEach((tab: any) => {
        message += `  [${tab.id}] ${tab.title} - ${tab.url}\n`;
      });
      message += '\n';
    }

    message += browserState.llmRepresentation;

    return message;
  }

  /**
   * Parse LLM response to extract thinking and action
   */
  private parseLLMResponse(responseText: string): { thinking: string; action: BrowserAction } | null {
    try {
      // Try to extract JSON from markdown code blocks if present
      let jsonText = responseText;

      const jsonMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
      } else {
        // Try to find JSON object in the text
        const objectMatch = responseText.match(/\{[\s\S]*\}/);
        if (objectMatch) {
          jsonText = objectMatch[0];
        }
      }

      const parsed = JSON.parse(jsonText);

      if (!parsed.thinking || !parsed.action) {
        return null;
      }

      return {
        thinking: parsed.thinking,
        action: parsed.action as BrowserAction,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Execute a browser action
   */
  private async executeAction(action: BrowserAction, browserController: BrowserController): Promise<ActionResult> {
    try {
      switch (action.type) {
        case 'click_element': {
          const result = await browserController.clickElement(action.index);
          return {
            success: result.success,
            observation: result.success
              ? `Clicked element at index ${action.index}`
              : `Failed to click element: ${result.error}`,
            error: result.error,
          };
        }

        case 'input_text': {
          const result = await browserController.inputText(action.index, action.text, action.clear ?? true);
          return {
            success: result.success,
            observation: result.success
              ? `Typed "${action.text}" into element at index ${action.index}`
              : `Failed to type text: ${result.error}`,
            error: result.error,
          };
        }

        case 'navigate': {
          const result = await browserController.navigate(action.url, action.new_tab ?? false);
          return {
            success: result.success,
            observation: result.success
              ? `Navigated to ${action.url}`
              : `Failed to navigate: ${result.error}`,
            error: result.error,
          };
        }

        case 'scroll': {
          const result = await browserController.scroll(action.down, action.pages ?? 1.0);
          return {
            success: result.success,
            observation: result.success
              ? `Scrolled ${action.down ? 'down' : 'up'} ${action.pages ?? 1.0} pages`
              : `Failed to scroll: ${result.error}`,
            error: result.error,
          };
        }

        case 'send_keys': {
          const result = await browserController.sendKeys(action.keys);
          return {
            success: result.success,
            observation: result.success
              ? `Sent keys: ${action.keys}`
              : `Failed to send keys: ${result.error}`,
            error: result.error,
          };
        }

        case 'switch_tab': {
          const result = await browserController.switchTab(action.tab_id);
          return {
            success: result.success,
            observation: result.success
              ? `Switched to tab ${action.tab_id}`
              : `Failed to switch tab: ${result.error}`,
            error: result.error,
          };
        }

        case 'close_tab': {
          const result = await browserController.closeTab(action.tab_id);
          return {
            success: result.success,
            observation: result.success
              ? `Closed tab ${action.tab_id}`
              : `Failed to close tab: ${result.error}`,
            error: result.error,
          };
        }

        case 'done': {
          return {
            success: true,
            observation: `Task completed: ${action.text}`,
          };
        }

        default:
          return {
            success: false,
            observation: 'Unknown action type',
            error: `Unknown action type: ${(action as any).type}`,
          };
      }
    } catch (error: any) {
      return {
        success: false,
        observation: 'Error executing action',
        error: error.message,
      };
    }
  }

  /**
   * Set maximum iterations
   */
  setMaxIterations(max: number): void {
    this.maxIterations = max;
  }

  /**
   * Plan and execute task (wrapper for executeTask for compatibility with server.ts)
   */
  async planAndExecute(
    taskDescription: string,
    browserController: BrowserController,
    logCallback?: AgentLogCallback
  ): Promise<{ success: boolean; message?: string }> {
    const result = await this.executeTask(taskDescription, browserController, logCallback);

    return {
      success: result.success,
      message: result.result?.text || (result.success ? 'Task completed' : 'Task failed'),
    };
  }
}
