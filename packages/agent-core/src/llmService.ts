import { ChatOpenAI } from "@langchain/openai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { BrowserController } from "./browserController";
// Vision-based captcha solving (no external captcha providers)
import path from 'path';

export type AgentLogCallback = (log: { type: 'thought' | 'observation' | 'system' | 'error', data: any }) => void;

export class LLMService {
  private model: BaseChatModel;
  private logCallback: AgentLogCallback;
  private visionModel: BaseChatModel | null = null;
  private initPromise: Promise<void>;

  constructor(modelName: string = "gpt-5-mini", logCallback?: AgentLogCallback) {
    console.log("[LLMService] Initializing with model:", modelName);
    this.logCallback = logCallback || (() => {}); // 기본값은 아무것도 안 하는 함수

    // Gemini 모델인지 확인
    const isGemini = modelName.startsWith('gemini');

    // UI 표시용 모델명을 실제 API 모델명으로 매핑
    const normalizeGeminiModelName = (name: string): string => {
      const lower = name.trim().toLowerCase();
      if (lower === 'gemini 2.5 pro' || lower === 'gemini-2.5-pro') return 'gemini-2.5-pro';
      if (lower === 'gemini 2.5 flash' || lower === 'gemini-2.5-flash') return 'gemini-2.5-flash';
      if (lower === 'gemini 2.5 flashlite' || lower === 'gemini-2.5-flash-lite' || lower === 'gemini-2.5-flash lite') return 'gemini-2.5-flash-lite';
      return name; // 그대로 사용
    };

    const effectiveModelName = isGemini ? normalizeGeminiModelName(modelName) : modelName;

    if (isGemini) {
      // Google Gemini 모델 사용 (dynamic import)
      const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

      if (!GOOGLE_API_KEY) {
        console.error("[LLMService] GOOGLE_API_KEY not found in environment variables");
        throw new Error(
          "[LLMService] Google API key is not configured. Cannot initialize Gemini model."
        );
      }

      console.log("[LLMService] Using Gemini model");
      console.log("[LLMService] API key loaded:", GOOGLE_API_KEY.substring(0, 20) + "...");

      // Dynamic import for Gemini - 초기화를 promise로 저장
      this.initPromise = this.initializeGeminiModel(GOOGLE_API_KEY, effectiveModelName)
        .then(() => {
          console.log('[LLMService] Gemini model initialized:', effectiveModelName);
        })
        .catch((err) => {
          console.error('[LLMService] Gemini init failed:', err);
          // 폴백: OpenAI로 전환 시도 (성공 시 에러를 재던지지 않음)
          const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
          if (OPENAI_API_KEY) {
            try {
              this.model = new ChatOpenAI({
                apiKey: OPENAI_API_KEY,
                modelName: 'gpt-5-mini',
                timeout: 15000,
              });
              console.warn('[LLMService] Falling back to OpenAI gpt-5-mini due to Gemini init failure');
              return; // 성공적으로 폴백했으므로 resolve 처리
            } catch (e) {
              console.error('[LLMService] OpenAI fallback init failed:', e);
            }
          }
          // 폴백 불가한 경우에만 에러 전파
          throw err;
        });

      // 임시 더미 모델 (초기화 완료될 때까지)
      this.model = {} as BaseChatModel;
    } else {
      // OpenAI 모델 사용
      const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

      if (!OPENAI_API_KEY) {
        console.error("[LLMService] OPENAI_API_KEY not found in environment variables");
        console.error("[LLMService] Available env keys:", Object.keys(process.env).filter(k => k.includes('OPENAI')));
        throw new Error(
          "[LLMService] OpenAI API key is not configured. Cannot initialize LLMService."
        );
      }

      console.log("[LLMService] Using OpenAI model");
      console.log("[LLMService] API key loaded:", OPENAI_API_KEY.substring(0, 20) + "...");

      this.model = new ChatOpenAI({
        apiKey: OPENAI_API_KEY,
        modelName: modelName,
        timeout: 15000,
      });

      this.initPromise = Promise.resolve();
    }

    // Vision model (for image-based captcha). Defaults to gpt-5 if available.
    const visionModelNameRaw = process.env.CAPTCHA_VISION_MODEL || 'gpt-5';
    const visionModelName = visionModelNameRaw.startsWith('gemini') ? normalizeGeminiModelName(visionModelNameRaw) : visionModelNameRaw;
    const isVisionGemini = visionModelName.startsWith('gemini');

    if (isVisionGemini) {
      // Gemini Vision 모델 사용
      const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
      if (GOOGLE_API_KEY) {
        this.initializeGeminiVisionModel(GOOGLE_API_KEY, visionModelName).then(() => {
          console.log('[LLMService] Gemini Vision model initialized:', visionModelName);
        }).catch(() => {
          console.warn('[LLMService] Failed to initialize Gemini Vision model');
        });
      } else {
        this.visionModel = null;
        console.warn('[LLMService] Google API key not found. Gemini Vision model disabled.');
      }
    } else {
      // OpenAI Vision 모델 사용
      const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
      if (OPENAI_API_KEY) {
        try {
          this.visionModel = new ChatOpenAI({
            apiKey: OPENAI_API_KEY,
            modelName: visionModelName,
            timeout: 20000,
          });
          console.log('[LLMService] OpenAI Vision model initialized:', visionModelName);
        } catch (e) {
          this.visionModel = null;
          console.warn('[LLMService] Failed to initialize OpenAI Vision model');
        }
      } else {
        this.visionModel = null;
        console.warn('[LLMService] OpenAI API key not found. Vision model disabled.');
      }
    }
  }

