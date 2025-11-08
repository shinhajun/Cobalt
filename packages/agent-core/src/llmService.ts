import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { BrowserController } from "./browserController.js";
import { info, debug } from "./utils/logger.js";
import { Registry, registerDefaultActions, ActionResult as ToolActionResult } from "./tools/index.js";

export type AgentLogCallback = (log: { type: 'thought' | 'observation' | 'system' | 'error', data: any }) => void;

export interface AgentOutput {
  success: boolean;
  result?: any;
  error?: string;
  iterations: number;
}

/**
 * Action with type field (for LLM responses)
 */
interface TypedAction {
  type: string;
  [key: string]: any;
}

export interface LLMServiceConfig {
  openaiApiKey?: string;
  googleApiKey?: string;
  claudeApiKey?: string;
}

export class LLMService {
  private model: any;
  private maxIterations: number = 100;
  private maxActionsPerStep: number = 5;
  private registry: Registry;
  private recentActions: Array<{ type: string; params: any; ts: number }> = [];

  constructor(modelName: string = "gpt-5-mini", config?: LLMServiceConfig) {
    // Initialize Tools Registry
    this.registry = new Registry();
    registerDefaultActions(this.registry);
    // Allow direct API key injection, fallback to environment variables
    const OPENAI_API_KEY = config?.openaiApiKey || process.env.OPENAI_API_KEY;
    const GOOGLE_API_KEY = config?.googleApiKey || process.env.GOOGLE_API_KEY;
    const CLAUDE_API_KEY = config?.claudeApiKey || process.env.CLAUDE_API_KEY;

    const isGemini = (name: string) => /^gemini[-\d\.]/.test(name);
    const isClaude = (name: string) => /^claude[-\d\.]/.test(name);

    info("[LLMService] Initializing with model:", modelName);

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
   * Get system prompt for the agent (uses Registry for action descriptions)
   */
  private getSystemPrompt(): string {
    // Get detailed action descriptions from Registry with parameter info
    const actionDescriptions = this.registry.getDetailedActionDescriptions();

    return `You are a browser automation agent. Your task is to accomplish user goals by interacting with web pages.

AVAILABLE ACTIONS:
${actionDescriptions}

RESPONSE SCHEMA:
- You MUST return a single JSON object.
- Required: "thinking": string
- Exactly one of the following:
  - "action": Action
  - "actions": Action[] (ordered multi-step)

ACTION OBJECT:
- Required: "type": string (one of the registered actions listed above)
- Plus the action-specific parameters below. Do not add undocumented fields.

ACTION TYPES AND PARAMETERS:
- search: { query: string, engine?: "google" | "bing" | "duckduckgo" }
- navigate: { url: string, newTab?: boolean }
- click: { index: number }
- input: { index: number, text: string, clear?: boolean, submit?: boolean }
- scroll: { down: boolean | "down" | "up" | "true" | "false" | 1 | 0, pages?: number, index?: number }
- find_text: { text: string, partial?: boolean }
- screenshot: { note?: string }
- evaluate: { code: string }
- extract: { query?: string, extract_links?: boolean, start_from_char?: number }
- go_back: { }
- wait: { seconds?: number }
- select_dropdown: { index: number, option: string }
- dropdown_options: { index: number }
- upload_file: { index: number, filePath: string }
- send_keys: { keys: string }  // Use e.g., "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight". Shortcuts like "Control+a" are allowed.
- switch: { tabId: string }
- close: { tabId: string }
- write_file: { filePath: string, content: string, append?: boolean, trailingNewline?: boolean, leadingNewline?: boolean }
- read_file: { filePath: string }
- replace_file: { filePath: string, oldStr: string, newStr: string }
- done: { text: string, success?: boolean }

CRITICAL PARAMETER RULES:
- For click: use "index" parameter (NOT "element_index")
- For input: use "index" parameter (NOT "element_index")
- Element indices come from the browser state's interactive elements list
- Indices are numbers (e.g., 42, not "42")

VERIFICATION RULES:
- Do NOT assume an action succeeded because it was issued. Verify via the latest browser state (and screenshot if available).
- Only call done when clear, external success criteria are visible (e.g., a filter chip appears, URL/query reflects applied filter, or visible items match the constraint).
- If an expected element or change is missing, try targeted recovery: wait, find_text, container scroll via index, or navigate back.
- Prefer small waits when content updates asynchronously; then re-check the state.

TARGETED ACTION GUIDANCE:
- Use find_text to jump to specific sections (e.g., "Price", "Filters", "Add to Cart").
- Use scroll with an element index to scroll inside a scrollable container (left filter column, dropdown panels) rather than the whole page.
- For search bars, set submit=true on input or press Enter via send_keys after typing.
- Avoid alternating up/down scrolls without progress. If that happens, switch to targeted find_text or container scrolling.

INSTRUCTIONS:
- Think step by step about what you need to do
- Examine the current page state carefully (URL, title, interactive elements)
- Choose the most appropriate action(s) to progress toward the goal
- Always respond with valid JSON containing a "thinking" field and either an "action" object or an "actions" array of objects
- Each action object must include a "type" field

FORMAT RULES:
- Output must be raw JSON only. Do not include code fences, markdown, or extra prose.
- Do not add fields other than "thinking", "action" or "actions".
- For multiple steps in one turn, use an "actions" array (ordered). For a single step, use an "action" object.


CORRECT RESPONSE FORMAT EXAMPLES:

Search example:
{
  "thinking": "I need to search for Python tutorials",
  "action": {"type": "search", "query": "Python tutorials", "engine": "google"}
}

Click element example (use "index", NOT "element_index"):
{
  "thinking": "I need to click the submit button at index 42",
  "action": {"type": "click", "index": 42}
}

Input text example (use "index", NOT "element_index"):
{
  "thinking": "I need to type into the search box at index 15",
  "action": {"type": "input", "index": 15, "text": "hello world", "clear": true, "submit": true}
}

Find text example:
{
  "thinking": "I should go to the Price filters section",
  "action": {"type": "find_text", "text": "Price"}
}

Container scroll example:
{
  "thinking": "Scroll the results list container without moving the page",
  "action": {"type": "scroll", "down": true, "pages": 1, "index": 812}
}

Select dropdown example:
{
  "thinking": "Choose United States from the country dropdown",
  "actions": [
    {"type": "dropdown_options", "index": 120},
    {"type": "select_dropdown", "index": 120, "option": "United States"}
  ]
}

Upload file example:
{
  "thinking": "Upload the prepared image",
  "action": {"type": "upload_file", "index": 33, "filePath": "./fixtures/image.png"}
}

Remember:
- Element indices start from 0
- ALWAYS use "index" parameter for click and input
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
        // OPTIMIZED: Skip screenshot in LLM loop (Electron already streams screenshots separately)
        emitLog('system', { message: 'Getting browser state...' });
        const browserState = await browserController.getBrowserState(false, true);

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

        const { thinking, actions } = parsed;

        emitLog('thought', { thinking });

        // Add LLM response to messages
        messages.push(new AIMessage(responseText));

        // Phase 5: Execute up to maxActionsPerStep actions
        const toRun = actions.slice(0, this.maxActionsPerStep);

        // Anti-oscillation guard: if alternating scrolls detected and
        // next plan only contains scroll, nudge model to use targeted navigation
        if (this.isScrollOscillating() && toRun.every(a => a.type === 'scroll')) {
          emitLog('system', { message: 'Detected alternating scroll directions. Nudging model to use targeted navigation.' });
          messages.push(new HumanMessage(
            'You are alternating scroll directions without progress. Avoid toggling up/down blindly. '
            + 'Use find_text to navigate to specific sections (e.g., "Price", "Filters", "Add to cart") or scroll within a container using the index parameter. '
            + 'Return an action that targets the relevant section directly.'
          ));
          continue;
        }
        for (const act of toRun) {
          const actionResult = await this.executeAction(act, browserController);
          const actionSucceeded = !actionResult.error;
          const observation = actionResult.extractedContent || actionResult.longTermMemory || actionResult.error || 'Action completed';

          emitLog('observation', {
            action: act.type,
            success: actionSucceeded,
            observation,
          });

          if (act.type === 'done') {
            isComplete = true;
            finalResult = {
              text: (act as any).text || 'Task completed',
              success: (act as any).success ?? true,
            };
            break;
          }

          if (actionSucceeded) {
            messages.push(new HumanMessage(`Action result: ${observation}`));
          } else {
            messages.push(new HumanMessage(`Action failed: ${actionResult.error || 'Unknown error'}`));
          }

          // Record recent action
          this.recordRecentAction(act);
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
  private parseLLMResponse(responseText: string): { thinking: string; actions: TypedAction[] } | null {
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

      if (!parsed.thinking || (!parsed.action && !parsed.actions)) {
        return null;
      }

      let actions: TypedAction[] = [];
      if (Array.isArray(parsed.actions)) {
        actions = parsed.actions as TypedAction[];
      } else if (parsed.action) {
        actions = [parsed.action as TypedAction];
      }

      return {
        thinking: parsed.thinking,
        actions,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Execute a browser action using Tools Registry
   */
  private async executeAction(action: TypedAction, browserController: BrowserController): Promise<ToolActionResult> {
    try {
      // Debug: Log the action being executed
      debug(`[LLM] Executing action:`, JSON.stringify(action, null, 2));

      // Use Registry to execute action
      const result = await this.registry.execute(action.type, action, browserController);

      const obs = result.extractedContent || result.longTermMemory || result.error || 'Action completed';
      const success = !result.error;
      debug(`[LLM] Action result - success: ${success}, observation: ${obs}`);

      return result;
    } catch (error: any) {
      debug(`[LLM] Action execution error:`, error);
      return {
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

  setMaxActionsPerStep(max: number): void {
    this.maxActionsPerStep = Math.max(1, Math.min(20, Math.floor(max)));
  }

  private recordRecentAction(action: TypedAction): void {
    this.recentActions.push({ type: action.type, params: action, ts: Date.now() });
    if (this.recentActions.length > 10) this.recentActions.shift();
  }

  private isScrollOscillating(): boolean {
    const now = Date.now();
    const windowMs = 6000;
    const recent = this.recentActions.filter(a => now - a.ts <= windowMs && a.type === 'scroll');
    if (recent.length < 2) return false;
    const dirs = recent.map(a => {
      const v = (a.params as any).down;
      if (typeof v === 'boolean') return v;
      const s = String(v).toLowerCase();
      if (s === 'down' || s === 'true' || s === '1') return true;
      if (s === 'up' || s === 'false' || s === '0') return false;
      return true;
    });
    let alternations = 0;
    for (let i = 1; i < dirs.length; i++) {
      if (dirs[i] !== dirs[i - 1]) alternations++;
    }
    return alternations >= 2;
  }

  /**
   * Chat with tools support for function calling
   */
  async chatWithTools(
    messages: Array<{ role: string; content: string }>,
    tools: any[]
  ): Promise<any> {
    // Convert messages to LangChain format
    const langchainMessages = messages.map(msg => {
      if (msg.role === 'user') {
        return new HumanMessage(msg.content);
      } else if (msg.role === 'assistant') {
        return new AIMessage(msg.content);
      } else if (msg.role === 'system') {
        return new SystemMessage(msg.content);
      }
      return new HumanMessage(msg.content);
    });

    // Bind tools to model
    const modelWithTools = this.model.bind({ tools });

    // Invoke model
    const response = await modelWithTools.invoke(langchainMessages);

    return response;
  }

  /**
   * Simple chat helper for single-turn prompts (used by Electron quick actions)
   */
  async chat(messages: Array<{ role: string; content: string }>): Promise<string> {
    // Convert messages to LangChain format
    const langchainMessages = messages.map(msg => {
      if (msg.role === 'user') return new HumanMessage(msg.content);
      if (msg.role === 'assistant') return new AIMessage(msg.content);
      if (msg.role === 'system') return new SystemMessage(msg.content);
      return new HumanMessage(msg.content);
    });

    const response = await this.model.invoke(langchainMessages);
    const content = (response as any)?.content;
    if (typeof content === 'string') return content;
    try {
      return Array.isArray(content)
        ? content.map((c: any) => (typeof c?.text === 'string' ? c.text : '')).join('\n').trim()
        : String(content ?? '');
    } catch {
      return '';
    }
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


