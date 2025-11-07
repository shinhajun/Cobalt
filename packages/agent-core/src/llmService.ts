import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { BrowserController } from "./browserController";
// Vision-based captcha solving (no external captcha providers)
import path from 'path';

export type AgentLogCallback = (log: { type: 'thought' | 'observation' | 'system' | 'error', data: any }) => void;

export class LLMService {
  private model: any;
  private logCallback: AgentLogCallback;
  private visionModel: any | null = null;
  private isVisionGeminiProvider: boolean = false;

  constructor(modelName: string = "gpt-5-mini", logCallback?: AgentLogCallback) {
    // 생성자 실행 시점에 환경변수 읽기 (모듈 로드 시점이 아닌)
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

    const isGemini = (name: string) => /^gemini[-\d\.]/.test(name);

    console.log("[LLMService] Initializing with model:", modelName);

    if (isGemini(modelName)) {
      if (!GOOGLE_API_KEY) {
        console.error("[LLMService] GOOGLE_API_KEY not found in environment variables");
        throw new Error("[LLMService] Google API key is not configured. Cannot initialize Gemini model.");
      }
      console.log("[LLMService] Using Gemini (Google) provider. Model:", modelName);
      this.model = new ChatGoogleGenerativeAI({
        apiKey: GOOGLE_API_KEY,
        model: modelName,
        // align timeouts with OpenAI path
        maxOutputTokens: undefined,
      });
    } else {
      if (!OPENAI_API_KEY) {
        console.error("[LLMService] OPENAI_API_KEY not found in environment variables");
        console.error("[LLMService] Available env keys:", Object.keys(process.env).filter(k => k.includes('OPENAI')));
        throw new Error(
          "[LLMService] OpenAI API key is not configured. Cannot initialize LLMService."
        );
      }
      console.log("[LLMService] Using OpenAI provider. Model:", modelName);
      // gpt-5-mini는 temperature 커스터마이징을 지원하지 않음 (기본값 1만 사용)
      this.model = new ChatOpenAI({
        apiKey: OPENAI_API_KEY,
        modelName: modelName,
        timeout: 15000,
      });
    }
    this.logCallback = logCallback || (() => {}); // 기본값은 아무것도 안 하는 함수

    // Vision model (for image-based captcha). Defaults to gpt-5 if available.
    const visionModelName = process.env.CAPTCHA_VISION_MODEL || 'gpt-5';
    try {
      if (isGemini(visionModelName)) {
        if (!GOOGLE_API_KEY) {
          console.warn('[LLMService] GOOGLE_API_KEY missing. Cannot initialize Gemini vision model.');
          this.visionModel = null;
        } else {
          this.visionModel = new ChatGoogleGenerativeAI({
            apiKey: GOOGLE_API_KEY,
            model: visionModelName,
          });
          this.isVisionGeminiProvider = true;
          console.log('[LLMService] Vision model initialized (Gemini):', visionModelName);
        }
      } else {
        if (!OPENAI_API_KEY) {
          console.warn('[LLMService] OPENAI_API_KEY missing. Cannot initialize OpenAI vision model.');
          this.visionModel = null;
        } else {
          this.visionModel = new ChatOpenAI({
            apiKey: OPENAI_API_KEY,
            modelName: visionModelName,
            timeout: 20000,
          });
          this.isVisionGeminiProvider = false;
          console.log('[LLMService] Vision model initialized (OpenAI):', visionModelName);
        }
      }
    } catch (e) {
      this.visionModel = null;
      console.warn('[LLMService] Vision model is not available. Image-based captcha solving may fail.');
    }
  }