  private emitLog(type: 'thought' | 'observation' | 'system' | 'error', data: any) {
    this.logCallback({ type, data });
  }

  private async initializeGeminiModel(apiKey: string, modelName: string): Promise<void> {
    try {
      // @ts-ignore - Dynamic import for optional Gemini support
      const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
      this.model = new ChatGoogleGenerativeAI({
        apiKey: apiKey,
        modelName: modelName,
        maxOutputTokens: 8192,
      }) as BaseChatModel;
    } catch (e) {
      console.error("[LLMService] Failed to load Gemini module:", e);
      throw new Error("Failed to initialize Gemini model. Please ensure @langchain/google-genai is installed.");
    }
  }

  private async initializeGeminiVisionModel(apiKey: string, modelName: string): Promise<void> {
    try {
      // @ts-ignore - Dynamic import for optional Gemini support
      const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
      this.visionModel = new ChatGoogleGenerativeAI({
        apiKey: apiKey,
        modelName: modelName,
        maxOutputTokens: 8192,
        temperature: 0,
      }) as BaseChatModel;
    } catch (e) {
      console.error("[LLMService] Failed to load Gemini vision module:", e);
      this.visionModel = null;
    }
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
      const content: any = [
        { type: 'text', text: instruction },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } }
      ];

      // Wrap as a user message for maximum compatibility across LangChain versions
      const messages: any = [
        { role: 'user', content },
        // Some LangChain/OpenAI adapters expect a system message first; provide a minimal one.
        { role: 'system', content: [{ type: 'text', text: 'You are an assistant that outputs strict JSON only.' }] }
      ];

      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Vision model timeout after 40s')), 40000)
      );

      const res: any = await Promise.race([
        (this.visionModel as any).invoke(messages),
        timeoutPromise
      ]).catch((err: Error) => {
        this.emitLog('error', { message: `Vision model invoke error: ${err.message}, stack: ${err.stack?.substring(0, 200)}` });
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
  private async chooseRecaptchaTiles(
    instruction: string,
    gridImageBase64: string,
    gridSize: number = 3,
    modelOverride?: BaseChatModel
  ): Promise<number[] | null> {
    const activeModel = (modelOverride as any) || (this.visionModel as any);
    if (!activeModel) {
      this.emitLog('error', { message: 'Vision model not initialized for reCAPTCHA tile selection.' });
      return null;
    }
    try {
      this.emitLog('system', { message: `Vision model analyzing grid image (${gridImageBase64.length} chars) for instruction: "${instruction}"` });
      const systemPrompt = `You are assisting with a Google reCAPTCHA image grid challenge.

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

Respond with JSON ONLY. Use this exact schema: {"indexes":[<zero or more integers>]}. Do not include comments or extra keys. Use 0-based indexing with maximum index ${gridSize === 4 ? 15 : 8}. If no tiles match, return {"indexes":[]}.

Examples:
- If tiles 0, 1, 4 contain the object: {"indexes":[0,1,4]}
- If no tiles match: {"indexes":[]}

No explanation, only JSON.`;

      // Message builders (try multiple shapes for cross-provider compatibility)
      const buildMessagesVariant1 = () => [
        new SystemMessage(systemPrompt),
        new HumanMessage({
          content: [
            { type: 'text', text: `Instruction: ${instruction}` },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${gridImageBase64}` } }
          ] as any
        } as any)
      ];

      const buildMessagesVariant2 = () => [
        new SystemMessage(systemPrompt),
        new HumanMessage({
          content: [
            { type: 'text', text: `Instruction: ${instruction}` },
            { type: 'image_url', image_url: `data:image/png;base64,${gridImageBase64}` }
          ] as any
        } as any)
      ];

      // v3: No system message; single human message with text + image_url (object.url)
      const buildMessagesVariant3 = () => [
        new HumanMessage({
          content: [
            { type: 'text', text: `${systemPrompt}\n\nInstruction: ${instruction}` },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${gridImageBase64}` } }
          ] as any
        } as any)
      ];

      // v4: Google-style inline image bytes (if supported by adapter)
      const buildMessagesVariant4 = () => [
        new HumanMessage({
          content: [
            { type: 'text', text: `${systemPrompt}\n\nInstruction: ${instruction}` },
            { type: 'input_image', mime_type: 'image/png', data: gridImageBase64 } as any
          ] as any
        } as any)
      ];

      this.emitLog('system', { message: 'Invoking vision model for tile selection...' });

      // Add timeout to prevent hanging
      const timeoutMs = gridSize === 4 ? 45000 : 35000;
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Vision model timeout after ${timeoutMs}ms`)), timeoutMs)
      );

      let res: any;
      try {
        this.emitLog('system', { message: 'Calling visionModel.invoke()...' });
        console.log('[LLMService] About to call visionModel.invoke()');
        console.log('[LLMService] Vision model type:', typeof this.visionModel);
        // Try variant 1
        let messages = buildMessagesVariant1();
        console.log('[LLMService] Message structure (v1):', JSON.stringify((messages[1] as any).content?.[0] || {}).substring(0, 200));
        res = await Promise.race([
          activeModel.invoke(messages),
          timeoutPromise
        ]);

        // If null/undefined, try variant 2 (image_url as string)
        if (!res) {
          this.emitLog('system', { message: 'Primary vision call returned null. Retrying with alternate message shape (v2).' });
          messages = buildMessagesVariant2();
          console.log('[LLMService] Message structure (v2):', JSON.stringify((messages[1] as any).content?.[0] || {}).substring(0, 200));
          res = await Promise.race([
            activeModel.invoke(messages),
            timeoutPromise
          ]);
        }

        // If still null/undefined, try variant 3 (human only; object.url form)
        if (!res) {
          this.emitLog('system', { message: 'Vision call still null. Retrying with alternate message shape (v3 - human only).' });
          messages = buildMessagesVariant3();
          console.log('[LLMService] Message structure (v3):', JSON.stringify((messages[0] as any).content?.[0] || {}).substring(0, 200));
          res = await Promise.race([
            activeModel.invoke(messages),
            timeoutPromise
          ]);
        }

        // If still null/undefined, try variant 4 (inline bytes)
        if (!res) {
          this.emitLog('system', { message: 'Vision call still null. Retrying with alternate message shape (v4 - inline image bytes).' });
          messages = buildMessagesVariant4();
          console.log('[LLMService] Message structure (v4):', JSON.stringify((messages[0] as any).content?.[1] || {}).substring(0, 200));
          res = await Promise.race([
            activeModel.invoke(messages),
            timeoutPromise
          ]);
        }

        console.log('[LLMService] visionModel.invoke() returned:', typeof res);
        this.emitLog('system', { message: 'visionModel.invoke() completed successfully' });
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
        txt = JSON.stringify(res.content);
      }

      this.emitLog('system', { message: `Vision model text response: "${txt.substring(0, 300)}"` });

      // If the model indicates loading/blank tiles, return empty to skip this round
      if (/loading|blank|white\s*tiles|not\s*loaded|image\s*not\s*loaded|wait\s*for\s*tiles/i.test(txt)) {
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
        const match = cleaned.match(/\"indexes\"\s*:\s*\[(.*?)\]/s);
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
      // Gemini 모델 초기화 대기
      await this.initPromise;

      this.emitLog('system', { message: 'LLM prompt (first 300 chars): ' + prompt.substring(0,300) });
      const response = await this.model.invoke(prompt);
      if (typeof response.content === 'string') {
        this.emitLog('system', { message: 'LLM response (first 300 chars): ' + response.content.substring(0,300) });
        return response.content;
      } else if (Array.isArray(response.content)) {
        const joinedContent = response.content.map(item => typeof item === 'string' ? item : JSON.stringify(item)).join('\n');
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
        - You ARE allowed to analyze any text included in the <Observation> and previous content previews (e.g., results of getPageContent/getText). Use that text to extract facts and compose the final report without requiring extra actions when sufficient.
        - If the current page likely contains the needed data but it is not visible yet, first try: clicking the most relevant result link, then use getPageContent or getText on main/content/article containers (e.g., 'main', '#content', 'article').
        - Never claim you cannot analyze content. If information is insufficient, attempt one more reasonable action to fetch the content; otherwise provide best-effort findings and clearly state limitations.
        - When the task is complete, use the FINISH action with a comprehensive report in the message field (WRITE THE REPORT IN ENGLISH):
          * Include ALL information gathered (dates, schedules, important details, etc.)
          * Include direct links (full URLs) to sources used so the user can verify
          * If an image or screenshot was referenced, mention it and include the page URL where it was captured
          * Organize the report clearly: Summary, Steps Taken, Findings, References
          * Make the report concise, readable, and professional in English

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
                        let indexes = await this.chooseRecaptchaTiles(
                          challenge.instruction,
                          challenge.gridImageBase64,
                          (challenge as any).gridSize || 3
                        );
                        // If still null after message-shape retries, attempt per-tile analysis with Gemini
                        if (indexes === null) {
                          try {
                            const per = await browserController.getRecaptchaTilesBase64Ordered();
                            if (per && per.tiles.length > 0) {
                              this.emitLog('system', { message: `Per-tile analysis path: ${per.tiles.length} tiles captured` });
                              const perTilePrompt = `You are given ${per.gridSize}x${per.gridSize} reCAPTCHA tiles as separate images (0-based row-major). Instruction: ${challenge.instruction}\nReturn JSON only: {"indexes":[...]} with tiles containing the requested object. If none match, return {"indexes":[]}.`;
                              // Build messages: interleave text and images
                              const perMessages: any = [new SystemMessage('Return JSON only as {"indexes":[...]}.')];
                              const parts: any[] = [{ type: 'text', text: perTilePrompt }];
                              for (let i = 0; i < per.tiles.length; i++) {
                                parts.push({ type: 'text', text: `Tile ${i}:` });
                                parts.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${per.tiles[i]}` } });
                              }
                              perMessages.push(new HumanMessage({ content: parts } as any));
                              const timeoutMs = (per.gridSize === 4) ? 50000 : 40000;
                              const timeoutPromise2 = new Promise((_, reject) => setTimeout(() => reject(new Error(`Vision model timeout after ${timeoutMs}ms (per-tile)`)), timeoutMs));
                              let perRes: any = await Promise.race([
                                (this.visionModel as any).invoke(perMessages),
                                timeoutPromise2
                              ]).catch(() => null);
                              if (perRes) {
                                let txt2 = typeof perRes.content === 'string' ? perRes.content : JSON.stringify(perRes.content);
                                const cleaned2 = (txt2 || '')
                                  .replace(/^```json\n?/, '')
                                  .replace(/^```\n?/, '')
                                  .replace(/\n?```$/, '')
                                  .replace(/^[\s\S]*?(\{[\s\S]*\})[\s\S]*$/, '$1')
                                  .trim();
                                try {
                                  const parsed2 = JSON.parse(cleaned2);
                                  if (Array.isArray(parsed2.indexes)) {
                                    const arr = parsed2.indexes.filter((n: any) => Number.isInteger(n));
                                    indexes = arr as number[];
                                    this.emitLog('system', { message: `Per-tile parsed indexes: [${arr.join(', ')}]` });
                                  }
                                } catch (_) {
                                  // ignore
                                }
                              }
                            }
                          } catch (e: any) {
                            this.emitLog('error', { message: `Per-tile analysis error: ${e.message}` });
                          }
                        }
                        // No OpenAI fallback: user requested Gemini-only. We already try alt message shapes above.
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