  private buildVisionContentParts(textPrompt: string, imageBase64: string, mime: 'image/png' | 'image/jpeg' = 'image/png'): any[] {
    // Provider-aware content parts for multimodal messages
    if (this.isVisionGeminiProvider) {
      // Gemini expects image_url as a string
      return [
        { type: 'text', text: textPrompt },
        { type: 'image_url', image_url: `data:${mime};base64,${imageBase64}` }
      ] as any[];
    }
    // OpenAI expects image_url as an object with url field
    return [
      { type: 'text', text: textPrompt },
      { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } }
    ] as any[];
  }

  private emitLog(type: 'thought' | 'observation' | 'system' | 'error', data: any) {
    this.logCallback({ type, data });
  }

  // Solve image captcha via vision model by returning the raw text to type
  private async solveCaptchaImageToText(imageBase64: string): Promise<string | null> {
    if (!this.visionModel) {
      this.emitLog('error', { message: 'Vision model not initialized for CAPTCHA solving.' });
      return null;
    }
    try {
      this.emitLog('system', { message: `Calling vision model to extract CAPTCHA text. Image size: ${imageBase64.length} chars` });
      const instruction = `You are given an image of a text-based CAPTCHA. Read the characters exactly as shown and return only the characters to type. Do not add spaces or explanations. If unreadable, respond with the single word: UNREADABLE.`;
      let messages: any;
      if (this.isVisionGeminiProvider) {
        // Gemini: avoid SystemMessage; send combined human content
        messages = [
          new HumanMessage({
            content: this.buildVisionContentParts(instruction, imageBase64, 'image/png') as any
          } as any)
        ];
      } else {
        const content: any = this.buildVisionContentParts(instruction, imageBase64, 'image/png');
        messages = [
          { role: 'user', content },
          { role: 'system', content: [{ type: 'text', text: 'You are an assistant that outputs strict JSON only.' }] }
        ];
      }

      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Vision model timeout after 40s')), 40000)
      );

      const res: any = await Promise.race([
        (this.visionModel as any).invoke(messages),
        timeoutPromise
      ]).catch((err: Error) => {
        this.emitLog('error', { message: `Vision model invoke error (provider=${this.isVisionGeminiProvider ? 'gemini' : 'openai'}): ${err.message}, stack: ${err.stack?.substring(0, 200)}` });
        return null;
      });

      if (!res) {
        this.emitLog('error', { message: 'Vision model returned null/undefined response.' });
        return null;
      }

      this.emitLog('system', { message: `Vision model raw response type: ${typeof res}, keys: ${Object.keys(res || {}).join(', ')}` });
      this.emitLog('system', { message: `Vision model raw response: ${JSON.stringify(res).substring(0, 500)}` });
      let text: string;
      if (typeof res.content === 'string') text = res.content;
      else if (Array.isArray(res.content)) text = res.content.map((x: any) => typeof x === 'string' ? x : (x.text || JSON.stringify(x))).join('\n');
      else text = JSON.stringify(res.content);
      const answer = (text || '').trim();
      this.emitLog('system', { message: `Vision extracted text: "${answer}"` });
      if (!answer || /^UNREADABLE$/i.test(answer)) return null;
      // Strip any accidental quotes/markdown
      return answer.replace(/^```[a-z]*\n?|```$/g, '').trim();
    } catch (e) {
      this.emitLog('error', { message: `Vision solve failed: ${(e as Error).message}` });
      return null;
    }
  }

  // Choose reCAPTCHA grid tiles via vision model (using full grid image)
  private async chooseRecaptchaTiles(instruction: string, gridImageBase64: string, gridSize: number = 3): Promise<number[] | null> {
    if (!this.visionModel) {
      this.emitLog('error', { message: 'Vision model not initialized for reCAPTCHA tile selection.' });
      return null;
    }
    try {
      this.emitLog('system', { message: `Vision model analyzing grid image (${gridImageBase64.length} chars) for instruction: "${instruction}"` });
      const systemPrompt = `You are given an image grid classification task.

The image shows a grid of tiles. Grid may be 3x3 (9 tiles) or 4x4 (16 tiles).
Indexing is row-major 0-based.
For 3x3:
Row 1: [0] [1] [2]
Row 2: [3] [4] [5]
Row 3: [6] [7] [8]

For 4x4:
Row 1: [0] [1] [2] [3]
Row 2: [4] [5] [6] [7]
Row 3: [8] [9] [10] [11]
Row 4: [12] [13] [14] [15]

Read the instruction carefully and identify which tiles contain the requested object.
Look at the ENTIRE grid to understand context and objects that span multiple tiles.

Respond with JSON only in the form {"indexes":[...]} using 0-based indexing with maximum index ${gridSize === 4 ? 15 : 8}. If no tiles match, return {"indexes":[]}.

Examples:
- If tiles 0, 1, 4 contain the object: {"indexes":[0,1,4]}
- If no tiles match: {"indexes":[]}

No explanation, only JSON.`;

      // Build messages using LangChain message classes for maximum compatibility
      let messages: any[];
      if (this.isVisionGeminiProvider) {
        // Gemini: combine system+human into a single human message
        const combined = `${systemPrompt}\n\nInstruction: ${instruction}`;
        messages = [
          new HumanMessage({
            // Grid is captured as JPEG in BrowserController
            content: this.buildVisionContentParts(combined, gridImageBase64, 'image/jpeg') as any
          } as any)
        ];
      } else {
        messages = [
          new SystemMessage(systemPrompt),
          new HumanMessage({
            // Grid is captured as JPEG in BrowserController
            content: this.buildVisionContentParts(`Instruction: ${instruction}`, gridImageBase64, 'image/jpeg') as any
          } as any)
        ];
      }

      this.emitLog('system', { message: 'Invoking vision model for tile selection...' });

      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Vision model timeout after 30s')), 30000)
      );

      let res: any;
      try {
        this.emitLog('system', { message: 'Calling visionModel.invoke()...' });
        console.log('[LLMService] About to call visionModel.invoke()');
        console.log('[LLMService] Vision model type:', typeof this.visionModel);
        console.log('[LLMService] Message structure:', JSON.stringify(messages[0].content[0]).substring(0, 200));

        res = await Promise.race([
          (this.visionModel as any).invoke(messages),
          timeoutPromise
        ]);

        console.log('[LLMService] visionModel.invoke() returned:', typeof res);
        console.log('[LLMService] res is null/undefined?', res == null);
        if (res) {
          console.log('[LLMService] res constructor:', res.constructor?.name);
          console.log('[LLMService] res keys:', Object.keys(res).slice(0, 15).join(', '));
          console.log('[LLMService] res.content type:', typeof res.content);
          console.log('[LLMService] res.content value:', res.content);
        }
        this.emitLog('system', { message: `visionModel.invoke() completed. res type: ${typeof res}, null? ${res == null}` });
      } catch (err: any) {
        console.error('[LLMService] Vision model invoke CAUGHT ERROR:', err);
        console.error('[LLMService] Error type:', typeof err, 'Error name:', err?.name);
        this.emitLog('error', { message: `Vision model invoke error: ${err.message}` });
        this.emitLog('error', { message: `Error stack: ${err.stack?.substring(0, 500)}` });
        this.emitLog('error', { message: `Error details: name=${err.name}, code=${err.code}, status=${err.status}` });
        if (err.response) {
          this.emitLog('error', { message: `Error response status: ${err.response.status}, statusText: ${err.response.statusText}` });
          this.emitLog('error', { message: `Error response data: ${JSON.stringify(err.response.data).substring(0, 500)}` });
        }
        return null;
      }

      if (!res) {
        this.emitLog('error', { message: 'Vision model returned null/undefined response.' });
        return null;
      }

      this.emitLog('system', { message: `Vision model raw response type: ${typeof res}, keys: ${Object.keys(res || {}).join(', ')}` });
      this.emitLog('system', { message: `Vision model raw response: ${JSON.stringify(res).substring(0, 500)}` });

      let txt: string;
      if (typeof res.content === 'string') {
        txt = res.content;
        this.emitLog('system', { message: 'Content is string type' });
      } else if (Array.isArray(res.content)) {
        this.emitLog('system', { message: `Content is array with ${res.content.length} items` });
        txt = res.content.map((x: any) => {
          if (typeof x === 'string') return x;
          if (x.text) return x.text;
          if (x.type === 'text' && x.text) return x.text;
          if (x.type === 'output_text' && x.text) return x.text; // responses api compat
          return JSON.stringify(x);
        }).join('\n');
      } else if (res.content && res.content.text) {
        // Some adapters return { content: { text: '...' } }
        txt = res.content.text;
      } else {
        this.emitLog('system', { message: 'Content is neither string nor array, stringifying' });
        // Some Gemini JSON-mode responses place the parsed object directly in content
        try {
          if (res && typeof res === 'object') {
            const candidate = (res as any).content ?? (res as any).additional_kwargs ?? (res as any).response_metadata;
            txt = JSON.stringify(candidate ?? res);
          } else {
            txt = String(res);
          }
        } catch (_) {
          txt = JSON.stringify(res.content);
        }
      }

      this.emitLog('system', { message: `Vision model text response: "${txt.substring(0, 300)}"` });

      // Extra salvage: if provider returns tool-like structure or JSON in additional fields
      try {
        if (!/\{\s*"indexes"\s*:/.test(txt)) {
          const asJson = (res as any).additional_kwargs?.function_call?.arguments
            || (res as any).additional_kwargs?.tool_calls?.[0]?.function?.arguments
            || (res as any).response_metadata?.output_text
            || (res as any).output_text
            || (res as any).content?.[0]?.text
            || (typeof (res as any).content?.[0] === 'string' ? (res as any).content?.[0] : undefined);
          if (asJson && typeof asJson === 'string') {
            this.emitLog('system', { message: `Found alternate text payload in metadata (first 200): ${asJson.substring(0,200)}` });
            txt = asJson;
          }
        }
      } catch (_) {}

      // If the model indicates loading/blank tiles, return empty to skip this round
      if (/loading|blank|white\s*tiles|not\s*loaded/i.test(txt)) {
        this.emitLog('system', { message: 'Vision indicated tiles not fully loaded; skipping this round.' });
        return [];
      }
      const cleaned = (txt || '')
        .replace(/^```json\n?/, '')
        .replace(/^```\n?/, '')
        .replace(/\n?```$/, '')
        .replace(/^[\s\S]*?(\{[\s\S]*\})[\s\S]*$/, '$1')
        .trim();

      this.emitLog('system', { message: `Cleaned response for JSON parse: "${cleaned.substring(0, 300)}"` });

      let parsed: any;
      try {
        parsed = JSON.parse(cleaned);
        this.emitLog('system', { message: `JSON parsing successful: ${JSON.stringify(parsed)}` });
      } catch (parseErr: any) {
        // Try a loose regex fallback to salvage indexes
        let match = cleaned.match(/\"indexes\"\s*:\s*\[(.*?)\]/s);
        if (!match) {
          // try to parse any JSON-looking substring
          const tryJson = (cleaned.match(/\{[\s\S]*\}/) || [])[0];
          if (tryJson) {
            try {
              const tmp = JSON.parse(tryJson);
              if (Array.isArray(tmp?.indexes)) {
                this.emitLog('system', { message: 'Recovered indexes from nested JSON structure.' });
                return tmp.indexes.filter((n: any) => Number.isInteger(n));
              }
            } catch (_) {}
          }
        }
        if (match) {
          const nums = match[1]
            .split(/\s*,\s*/)
            .map((n) => parseInt(n, 10))
            .filter((n) => Number.isInteger(n));
          this.emitLog('error', { message: `JSON parse failed but salvaged indexes via regex: [${nums.join(', ')}]` });
          return nums;
        }
        this.emitLog('error', { message: `JSON parse error: ${parseErr.message}` });
        this.emitLog('error', { message: `Failed to parse: "${cleaned}"` });
        return [];
      }

      const indexes: number[] = Array.isArray(parsed.indexes) ? parsed.indexes.filter((n: any) => Number.isInteger(n)) : [];
      this.emitLog('system', { message: `Parsed tile indexes: [${indexes.join(', ')}]` });
      // Empty array means "skip" (no matching tiles), which is valid
      return Array.isArray(indexes) ? indexes : null;
    } catch (e: any) {
      this.emitLog('error', { message: `Vision choose tiles failed: ${e.message}` });
      this.emitLog('error', { message: `Stack trace: ${e.stack?.substring(0, 500)}` });
      return null;
    }
  }

  async generateText(prompt: string): Promise<string> {
    try {
      this.emitLog('system', { message: 'LLM prompt (first 300 chars): ' + prompt.substring(0,300) });
      const response = await this.model.invoke(prompt);
      if (typeof response.content === 'string') {
        this.emitLog('system', { message: 'LLM response (first 300 chars): ' + response.content.substring(0,300) });
        return response.content;
      } else if (Array.isArray(response.content)) {
        const joinedContent = response.content.map((item: any) => typeof item === 'string' ? item : JSON.stringify(item)).join('\n');
        this.emitLog('system', { message: 'LLM array response (joined, first 300 chars): ' + joinedContent.substring(0,300) });
        return joinedContent;
      }
      const stringContent = JSON.stringify(response.content);
      this.emitLog('system', { message: 'LLM unknown response (stringified, first 300 chars): ' + stringContent.substring(0,300) });
      return stringContent;
    } catch (error) {
      console.error("[LLMService] Error generating text:", error);
      this.emitLog('error', { message: `Failed to generate text from LLM: ${(error as Error).message}`});
      throw new Error("Failed to generate text from LLM.");
    }
  }

  async planAndExecute(taskDescription: string, browserController: BrowserController, logCallback?: AgentLogCallback, stopSignal?: () => boolean): Promise<any> {
    if (logCallback) this.logCallback = logCallback; // 외부에서 제공된 콜백 사용

    this.emitLog('system', { message: `Starting ReAct loop for task: ${taskDescription}` });

    let thought = "I need to understand the current page and decide the next action based on the task.";
    let observation = "Initial observation: Agent has just started. Browser is ready.";
    try {
        const initialContent = await browserController.getPageContent();
        observation += ` Current page is: ${browserController.getCurrentUrl()}. Page content (first 500 chars): ${initialContent.substring(0,500)}`;
    } catch(e) {
        observation += ` Could not get initial page content.`;
    }


    let iterationCount = 0;
    const maxIterations = 15; // 최대 반복 횟수 증가

    while (iterationCount < maxIterations) {
      if (stopSignal && stopSignal()) {
        this.emitLog('system', { message: 'Stop requested. Aborting task.' });
        return { success: false, message: 'Stopped by user' };
      }
      iterationCount++;
      this.emitLog('system', { message: `--- Iteration ${iterationCount} ---` });
      this.emitLog('thought', { thought, actionDetail: "Planning next step..." }); // Emit current thought
      // Observation은 이전 루프의 결과 또는 초기값
      this.emitLog('observation', { observation });

      const prompt = `
        You are an AI assistant performing a web automation task.
        Current Task: ${taskDescription}
        Your Role: You are to act as a diligent web automation agent. Your goal is to complete the task by interacting with the browser.

        Previous Iteration Summary:
        Thought: ${thought}
        Observation: ${observation}
        (Observation contains information about the current page state, results of previous actions, or errors.)

        Available Browser/Tool Actions (strictly follow this JSON format for the 'action' field):
        1.  {"type": "BROWSER_ACTION", "command": "navigate", "url": "<URL_TO_NAVIGATE_TO>"}
        2.  {"type": "BROWSER_ACTION", "command": "click", "selector": "<CSS_SELECTOR>"}
        3.  {"type": "BROWSER_ACTION", "command": "type", "selector": "<CSS_SELECTOR>", "text": "<TEXT_TO_TYPE>"}
        4.  {"type": "BROWSER_ACTION", "command": "getText", "selector": "<CSS_SELECTOR>", "output_variable": "<VAR_NAME>"} (Result will be in observation)
        5.  {"type": "BROWSER_ACTION", "command": "getPageContent", "output_variable": "<VAR_NAME>"} (Result will be in observation)
        6.  {"type": "BROWSER_ACTION", "command": "pressKey", "selector": "<CSS_SELECTOR_OR_BODY>", "key": "<KEY_TO_PRESS>"} (e.g., Enter, Tab, ArrowDown)
        7.  {"type": "TOOL_ACTION", "tool": "solveCaptcha", "captchaKind": "google_sorry|recaptcha_v2|hcaptcha"}
        8.  {"type": "TOOL_ACTION", "tool": "recaptchaGrid", "instruction": "<TEXT_FROM_CHALLENGE>", "tilesVariable": "<VAR_NAME_FOR_TILES_BASE64>", "select": [0,3,4], "submit": true}

        Task Completion Actions:
        9.  {"type": "FINISH", "message": "<DETAILED_REPORT_OF_TASK_COMPLETION_AND_ALL_GATHERED_INFORMATION>"}
        10.  {"type": "FAIL", "message": "<MESSAGE_DESCRIBING_FAILURE_REASON>"}

        Guidelines:
        - Analyze the <Observation> carefully to understand the current browser state and results of previous actions.
        - The observation shows you visible interactive elements with their attributes - use this to find the right selectors.
        - Formulate a <Thought> explaining your reasoning for the next step.
        - Choose an appropriate <Action> from the list above.
        - For selectors, use the exact attributes shown in the Interactive Elements section (name, id, aria-label, etc).
        - If a previous action failed (e.g., selector not found), adjust your strategy. Try different selectors from the Interactive Elements list.
        - For web searches, use Google (https://www.google.com) by default.
          * Google search box: Use input/textarea elements with name="q" or aria-label that contains "Search" or localized equivalents (e.g., "검색").
          * Type the query into the box and press Enter to submit.
          * Do NOT navigate directly to a results URL (e.g., https://www.google.com/search?q=...). Always type then press Enter to reduce bot detection.
        - After typing into a search box, always press Enter key to submit the search.
        - If CAPTCHA is detected (see Captcha Status in observation), use {"type":"TOOL_ACTION","tool":"solveCaptcha"}. For image-grid reCAPTCHA, request tiles using {"type":"TOOL_ACTION","tool":"recaptchaGrid"}.
        - Keep your thoughts concise but clear.
        - When the task is complete, use the FINISH action with a comprehensive report in the message field:
          * Include ALL information gathered (dates, schedules, important details, etc.)
          * Format the report clearly with proper structure and organization
          * Use Korean if the task was in Korean, otherwise use English
          * Make the report detailed and easy to read

        Your Response (JSON only):
        {
          "thought": "<YOUR_DETAILED_THOUGHT_PROCESS_AND_REASONING_FOR_THE_ACTION>",
          "action": <CHOSEN_ACTION_JSON_OBJECT_FROM_ABOVE_LIST>
        }
      `;

      const llmResponse = await this.generateText(prompt);
      let parsedResponse;
      try {
        const cleanedResponse = llmResponse.replace(/^```json\n?/, '').replace(/\n?```$/, '');
        parsedResponse = JSON.parse(cleanedResponse);
      } catch (e) {
        console.error("[LLMService] Failed to parse LLM response:", llmResponse, e);
        observation = `Error: LLM response was not valid JSON. Response: ${llmResponse}. Error: ${(e as Error).message}. Please ensure the response is valid JSON.`;
        thought = "The LLM response was not parsable. I need to re-evaluate and make sure the next response is in the correct JSON format.";
        this.emitLog('error', { message: observation });
        this.emitLog('thought', { thought });
        continue;
      }

      thought = parsedResponse.thought || "No thought provided by LLM.";
      const action = parsedResponse.action;

      if (!action || !action.type) {
        observation = `Error: LLM response did not contain a valid 'action' object or 'action.type'. Response: ${JSON.stringify(parsedResponse)}`;
        thought = "The LLM response was missing a valid action. I need to ensure the action object with a type is provided.";
        this.emitLog('error', { message: observation });
        this.emitLog('thought', { thought });
        continue;
      }

      this.emitLog('thought', { thought, actionDetail: JSON.stringify(action) });

      let actionError = false;
      let actionObservation = "";

      try {
        switch (action.type) {
          case "BROWSER_ACTION":
            this.emitLog('system', { message: `Executing Browser Action: ${action.command}` });
            switch (action.command) {
              case "navigate":
                if (action.url) {
                  await browserController.goTo(action.url);
                  actionObservation = `Successfully navigated to ${action.url}.`;
                } else { actionError = true; actionObservation = "Error: URL missing for navigate."; }
                break;
              case "click":
                if (action.selector) {
                  const clickSuccess = await browserController.click(action.selector);
                  actionObservation = clickSuccess ? `Clicked ${action.selector}.` : `Failed to click ${action.selector}.`;
                  if(!clickSuccess) actionError = true;
                } else { actionError = true; actionObservation = "Error: Selector missing for click."; }
                break;
              case "type":
                if (action.selector && action.text !== undefined) {
                  const typeSuccess = await browserController.type(action.selector, action.text);
                  actionObservation = typeSuccess ? `Typed '${action.text}' into ${action.selector}.` : `Failed to type into ${action.selector}.`;
                  if(!typeSuccess) actionError = true;
                } else { actionError = true; actionObservation = "Error: Selector or text missing for type."; }
                break;
              case "getText":
                if (action.selector) {
                  const text = await browserController.getText(action.selector);
                  if (text !== null) {
                    // 텍스트가 너무 길면 처음 3000자만 표시
                    const textPreview = text.length > 3000 ? text.substring(0, 3000) + `\n... (truncated, total length: ${text.length})` : text;
                    actionObservation = `Text from ${action.selector}: ${textPreview}`;
                    if (action.output_variable) actionObservation += ` (Stored in ${action.output_variable})`;
                  } else {
                    actionObservation = `Could not get text from ${action.selector}.`;
                    if (action.output_variable) actionObservation += ` (Output variable ${action.output_variable} will be null)`;
                  }
                } else { actionError = true; actionObservation = "Error: Selector missing for getText."; }
                break;
              case "getPageContent":
                const content = await browserController.getPageContent();
                // LLM이 내용을 볼 수 있도록 충분한 텍스트 포함 (최대 5000자)
                const contentPreview = content.substring(0, 5000);
                actionObservation = `Page content fetched (length: ${content.length}).\n\n=== Page Content (first 5000 chars) ===\n${contentPreview}\n=== End of Content Preview ===`;
                if (action.output_variable) actionObservation += `\n(Full content stored in ${action.output_variable})`;
                break;
              case "pressKey":
                if (action.selector && action.key) {
                  const pressSuccess = await browserController.pressKey(action.selector, action.key);
                  actionObservation = pressSuccess ? `Pressed key '${action.key}' on ${action.selector}.` : `Failed to press key on ${action.selector}.`;
                   if(!pressSuccess) actionError = true;
                } else { actionError = true; actionObservation = "Error: Selector or key missing for pressKey."; }
                break;
              default:
                actionError = true;
                actionObservation = `Error: Unknown browser command: ${action.command}`;
            }

            // Update observation with page content if action might have changed it
            if (!actionError && ["navigate", "click", "type", "pressKey"].includes(action.command)) {
              try {
                await browserController.waitForPageLoad(); // Ensure page is somewhat stable
                const currentPageContent = await browserController.getPageContent();
                const currentUrl = browserController.getCurrentUrl();
                actionObservation += ` Current URL: ${currentUrl}. Page content (first 500 chars): ${currentPageContent.substring(0, 500)}`;
              } catch (e: any) {
                actionObservation += ` Could not fetch page content after action: ${e.message}`;
              }
            }
            observation = actionObservation;
            if(actionError) this.emitLog('error', {message: observation});
            break;

          case "TOOL_ACTION":
            this.emitLog('system', { message: `Executing Tool Action: ${action.tool || '(no tool specified)'}` });
            if (action.tool === 'solveCaptcha') {
              this.emitLog('system', { message: 'solveCaptcha tool invoked. Detecting captcha type...' });
              // Decide captcha kind using current page (vision-based only)
              const sorry = await browserController.detectGoogleSorryCaptcha({ includeImage: true });
              const rec = await browserController.detectRecaptchaV2();
              this.emitLog('system', { message: `Captcha detection: google_sorry=${sorry.detected}, recaptcha_v2=${rec.detected}` });

              try {
                // Priority: reCAPTCHA v2 (more common on Google Sorry pages)
                if (rec.detected) {
                  this.emitLog('system', { message: 'reCAPTCHA v2 detected. Attempting to click anchor checkbox...' });
                  const clicked = await browserController.clickRecaptchaAnchor();
                  if (clicked) {
                    this.emitLog('system', { message: 'reCAPTCHA anchor clicked. Waiting for challenge or auto-solve...' });
                    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for challenge or auto-pass

                    // Check if challenge appeared
                    let challenge = await browserController.getRecaptchaChallenge();
                    if (challenge && challenge.gridImageBase64) {
                      this.emitLog('system', { message: `reCAPTCHA challenge appeared: ${challenge.instruction}` });
                      // Wait extra time for iframe challenge to fully render before screenshot
                      await new Promise(resolve => setTimeout(resolve, 1000));
                      await browserController.streamScreenshot('recaptcha-challenge');
                      await browserController.takeDebugScreenshot('recaptcha-challenge');

                      // Determine mode by grid size: 3x3 => progressive until no matches, 4x4 => one-shot all matches
                      // Multiple rounds handling (supports progressive 3x3 where tiles refresh)
                      let attempts = 0;
                      let lastIndexes: number[] | null = null;
                      let prevSigs: string[] | null = await browserController.getRecaptchaTileSignatures();
                      while (attempts < 8 && challenge && challenge.gridImageBase64) {
                        attempts++;
                        // Detect grid size each round to support 3x3 -> 4x4 transitions
                        const currentGridSize = (challenge as any).gridSize || 3;
                        const mode = currentGridSize === 4 ? 'ALL_AT_ONCE' : 'PROGRESSIVE';
                        this.emitLog('system', { message: `reCAPTCHA round ${attempts}: gridSize=${currentGridSize} mode=${mode}` });
                        this.emitLog('system', { message: `Calling vision model to select tiles... (round ${attempts})` });
                        this.emitLog('system', { message: `Grid image size: ${challenge.gridImageBase64.length} chars` });
                        const indexes = await this.chooseRecaptchaTiles(
                          challenge.instruction,
                          challenge.gridImageBase64,
                          (challenge as any).gridSize || 3
                        );
                        this.emitLog('system', { message: `Vision model returned indexes: ${JSON.stringify(indexes)}` });

                        if (indexes === null) {
                          actionError = true;
                          actionObservation = 'Vision model failed to select reCAPTCHA tiles.';
                          break;
                        }

                        lastIndexes = indexes;
                        if (indexes.length > 0) {
                          this.emitLog('system', { message: `Clicking tiles: [${indexes.join(', ')}]` });
                          await browserController.selectRecaptchaTiles(indexes);
                          if (mode === 'PROGRESSIVE') {
                            // 3x3: 클릭 후 자동으로 새 이미지가 교체되므로 검증(확인)은 누르지 않는다. 새 타일 로딩을 기다렸다가 다음 라운드로.
                            const newSigs = await browserController.waitForRecaptchaTilesRefresh(prevSigs, 6000);
                            if (newSigs) prevSigs = newSigs;
                            const next = await browserController.getRecaptchaChallenge();
                            if (!next || !next.gridImageBase64) break;
                            challenge = next;
                            await new Promise(r => setTimeout(r, 300));
                            continue; // 다음 라운드로
                          }
                        } else {
                          this.emitLog('system', { message: 'Vision model returned empty array (skip/no matching tiles).' });
                        }

                        // 4x4: 항상 제출, 3x3: 더 이상 매칭이 없을 때만 제출
                        if (mode === 'ALL_AT_ONCE' || indexes.length === 0) {
                          await browserController.submitRecaptchaChallenge();
                          await browserController.streamScreenshot('recaptcha-submitted');
                          await browserController.waitForPageLoad(8000);
                        }

                        // 다음 라운드 존재 여부 확인
                        const next = await browserController.getRecaptchaChallenge();
                        if (!next || !next.gridImageBase64) break;
                        this.emitLog('system', { message: 'Another reCAPTCHA round detected; continuing...' });
                        challenge = next;
                        await new Promise(r => setTimeout(r, 800));
                      }

                      // Finalize sorry page if checkbox solved
                      try {
                        const solved = await browserController.isRecaptchaSolved();
                        if (solved) await browserController.submitSorryPageIfPresent();
                      } catch (_) {}

                      const used = lastIndexes || [];
                      actionObservation = used.length > 0
                        ? `reCAPTCHA v2 handled. Last clicked tiles: [${used.join(', ')}]`
                        : `reCAPTCHA v2 submitted without tile clicks.`;
                    } else {
                      this.emitLog('system', { message: `Challenge check: gridImage=${challenge?.gridImageBase64?.length || 0} chars, instruction="${challenge?.instruction || 'none'}"` });
                      actionObservation = 'reCAPTCHA anchor clicked. Challenge may have auto-solved or is pending.';
                    }
                  } else {
                    actionError = true;
                    actionObservation = 'Failed to click reCAPTCHA anchor checkbox.';
                  }
                } else if (sorry.detected && sorry.imageBase64) {
                  // Fallback: Google Sorry image text captcha
                  this.emitLog('system', { message: 'Solving Google Sorry image captcha via vision model' });
                  const text = await this.solveCaptchaImageToText(sorry.imageBase64);
                  if (!text) {
                    actionError = true;
                    actionObservation = 'Vision model failed to extract text from captcha image.';
                  } else {
                    const typed = await browserController.typeCaptchaAndSubmit(sorry.inputSelector, text, sorry.submitSelectorCandidates || []);
                    actionObservation = typed ? `Captcha text "${text}" entered and submitted.` : 'Failed to enter/submit captcha text.';
                    if (!typed) actionError = true;
                  }
                } else if (sorry.detected && !sorry.imageBase64) {
                  actionError = true;
                  actionObservation = 'Google Sorry captcha detected but image not captured.';
                } else {
                  actionError = true;
                  actionObservation = 'No recognizable captcha detected for vision solving.';
                }
              } catch (e: any) {
                actionError = true;
                actionObservation = `Error while solving captcha via vision: ${e.message}`;
              }

              // Update observation after potential page change
              try {
                await browserController.waitForPageLoad();
                await browserController.streamScreenshot('post-tool-action');
                const currentPageContent = await browserController.getPageContent();
                const currentUrl = browserController.getCurrentUrl();
                actionObservation += ` Current URL: ${currentUrl}. Page content (first 500 chars): ${currentPageContent.substring(0, 500)}`;
              } catch (e: any) {
                actionObservation += ` Could not fetch page content after captcha solve: ${e.message}`;
              }

              observation = actionObservation;
              if (actionError) this.emitLog('error', { message: observation });
              break;
            } else if (action.tool === 'recaptchaGrid') {
              // Provide tiles to the LLM and let it choose indices based on instruction (vision-based)
              try {
                const clickedAnchor = await browserController.clickRecaptchaAnchor();
                if (!clickedAnchor) this.emitLog('system', { message: 'reCAPTCHA anchor not clicked or not present; proceeding.' });
                const challenge = await browserController.getRecaptchaChallenge();
                if (!challenge || !challenge.gridImageBase64) {
                  actionError = true;
                  actionObservation = 'No reCAPTCHA grid challenge detected.';
                } else {
                  const instruction = challenge.instruction || 'Select relevant tiles per instruction';
                  const indexes = await this.chooseRecaptchaTiles(instruction, challenge.gridImageBase64);
                  if (indexes === null) {
                    actionError = true;
                    actionObservation = 'Vision model failed to provide tile indexes.';
                  } else if (indexes.length === 0) {
                    try { await browserController.submitRecaptchaChallenge(); } catch (_) {}
                    actionObservation = 'No matching tiles found. Submitted skip.';
                  } else {
                    const clicked = await browserController.selectRecaptchaTiles(indexes);
                    if (!clicked) {
                      actionError = true;
                      actionObservation = `Failed to click tiles: [${indexes.join(',')}]`;
                    } else {
                      try { await browserController.submitRecaptchaChallenge(); } catch (_) {}
                      actionObservation = `Clicked tiles: [${indexes.join(',')}]. Submitted.`;
                    }
                  }
                }
              } catch (e: any) {
                actionError = true;
                actionObservation = `Error during reCAPTCHA grid handling: ${e.message}`;
              }

              // Update observation after potential change
              try {
                await browserController.waitForPageLoad();
                const currentPageContent = await browserController.getPageContent();
                const currentUrl = browserController.getCurrentUrl();
                actionObservation += ` Current URL: ${currentUrl}. Page content (first 500 chars): ${currentPageContent.substring(0, 500)}`;
              } catch (e: any) {
                actionObservation += ` Could not fetch page content after recaptcha grid: ${e.message}`;
              }

              observation = actionObservation;
              if (actionError) this.emitLog('error', { message: observation });
              break;
            } else {
              observation = `Error: Unknown tool action: ${action.tool}`;
              this.emitLog('error', { message: observation });
              actionError = true;
              break;
            }

          case "FINISH":
            this.emitLog('system', { message: `Task Finished: ${action.message}` });
            return { success: true, message: action.message || thought };

          case "FAIL":
            this.emitLog('error', { message: `Task Failed: ${action.message}` });
            return { success: false, message: action.message || thought };

          default:
            observation = `Error: Unknown action type from LLM: ${action.type}`;
            this.emitLog('error', { message: observation });
            thought = "The LLM provided an unknown action type. I need to use a valid action type like BROWSER_ACTION, FINISH, or FAIL.";
        }
      } catch (error: any) {
        console.error("[LLMService] Error executing action:", action, error);
        observation = `Error during ${action.type} (${action.command || 'N/A'}): ${error.message}. Stack: ${error.stack}`;
        this.emitLog('error', { message: observation });
        thought = `The previous action resulted in an error: ${error.message}. I need to re-evaluate the situation and try a different approach or a corrected action.`;
      }
    }

    const finalMessage = "Max iterations reached. Task may not be complete.";
    this.emitLog('error', { message: finalMessage });
    return { success: false, message: finalMessage };
  }
}