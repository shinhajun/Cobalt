import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage } from "@langchain/core/messages";
import { BrowserController } from "./browserController";
import { AgentTools } from "./agentTools";
// Vision-based captcha solving (no external captcha providers)
import path from 'path';
import crypto from 'crypto';

export type AgentLogCallback = (log: { type: 'thought' | 'observation' | 'system' | 'error', data: any }) => void;

// Shared action history entry
export interface ActionHistoryEntry {
  timestamp: number;
  actor: 'main_llm' | 'vision_model' | 'tool' | 'browser';
  action: string;
  details: any;
  result?: any;
  success?: boolean;
}

// Vision model cache entry
interface VisionCacheEntry {
  result: any;
  expires: number;
}

export class LLMService {
  private model: any;
  private logCallback: AgentLogCallback;
  private visionModel: any | null = null;
  private isVisionGeminiProvider: boolean = false;
  private tools: AgentTools;

  // Shared context: all actions from both LLM and Vision model
  private actionHistory: ActionHistoryEntry[] = [];

  // Vision model response cache (key: hash of domain+type+instruction, value: cached result)
  private visionCache = new Map<string, VisionCacheEntry>();
  private readonly VISION_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

  // Vision 모델 타임아웃 상수 통일
  private readonly VISION_TIMEOUTS = {
    CLASSIFY: 20000,
    INTERACT: 25000,
    CHOOSE_TILES: 25000,
    SOLVE_TEXT: 30000,
  };

  // LLM 설정
  private readonly LLM_CONFIG = {
    MAX_ITERATIONS: 15,
    PROMPT_LOG_LENGTH: 50, // 로그에 표시할 프롬프트 길이
    RESPONSE_LOG_LENGTH: 300,
    MAX_HISTORY_ENTRIES: 20, // 히스토리에 보관할 최대 액션 수
  };

  constructor(modelName: string = "gpt-5-mini", logCallback?: AgentLogCallback) {
    // Initialize tools first
    this.tools = new AgentTools();

    // 생성자 실행 시점에 환경변수 읽기 (모듈 로드 시점이 아닌)
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
    const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

    const isGemini = (name: string) => /^gemini[-\d\.]/.test(name);
    const isClaude = (name: string) => /^claude[-\d\.]/.test(name);

    console.log("[LLMService] Initializing with model:", modelName);

    if (isClaude(modelName)) {
      if (!CLAUDE_API_KEY) {
        console.error("[LLMService] CLAUDE_API_KEY not found in environment variables");
        throw new Error("[LLMService] Claude API key is not configured. Cannot initialize Claude model.");
      }
      console.log("[LLMService] Using Claude (Anthropic) provider. Model:", modelName);
      this.model = new ChatAnthropic({
        apiKey: CLAUDE_API_KEY,
        modelName: modelName,
      });
    } else if (isGemini(modelName)) {
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

    // Vision model (for image analysis: CAPTCHA, button detection, screen analysis). Defaults to gpt-5 if available.
    const visionModelName = process.env.VISION_MODEL || process.env.CAPTCHA_VISION_MODEL || 'gpt-5';
    try {
      if (isClaude(visionModelName)) {
        if (!CLAUDE_API_KEY) {
          console.warn('[LLMService] CLAUDE_API_KEY missing. Cannot initialize Claude vision model.');
          this.visionModel = null;
        } else {
          this.visionModel = new ChatAnthropic({
            apiKey: CLAUDE_API_KEY,
            modelName: visionModelName,
          });
          this.isVisionGeminiProvider = false;
          console.log('[LLMService] Vision model initialized (Claude):', visionModelName);
        }
      } else if (isGemini(visionModelName)) {
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

  // Add action to shared history
  private addToHistory(entry: ActionHistoryEntry) {
    this.actionHistory.push(entry);
    // Keep only recent entries
    if (this.actionHistory.length > this.LLM_CONFIG.MAX_HISTORY_ENTRIES) {
      this.actionHistory = this.actionHistory.slice(-this.LLM_CONFIG.MAX_HISTORY_ENTRIES);
    }
  }

  // Create cache key for vision model responses
  private createVisionCacheKey(url: string, challengeType: string, instruction: string): string {
    const domain = new URL(url).hostname;
    const hash = crypto.createHash('md5').update(instruction).digest('hex').substring(0, 8);
    return `${domain}_${challengeType}_${hash}`;
  }

  // Get cached vision response if available and not expired
  private getCachedVisionResponse(key: string): any | null {
    const cached = this.visionCache.get(key);
    if (!cached) return null;

    if (Date.now() > cached.expires) {
      // Cache expired
      this.visionCache.delete(key);
      return null;
    }

    this.emitLog('system', { message: `[VisionCache] Hit for key: ${key}` });
    return cached.result;
  }

  // Cache vision response
  private cacheVisionResponse(key: string, result: any) {
    this.visionCache.set(key, {
      result,
      expires: Date.now() + this.VISION_CACHE_TTL
    });
    this.emitLog('system', { message: `[VisionCache] Cached response for key: ${key}` });

    // Clean up expired entries periodically
    if (this.visionCache.size > 100) {
      const now = Date.now();
      for (const [k, v] of this.visionCache.entries()) {
        if (now > v.expires) {
          this.visionCache.delete(k);
        }
      }
    }
  }

  // Format history for prompts
  private formatHistoryForPrompt(): string {
    if (this.actionHistory.length === 0) {
      return 'No previous actions yet.';
    }

    const formatted = this.actionHistory.map((entry, idx) => {
      const timeAgo = Date.now() - entry.timestamp;
      const seconds = Math.floor(timeAgo / 1000);
      const statusIcon = entry.success === true ? '✓' : entry.success === false ? '✗' : '•';

      let detail = '';
      if (typeof entry.details === 'string') {
        detail = entry.details;
      } else if (entry.details) {
        detail = JSON.stringify(entry.details).substring(0, 100);
      }

      return `${idx + 1}. [${seconds}s ago] ${statusIcon} ${entry.actor}: ${entry.action} ${detail}`;
    }).join('\n');

    return `Recent Actions:\n${formatted}`;
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

  // Classify the current viewport: detect presence/type of challenge purely via vision
  private async classifyChallengeViewport(browserController: BrowserController): Promise<{ kind: 'recaptcha_grid' | 'checkbox_recaptcha' | 'text_captcha' | 'gate' | 'none'; gridSize?: 3 | 4 | null }> {
    if (!this.visionModel) return { kind: 'none' } as any;
    try {
      const { imageBase64, width, height } = await browserController.captureViewportScreenshotBase64();
      if (!imageBase64) return { kind: 'none' } as any;
      const prompt = `You will see a webpage screenshot (viewport ${width}x${height}). Determine if there is a bot-detection challenge present.\n` +
        `Return ONLY JSON in the form {"kind":"recaptcha_grid|checkbox_recaptcha|text_captcha|gate|none","gridSize":3|4|null}.\n` +
        `- recaptcha_grid: Google image grid challenge (3x3 or 4x4) with tiles to select. Set gridSize accordingly.\n` +
        `- checkbox_recaptcha: ONLY if you see a checkbox next to "I'm not a robot" text (may be custom or real reCAPTCHA).\n` +
        `- text_captcha: an image with distorted letters/numbers that must be typed.\n` +
        `- gate: other generic bot or interstitial gate (e.g., Cloudflare, continue/verify buttons).\n` +
        `- none: no challenge visible.\n` +
        `IMPORTANT: Even if it looks like reCAPTCHA style, if there's a checkbox, use checkbox_recaptcha.\n` +
        `No explanations. JSON only.`;
      const messages: any[] = [
        new HumanMessage({
          content: this.buildVisionContentParts(prompt, imageBase64, 'image/jpeg') as any
        } as any)
      ];
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error(`Vision classify timeout after ${this.VISION_TIMEOUTS.CLASSIFY}ms`)), this.VISION_TIMEOUTS.CLASSIFY));
      const res: any = await Promise.race([(this.visionModel as any).invoke(messages), timeoutPromise]).catch(() => null);
      if (!res) return { kind: 'none' } as any;
      let txt: string;
      if (typeof res.content === 'string') txt = res.content; else if (Array.isArray(res.content)) txt = res.content.map((x: any) => (typeof x === 'string' ? x : (x.text || JSON.stringify(x)))).join('\n'); else txt = JSON.stringify(res.content);
      const cleaned = (txt || '').replace(/^```json\n?/, '').replace(/```$/, '').trim();
      try {
        const m = cleaned.match(/\{[\s\S]*\}/);
        const obj = m ? JSON.parse(m[0]) : JSON.parse(cleaned);
        const kind = obj.kind || 'none';
        const gridSize = obj.gridSize ?? null;
        return { kind, gridSize } as any;
      } catch (_) {
        return { kind: 'none' } as any;
      }
    } catch (_) {
      return { kind: 'none' } as any;
    }
  }

  // Generic vision-guided interaction on the current viewport
  private async visionInteractViewport(browserController: BrowserController, instruction: string): Promise<{ success: boolean; report: string }> {
    this.emitLog('system', { message: `[VisionInteract] Starting with instruction: "${instruction}"` });
    if (!this.visionModel) {
      this.emitLog('error', { message: '[VisionInteract] Vision model not initialized!' });
      return { success: false, report: 'Vision model not initialized.' };
    }
    try {
      // If Cloudflare shows "verification success ... waiting", use common method
      try {
        if (await browserController.isCloudflareWaiting()) {
          const cleared = await browserController.waitForCloudflarePassthrough(15000);
          if (cleared) {
            return { success: true, report: 'Cloudflare gate cleared during brief wait.' };
          }
          return { success: false, report: 'Cloudflare waiting persists (not solved).' };
        }
      } catch (_) {}

      // Pre-heuristics: try obvious checkbox clicks, but skip verify/continue if instruction mentions selecting squares/tiles
      this.emitLog('system', { message: '[VisionInteract] Trying heuristics first...' });
      const isGridChallenge = /select.*square|select.*tile|click.*square|click.*tile|top.?right|top.?left|bottom.?right|bottom.?left|stop sign|traffic light|bicycle|crosswalk|bus|car|storefront|grid|captcha/i.test(instruction);

      try {
        // Only try checkbox click if not a grid challenge
        if (!isGridChallenge) {
          const checkboxClicked = await browserController.clickCheckboxLeftOfText(["i'm not a robot", 'i am not a robot', '로봇이 아닙니다', 'reCAPTCHA']);
          if (checkboxClicked) {
            await browserController.streamScreenshot('pre-vision-checkbox-heuristic');
            await new Promise(r => setTimeout(r, 400));
            this.emitLog('system', { message: '[VisionInteract] Heuristic checkbox click succeeded' });
            return { success: true, report: 'Heuristic checkbox-left-of-text click.' };
          }
          // Only try verify/continue click if not a grid challenge
          const textClicked = await browserController.clickFirstVisibleContainingText(['verify', 'continue', '확인', '계속']);
          if (textClicked) {
            await browserController.streamScreenshot('pre-vision-text-heuristic');
            await new Promise(r => setTimeout(r, 400));
            this.emitLog('system', { message: '[VisionInteract] Heuristic text click (verify/continue) succeeded' });
            return { success: true, report: 'Heuristic text click (verify/continue) performed.' };
          }
        } else {
          this.emitLog('system', { message: '[VisionInteract] Grid challenge detected, skipping heuristics to use vision model' });
        }
      } catch (_) {}

      this.emitLog('system', { message: '[VisionInteract] Heuristics failed, capturing screenshot for vision model...' });
      const { imageBase64, width, height } = await browserController.captureViewportScreenshotBase64();
      if (!imageBase64 || width === 0 || height === 0) {
        this.emitLog('error', { message: '[VisionInteract] Failed to capture screenshot' });
        return { success: false, report: 'Viewport screenshot unavailable.' };
      }
      this.emitLog('system', { message: `[VisionInteract] Screenshot captured: ${width}x${height}, base64 length: ${imageBase64.length}` });

      // Include action history for context
      const historyContext = this.formatHistoryForPrompt();

      const spec = `You will receive a screenshot (viewport ${width}x${height}).\n`+
      `Analyze the image and determine what needs to be clicked to complete the task.\n`+
      `\n`+
      `CONTEXT - What has been tried before:\n`+
      `${historyContext}\n`+
      `\n`+
      `Use this context to avoid repeating failed actions and make better decisions.\n`+
      `If previous attempts failed, try a different approach or look for Reset/Retry buttons.\n`+
      `\n`+
      `You can return MULTIPLE sequential actions or a SINGLE action.\n`+
      `Return ONLY JSON in one of these forms:\n`+
      `\n`+
      `SINGLE ACTION:\n`+
      `{"action":"click_points","points":[{"x":<px>,"y":<px>}, ...], "note":"..."}\n`+
      `{"action":"grid_click_elements","rect":{...}, "gridSize":3|4|5, "gridType":"static"|"dynamic", "indexes":[...], "note":"..."}\n`+
      `{"action":"grid_click_coords","rect":{...}, "gridSize":3|4|5, "gridType":"static"|"dynamic", "indexes":[...], "note":"..."}\n`+
      `{"action":"noop","note":"reason why no action needed"}\n`+
      `\n`+
      `MULTIPLE ACTIONS (for complex tasks like "select grid tiles then click verify"):\n`+
      `{"action":"sequence","steps":[...actions...], "note":"overall plan"}\n`+
      `Example: {"action":"sequence","steps":[{"action":"grid_click_coords","rect":{...},"gridSize":4,"gridType":"static","indexes":[2,3,6,7]},{"action":"click_points","points":[{"x":1142,"y":660}]}],"note":"Select stop signs then click Verify"}\n`+
      `\n`+
      `Use "sequence" when you need to:\n`+
      `- Select grid tiles AND then click a Verify/Submit button\n`+
      `- Click multiple different elements in order\n`+
      `- Perform any multi-step interaction\n`+

      `CRITICAL INSTRUCTIONS for image grids (like "Select all squares with Stop Sign"):\n`+
      `\n`+
      `STEP 1: COUNT THE GRID SIZE ACCURATELY\n`+
      `- Look at the grid lines/borders that divide the image into squares\n`+
      `- Count HORIZONTAL lines: If you see 3 horizontal dividing lines (creating 4 horizontal sections), it's 4 rows\n`+
      `- Count VERTICAL lines: If you see 3 vertical dividing lines (creating 4 vertical sections), it's 4 columns\n`+
      `- 3 dividing lines = 4 tiles, 2 dividing lines = 3 tiles, 4 dividing lines = 5 tiles\n`+
      `- COMMON ERROR: Counting tiles as 3x3 when it's actually 4x4. Look at the LINES, not just the squares!\n`+
      `- If you count 4 rows and 4 columns, that means 16 total tiles (4x4), NOT 9 tiles (3x3)\n`+
      `- Verify: 3x3=9 tiles, 4x4=16 tiles, 5x5=25 tiles\n`+
      `\n`+
      `STEP 2: MEASURE THE GRID RECTANGLE\n`+
      `- Identify the exact pixel coordinates of the entire grid area (x, y, width, height)\n`+
      `- The rect should encompass ALL grid tiles from top-left to bottom-right corner\n`+
      `\n`+
      `STEP 3: DETECT GRID TYPE\n`+
      `- "static": Select all matching tiles at once, then click verify (images don't change when clicked)\n`+
      `- "dynamic": Click tiles one by one, new images appear after each click (typically reCAPTCHA)\n`+
      `- Look for hints: "Select all" = static, "Click verify once there are none left" = dynamic\n`+
      `\n`+
      `STEP 4: IDENTIFY MATCHING TILES\n`+
      `- Stop Sign: Red octagonal (8-sided) sign with white text "STOP" - very distinctive shape\n`+
      `  * IMPORTANT: Only select tiles where the stop sign is CLEARLY and PROMINENTLY visible\n`+
      `  * If stop sign pole extends into tile but the actual sign is NOT in that tile, DO NOT select it\n`+
      `  * Only count tiles that contain the actual red octagonal sign, not just the pole/post\n`+
      `- Traffic Light: Vertical lights (red, yellow, green) in a box\n`+
      `- Bicycle: Two-wheeled vehicle with handlebars\n`+
      `- Crosswalk: White striped pedestrian crossing on road\n`+
      `- Bus: Large public transport vehicle\n`+
      `- Car/Vehicle: Automobiles on road\n`+
      `- Be EXTREMELY STRICT: Only select tiles where the PRIMARY OBJECT is clearly visible\n`+
      `- Do NOT select tiles that only show edges, poles, or minor parts of the object\n`+
      `- When in doubt, DO NOT select the tile\n`+
      `\n`+
      `STEP 5: RETURN CORRECT INDEXES\n`+
      `- Use 0-based row-major order (left-to-right, top-to-bottom)\n`+
      `- 3x3 grid (9 tiles): [0,1,2] [3,4,5] [6,7,8]\n`+
      `- 4x4 grid (16 tiles): [0,1,2,3] [4,5,6,7] [8,9,10,11] [12,13,14,15]\n`+
      `- Example: If Stop Sign appears in top-right 4 tiles of a 4x4 grid, indexes are [2,3,6,7]\n`+
      `- DOUBLE-CHECK: Count your indexes - if gridSize=4 and you have 4 matching tiles in top-right, they should be 2,3,6,7 (NOT 4,5)\n`+
      `\n`+
      `STEP 6: CHOOSE CLICKING METHOD\n`+
      `- Use "grid_click_elements" if tiles have visible borders/buttons (DOM elements)\n`+
      `- Use "grid_click_coords" if grid appears as one image divided into sections\n`+

      `IMPORTANT for checkboxes:\n`+
      `- Look for a small square box (usually 15-30px) next to "I'm not a robot" text\n`+
      `- The checkbox is typically on the LEFT side of the text\n`+
      `- Provide the exact center coordinates of the checkbox square\n`+
      `- Do NOT click on the text, click on the checkbox box itself\n`+

      `Measure coordinates very carefully from the top-left corner (0,0) of the image.\n`+
      `Be extremely precise with coordinates and grid measurements.`;

      const textPrompt = `Goal: ${instruction}\n${spec}`;

      // Check cache before calling vision model
      const currentUrl = browserController.getCurrentUrl();
      const cacheKey = this.createVisionCacheKey(currentUrl, 'interact', instruction);
      const cached = this.getCachedVisionResponse(cacheKey);

      let json: any = null;

      if (cached) {
        // Use cached response
        json = cached;
        this.emitLog('system', { message: `[VisionCache] Using cached response for ${cacheKey}` });
      } else {
        // Call vision model
        const messages: any[] = [
          new HumanMessage({
            content: this.buildVisionContentParts(textPrompt, imageBase64, 'image/jpeg') as any
          } as any)
        ];

        this.emitLog('system', { message: 'Invoking vision model for generic viewport interaction...' });
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error(`Vision interact timeout after ${this.VISION_TIMEOUTS.INTERACT}ms`)), this.VISION_TIMEOUTS.INTERACT));
        const res: any = await Promise.race([(this.visionModel as any).invoke(messages), timeoutPromise]).catch((e: any) => {
          this.emitLog('error', { message: `Vision interaction error: ${e.message}` });
          return null;
        });
        if (!res) return { success: false, report: 'No response from vision.' };

        let txt: string;
        if (typeof res.content === 'string') txt = res.content; else if (Array.isArray(res.content)) txt = res.content.map((x: any) => (typeof x === 'string' ? x : (x.text || JSON.stringify(x)))).join('\n'); else txt = JSON.stringify(res.content);

        // Log the vision model's raw response for debugging
        this.emitLog('system', { message: `Vision model response (first 300 chars): ${txt.substring(0, 300)}` });

        try {
          const raw = (txt || '').replace(/^```json\n?/, '').replace(/```$/, '').trim();
          const m = raw.match(/\{[\s\S]*\}/);
          json = m ? JSON.parse(m[0]) : JSON.parse(raw);

          // Cache the parsed JSON response
          if (json && json.action) {
            this.cacheVisionResponse(cacheKey, json);
          }
        } catch (parseError: any) {
          this.emitLog('error', { message: `Failed to parse vision response as JSON: ${parseError.message}. Raw text: ${txt.substring(0, 200)}` });
          return { success: false, report: 'Failed to parse vision response as JSON.' };
        }
      }

      if (!json || !json.action) {
        this.emitLog('error', { message: `Vision response missing 'action' field. JSON: ${JSON.stringify(json).substring(0, 200)}` });
        return { success: false, report: 'No actionable JSON returned.' };
      }

      // Handle sequence action (multiple steps)
      if (json.action === 'sequence' && Array.isArray(json.steps)) {
        this.emitLog('system', { message: `Vision returned sequence with ${json.steps.length} steps. Note: ${json.note || 'N/A'}` });

        // Record sequence start
        this.addToHistory({
          timestamp: Date.now(),
          actor: 'vision_model',
          action: 'sequence_start',
          details: { steps: json.steps.length, note: json.note },
        });

        for (let i = 0; i < json.steps.length; i++) {
          const step = json.steps[i];
          this.emitLog('system', { message: `[Sequence] Executing step ${i+1}/${json.steps.length}: ${step.action}` });

          // Recursively handle each step by processing it as a single action
          const stepResult = await this.executeVisionAction(browserController, step, instruction);

          if (!stepResult.success) {
            this.emitLog('error', { message: `[Sequence] Step ${i+1} failed: ${stepResult.report}` });
            this.addToHistory({
              timestamp: Date.now(),
              actor: 'vision_model',
              action: 'sequence_failed',
              details: { step: i+1, reason: stepResult.report },
              success: false,
            });
            return { success: false, report: `Sequence failed at step ${i+1}: ${stepResult.report}` };
          }

          // Wait between steps
          await new Promise(r => setTimeout(r, 300));
        }

        this.addToHistory({
          timestamp: Date.now(),
          actor: 'vision_model',
          action: 'sequence_completed',
          details: { steps: json.steps.length, note: json.note },
          success: true,
        });

        return { success: true, report: `Completed ${json.steps.length} step sequence. Note: ${json.note || 'N/A'}` };
      }

      // Execute single action
      const result = await this.executeVisionAction(browserController, json, instruction);

      // Record the action
      this.addToHistory({
        timestamp: Date.now(),
        actor: 'vision_model',
        action: json.action,
        details: json,
        result: result.report,
        success: result.success,
      });

      return result;
    } catch (e: any) {
      return { success: false, report: `Vision interaction failed: ${e.message}` };
    }
  }

  // Helper method to execute a single vision action
  private async executeVisionAction(browserController: BrowserController, json: any, instruction: string): Promise<{ success: boolean; report: string }> {
    try {
      if (json.action === 'click_points' && Array.isArray(json.points)) {
        this.emitLog('system', { message: `Vision identified ${json.points.length} click points: ${JSON.stringify(json.points)}. Note: ${json.note || 'N/A'}` });
        let n = 0;
        for (const p of json.points) {
          if (typeof p?.x === 'number' && typeof p?.y === 'number') {
            await browserController.clickViewport(Math.round(p.x), Math.round(p.y));
            await browserController.streamScreenshot('post-vision-click');
            await new Promise(r => setTimeout(r, 200));
            n++;
          }
        }
        return { success: n > 0, report: `Clicked ${n} points. Note: ${json.note || 'N/A'}` };
      }

      // Handle grid_click_elements action (AI chooses element-based clicking)
      if (json.action === 'grid_click_elements' && json.rect && Array.isArray(json.indexes) && (json.gridSize === 3 || json.gridSize === 4 || json.gridSize === 5)) {
        const gridType = json.gridType || 'static'; // Default to static for backward compatibility
        this.emitLog('system', { message: `Vision chose ELEMENT-based grid click: type=${gridType}, size=${json.gridSize}, rect=(${json.rect.x},${json.rect.y},${json.rect.width}x${json.rect.height}), indexes=${JSON.stringify(json.indexes)}` });

        const rect = {
          x: Math.max(0, Math.round(json.rect.x)),
          y: Math.max(0, Math.round(json.rect.y)),
          width: Math.max(10, Math.round(json.rect.width)),
          height: Math.max(10, Math.round(json.rect.height)),
        };
        const indexes = json.indexes.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n));

        let success = false;
        if (gridType === 'dynamic') {
          const result = await browserController.clickGridDynamic(rect, json.gridSize, indexes, instruction, 'elements');
          success = result.success;
          this.emitLog('system', { message: `[DynamicGrid] Clicked ${result.clickCount} tiles total` });
        } else {
          success = await browserController.clickGridStatic(rect, json.gridSize, indexes, 'elements');
        }

        await browserController.streamScreenshot('post-vision-grid-click-elements');
        await new Promise(r => setTimeout(r, 500));
        return { success, report: `Grid click (elements, ${gridType}) gridSize=${json.gridSize} indexes=${JSON.stringify(json.indexes)}. Note: ${json.note || 'N/A'}` };
      }

      // Handle grid_click_coords action (AI chooses coordinate-based clicking)
      if (json.action === 'grid_click_coords' && json.rect && Array.isArray(json.indexes) && (json.gridSize === 3 || json.gridSize === 4 || json.gridSize === 5)) {
        const gridType = json.gridType || 'static'; // Default to static for backward compatibility
        this.emitLog('system', { message: `Vision chose COORDINATE-based grid click: type=${gridType}, size=${json.gridSize}, rect=(${json.rect.x},${json.rect.y},${json.rect.width}x${json.rect.height}), indexes=${JSON.stringify(json.indexes)}` });

        const rect = {
          x: Math.max(0, Math.round(json.rect.x)),
          y: Math.max(0, Math.round(json.rect.y)),
          width: Math.max(10, Math.round(json.rect.width)),
          height: Math.max(10, Math.round(json.rect.height)),
        };
        const indexes = json.indexes.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n));

        let success = false;
        if (gridType === 'dynamic') {
          const result = await browserController.clickGridDynamic(rect, json.gridSize, indexes, instruction, 'coordinates');
          success = result.success;
          this.emitLog('system', { message: `[DynamicGrid] Clicked ${result.clickCount} tiles total` });
        } else {
          success = await browserController.clickGridStatic(rect, json.gridSize, indexes, 'coordinates');
        }

        await browserController.streamScreenshot('post-vision-grid-click-coords');
        await new Promise(r => setTimeout(r, 500));
        return { success, report: `Grid click (coords, ${gridType}) gridSize=${json.gridSize} indexes=${JSON.stringify(json.indexes)}. Note: ${json.note || 'N/A'}` };
      }

      // Legacy support for old grid_click action (falls back to auto-detect method)
      if (json.action === 'grid_click' && json.rect && Array.isArray(json.indexes) && (json.gridSize === 3 || json.gridSize === 4 || json.gridSize === 5)) {
        this.emitLog('system', { message: `Vision identified grid (legacy): size=${json.gridSize}, rect=(${json.rect.x},${json.rect.y},${json.rect.width}x${json.rect.height}), indexes=${JSON.stringify(json.indexes)}` });
        await browserController.clickRectGrid({
          x: Math.max(0, Math.round(json.rect.x)),
          y: Math.max(0, Math.round(json.rect.y)),
          width: Math.max(10, Math.round(json.rect.width)),
          height: Math.max(10, Math.round(json.rect.height)),
        }, json.gridSize, json.indexes.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n)));
        await browserController.streamScreenshot('post-vision-grid-click');
        await new Promise(r => setTimeout(r, 500));
        return { success: true, report: `Grid click gridSize=${json.gridSize} indexes=${JSON.stringify(json.indexes)}. Note: ${json.note || 'N/A'}` };
      }

      if (json.action === 'noop') {
        return { success: true, report: json.note || 'Noop' };
      }
      return { success: false, report: 'Unsupported action from vision.' };
    } catch (e: any) {
      return { success: false, report: `Vision interaction failed: ${e.message}` };
    }
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
      const messages: any = [
        new HumanMessage({
          content: this.buildVisionContentParts(instruction, imageBase64, 'image/png') as any
        } as any)
      ];

      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Vision model timeout after ${this.VISION_TIMEOUTS.SOLVE_TEXT}ms`)), this.VISION_TIMEOUTS.SOLVE_TEXT)
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
      const combined = `${systemPrompt}\n\nInstruction: ${instruction}`;
      const messages: any[] = [
        new HumanMessage({
          // Grid is captured as JPEG in BrowserController
          content: this.buildVisionContentParts(combined, gridImageBase64, 'image/jpeg') as any
        } as any)
      ];

      this.emitLog('system', { message: 'Invoking vision model for tile selection...' });

      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Vision model timeout after ${this.VISION_TIMEOUTS.CHOOSE_TILES}ms`)), this.VISION_TIMEOUTS.CHOOSE_TILES)
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
      // 프롬프트 로깅 최적화 (50자만)
      this.emitLog('system', { message: 'LLM prompt (first 50 chars): ' + prompt.substring(0, this.LLM_CONFIG.PROMPT_LOG_LENGTH) + '...' });
      const response = await this.model.invoke(prompt);
      if (typeof response.content === 'string') {
        this.emitLog('system', { message: 'LLM response (first 300 chars): ' + response.content.substring(0, this.LLM_CONFIG.RESPONSE_LOG_LENGTH) });
        return response.content;
      } else if (Array.isArray(response.content)) {
        // Handle array responses - extract text from content blocks
        const textParts: string[] = [];
        for (const item of response.content) {
          if (typeof item === 'string') {
            textParts.push(item);
          } else if (item && typeof item === 'object') {
            // Handle structured content blocks like {"type":"text","text":"..."}
            if (item.type === 'text' && item.text) {
              textParts.push(item.text);
            } else if (item.text) {
              textParts.push(item.text);
            } else {
              // Fallback: stringify other object types
              textParts.push(JSON.stringify(item));
            }
          }
        }
        const joinedContent = textParts.join('\n');
        this.emitLog('system', { message: 'LLM array response (joined, first 300 chars): ' + joinedContent.substring(0, this.LLM_CONFIG.RESPONSE_LOG_LENGTH) });
        return joinedContent;
      }
      const stringContent = JSON.stringify(response.content);
      this.emitLog('system', { message: 'LLM unknown response (stringified, first 300 chars): ' + stringContent.substring(0, this.LLM_CONFIG.RESPONSE_LOG_LENGTH) });
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
    let consecutiveCaptchaFailures = 0; // Track consecutive CAPTCHA solving failures

    while (iterationCount < this.LLM_CONFIG.MAX_ITERATIONS) {
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

        Browser Actions:
        1.  {"type": "BROWSER_ACTION", "command": "navigate", "url": "<URL_TO_NAVIGATE_TO>"}
        2.  {"type": "BROWSER_ACTION", "command": "click", "selector": "<CSS_SELECTOR>"}
        3.  {"type": "BROWSER_ACTION", "command": "clickCoordinates", "x": <X_PIXEL>, "y": <Y_PIXEL>} - Click at specific coordinates (use when elements have position info)
        4.  {"type": "BROWSER_ACTION", "command": "type", "selector": "<CSS_SELECTOR>", "text": "<TEXT_TO_TYPE>"}
        5.  {"type": "BROWSER_ACTION", "command": "getText", "selector": "<CSS_SELECTOR>", "output_variable": "<VAR_NAME>"}
        6.  {"type": "BROWSER_ACTION", "command": "getPageContent", "output_variable": "<VAR_NAME>"}
        7.  {"type": "BROWSER_ACTION", "command": "pressKey", "selector": "<CSS_SELECTOR_OR_BODY>", "key": "<KEY_TO_PRESS>"}

        Multi-Tab Actions:
        8.  {"type": "BROWSER_ACTION", "command": "createNewTab", "url": "<OPTIONAL_URL>"} - Open a new browser tab
        9.  {"type": "BROWSER_ACTION", "command": "switchTab", "tabId": "<TAB_ID>"} - Switch to a specific tab
        10. {"type": "BROWSER_ACTION", "command": "closeTab", "tabId": "<TAB_ID>"} - Close a specific tab
        11. {"type": "BROWSER_ACTION", "command": "listTabs"} - List all open tabs with their IDs and URLs
        12. {"type": "BROWSER_ACTION", "command": "getActiveTabId"} - Get the currently active tab ID

        CAPTCHA/Challenge Tools:
        7.  {"type": "TOOL_ACTION", "tool": "solveCaptcha"}
        8.  {"type": "TOOL_ACTION", "tool": "recaptchaGrid", "instruction": "<TEXT_FROM_CHALLENGE>"}
        9.  {"type": "TOOL_ACTION", "tool": "visionInteract", "instruction": "<WHAT_TO_SOLVE_ON_SCREEN>"}
        10. {"type": "TOOL_ACTION", "tool": "findElement", "instruction": "<WHAT_TO_FIND_AND_CLICK>"} - Use vision to find and click elements when selectors fail

        Utility Tools:
        11. {"type": "TOOL_ACTION", "tool": "calculate", "expression": "<MATH_EXPRESSION>"} - Calculate math (e.g., "3*5+2")
        12. {"type": "TOOL_ACTION", "tool": "storeMemory", "key": "<KEY>", "value": "<VALUE>"} - Store info for later
        13. {"type": "TOOL_ACTION", "tool": "retrieveMemory", "key": "<KEY>"} - Recall stored info
        14. {"type": "TOOL_ACTION", "tool": "listMemory"} - List all stored keys
        15. {"type": "TOOL_ACTION", "tool": "getCurrentDateTime", "format": "full|date|time"} - Get current date/time
        16. {"type": "TOOL_ACTION", "tool": "calculateDateDiff", "date1": "<ISO_DATE>", "date2": "<ISO_DATE>"} - Calculate days between dates
        17. {"type": "TOOL_ACTION", "tool": "extractNumbers", "text": "<TEXT>"} - Extract all numbers from text
        18. {"type": "TOOL_ACTION", "tool": "extractEmails", "text": "<TEXT>"} - Extract email addresses
        19. {"type": "TOOL_ACTION", "tool": "extractURLs", "text": "<TEXT>"} - Extract URLs from text
        20. {"type": "TOOL_ACTION", "tool": "formatAsTable", "data": [{"col1":"val1"},...]} - Format data as markdown table
        21. {"type": "TOOL_ACTION", "tool": "formatAsJSON", "data": <ANY>, "pretty": true} - Format as JSON

        Task Completion Actions:
        22. {"type": "FINISH", "message": "<DETAILED_REPORT_OF_TASK_COMPLETION_AND_ALL_GATHERED_INFORMATION>"}
        22. {"type": "FAIL", "message": "<MESSAGE_DESCRIBING_FAILURE_REASON>"}

        Guidelines:
        - Analyze the <Observation> carefully to understand the current browser state and results of previous actions.
        - The observation shows you visible interactive elements with their attributes - use this to find the right selectors.
        - Formulate a <Thought> explaining your reasoning for the next step.
        - Choose an appropriate <Action> from the list above.

        Smart Tool Usage:
        - Use utility tools to process information (calculate, extract, format)
        - Store important information in memory using storeMemory so you don't lose it
        - Retrieve stored info when needed instead of re-navigating
        - Use getCurrentDateTime for any time-related tasks
        - Use calculate for any math instead of trying to do it yourself
        - Use extract tools (extractNumbers, extractEmails, extractURLs) to parse text efficiently
        - Format final reports using formatAsTable or formatAsJSON for better readability

        Browser Actions:
        - For selectors, use the exact attributes shown in the Interactive Elements section (name, id, aria-label, etc).
        - **IMPORTANT: When Interactive Elements show position info (x=..., y=...), use clickCoordinates instead of click for better reliability**
        - If a previous action failed (e.g., selector not found), try clickCoordinates with the x,y values from Interactive Elements
        - After typing into a search box, always press Enter key to submit the search.
        - For dynamic pages where elements detach from DOM, always prefer clickCoordinates over click

        CAPTCHA/Cloudflare Handling:
        - **CRITICAL: When you see reCAPTCHA elements or CAPTCHA-related text in the page content:**
          * IMMEDIATELY use {"type":"TOOL_ACTION","tool":"solveCaptcha"} - DO NOT try manual clicking
          * The solveCaptcha tool will automatically detect and solve reCAPTCHA, image grids, and text CAPTCHAs
          * DO NOT click on reCAPTCHA iframes or checkboxes manually - let solveCaptcha handle it
          * If solveCaptcha fails 3 times in a row, use FAIL action (site has strong bot detection)

        - **IMPORTANT: If you see captcha_status=cloudflare_waiting:**
          * This is a Cloudflare security check that the system is handling automatically in the background.
          * For the FIRST occurrence: wait by using getPageContent and check again.
          * For the SECOND occurrence: wait again with getPageContent.
          * For the THIRD occurrence: wait one more time with getPageContent.
          * For the FOURTH occurrence or more: Use FAIL action as Cloudflare cannot be bypassed.
          * Count how many times you've seen cloudflare_waiting in your thought process.

        Visual Challenge Solving (Advanced):
        - Only use visionInteract for CUSTOM/non-standard image challenges (not reCAPTCHA)
        - When you see instructions like "Select all squares with [object]", this is likely reCAPTCHA - use solveCaptcha instead
        - visionInteract is for unusual challenges on specific websites that solveCaptcha doesn't handle

        Web Searching:
        - For web searches, use Google (https://www.google.com) by default.
        - Google search box: Use input/textarea elements with name="q" or aria-label that contains "Search" or localized equivalents (e.g., "검색").
        - Type the query into the box and press Enter to submit.
        - Do NOT navigate directly to a results URL (e.g., https://www.google.com/search?q=...). Always type then press Enter to reduce bot detection.

        Click Verification:
        - After clicking, the system automatically takes a screenshot and checks if URL changed
        - If URL unchanged after click, the element may not have been clicked properly - try different selector or coordinates
        - Check the observation message for "Page changed" or "Page URL unchanged" to verify click success
        - If a click should open a new page but URL is unchanged, the click likely failed - try alternative approach

        Using findElement Tool:
        - **CRITICAL: When standard selectors fail to find an element (e.g., "Element not found for click"), use findElement tool**
        - findElement uses vision AI to locate and click elements based on visual description
        - Example: If clicking 'a[aria-label="Blank document"]' fails, use {"type":"TOOL_ACTION","tool":"findElement","instruction":"Find and click the Blank document button"}
        - The tool will take a screenshot, identify the element visually, and click it
        - Use findElement for complex UIs where DOM selectors don't work (Google Docs, dynamic web apps, etc.)

        Task Completion:
        - Keep your thoughts concise but clear.
        - When the task is complete, use the FINISH action with a comprehensive report in the message field:
          * Include ALL information gathered (dates, schedules, important details, etc.)
          * Use tools like formatAsTable or formatAsJSON to make the report well-structured
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
                  const urlBefore = browserController.getCurrentUrl();
                  const clickSuccess = await browserController.click(action.selector);

                  if (clickSuccess) {
                    actionObservation = `Clicked ${action.selector}.`;

                    // Wait for potential page change and take screenshot to verify
                    await browserController.waitForPageLoad(3000);
                    await browserController.streamScreenshot('after-click');

                    const urlAfter = browserController.getCurrentUrl();
                    if (urlBefore !== urlAfter) {
                      actionObservation += ` Page changed: ${urlBefore} → ${urlAfter}`;
                      this.emitLog('system', { message: `Click caused navigation: ${urlBefore} → ${urlAfter}` });
                    } else {
                      actionObservation += ` Page URL unchanged (may be same-page action or modal).`;
                    }
                  } else {
                    actionObservation = `Failed to click ${action.selector}.`;
                    actionError = true;
                  }
                } else { actionError = true; actionObservation = "Error: Selector missing for click."; }
                break;
              case "clickCoordinates":
                if (typeof action.x === 'number' && typeof action.y === 'number') {
                  const urlBefore = browserController.getCurrentUrl();
                  const clickSuccess = await browserController.clickViewport(action.x, action.y);

                  if (clickSuccess) {
                    actionObservation = `Clicked at coordinates (${action.x}, ${action.y}).`;

                    // Wait for potential page change and take screenshot to verify
                    await browserController.waitForPageLoad(3000);
                    await browserController.streamScreenshot('after-click-coords');

                    const urlAfter = browserController.getCurrentUrl();
                    if (urlBefore !== urlAfter) {
                      actionObservation += ` Page changed: ${urlBefore} → ${urlAfter}`;
                      this.emitLog('system', { message: `Click caused navigation: ${urlBefore} → ${urlAfter}` });
                    } else {
                      actionObservation += ` Page URL unchanged (may be same-page action or modal).`;
                    }
                  } else {
                    actionObservation = `Failed to click at coordinates (${action.x}, ${action.y}).`;
                    actionError = true;
                  }
                } else { actionError = true; actionObservation = "Error: x and y coordinates missing for clickCoordinates."; }
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

              // Multi-tab actions
              case "createNewTab":
                try {
                  const newTabId = await browserController.createNewTab(action.url);
                  actionObservation = `Created new tab: ${newTabId}`;
                  if (action.url) {
                    actionObservation += ` and navigated to ${action.url}`;
                  }
                } catch (e: any) {
                  actionError = true;
                  actionObservation = `Failed to create new tab: ${e.message}`;
                }
                break;

              case "switchTab":
                if (action.tabId) {
                  const switchSuccess = await browserController.switchTab(action.tabId);
                  if (switchSuccess) {
                    const currentUrl = browserController.getCurrentUrl();
                    actionObservation = `Switched to tab ${action.tabId}. Current URL: ${currentUrl}`;
                  } else {
                    actionError = true;
                    actionObservation = `Failed to switch to tab ${action.tabId} (tab not found)`;
                  }
                } else { actionError = true; actionObservation = "Error: tabId missing for switchTab."; }
                break;

              case "closeTab":
                if (action.tabId) {
                  const closeSuccess = await browserController.closeTab(action.tabId);
                  if (closeSuccess) {
                    actionObservation = `Closed tab ${action.tabId}`;
                  } else {
                    actionError = true;
                    actionObservation = `Failed to close tab ${action.tabId}`;
                  }
                } else { actionError = true; actionObservation = "Error: tabId missing for closeTab."; }
                break;

              case "listTabs":
                try {
                  const tabs = await browserController.listTabs();
                  actionObservation = `Open tabs (${tabs.length}):\n`;
                  for (const tab of tabs) {
                    actionObservation += `  - ${tab.active ? '★' : ' '} ${tab.id}: ${tab.title} (${tab.url})\n`;
                  }
                } catch (e: any) {
                  actionError = true;
                  actionObservation = `Failed to list tabs: ${e.message}`;
                }
                break;

              case "getActiveTabId":
                try {
                  const activeTabId = browserController.getActiveTabId();
                  actionObservation = `Currently active tab: ${activeTabId}`;
                } catch (e: any) {
                  actionError = true;
                  actionObservation = `Failed to get active tab ID: ${e.message}`;
                }
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
              this.emitLog('system', { message: 'solveCaptcha tool invoked. Classifying challenge via vision...' });
              // Vision-first classification (URL-independent)
              const classified = await this.classifyChallengeViewport(browserController);
              this.emitLog('system', { message: `Challenge classification: kind=${classified.kind}, gridSize=${classified.gridSize || 'n/a'}` });

              try {
                // Priority: reCAPTCHA v2 (more common on Google Sorry pages)
                if (classified.kind === 'checkbox_recaptcha' || classified.kind === 'recaptcha_grid') {
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
                      let progressiveNoMatchStreak = 0; // For 3x3 progressive: require consecutive no-match before submit
                      let visionNullStreak = 0; // Count consecutive null results from vision
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
                        this.emitLog('system', { message: `Vision model returned indexes: ${JSON.stringify(indexes)}` });

                        if (indexes === null) {
                          visionNullStreak++;
                          this.emitLog('system', { message: `Vision returned null indexes (streak=${visionNullStreak}). Treating as temporary no-match.` });
                          // Treat as empty to trigger progressive stability check on 3x3
                          indexes = [];
                        } else {
                          visionNullStreak = 0;
                        }

                        lastIndexes = indexes;
                        if (indexes.length > 0) {
                          this.emitLog('system', { message: `Clicking tiles: [${indexes.join(', ')}]` });
                          await browserController.selectRecaptchaTiles(indexes);
                          if (mode === 'PROGRESSIVE') {
                            // 3x3: 클릭 후 자동으로 새 이미지가 교체되므로 검증(확인)은 누르지 않는다. 새 타일 로딩을 기다렸다가 다음 라운드로.
                            const newSigs = await browserController.waitForRecaptchaTilesRefresh(prevSigs, 6000);
                            if (newSigs) prevSigs = newSigs;
                            progressiveNoMatchStreak = 0; // reset streak since we just clicked some tiles
                            const next = await browserController.getRecaptchaChallenge();
                            if (!next || !next.gridImageBase64) break;
                            challenge = next;
                            await new Promise(r => setTimeout(r, 300));
                            continue; // 다음 라운드로
                          }
                        } else {
                          this.emitLog('system', { message: 'Vision model returned empty array (skip/no matching tiles).' });
                        }

                        // 제출 조건
                        if (mode === 'ALL_AT_ONCE') {
                          // 4x4: 한 번에 모두 클릭 후 바로 제출
                          await browserController.submitRecaptchaChallenge();
                          await browserController.streamScreenshot('recaptcha-submitted');
                          await browserController.waitForPageLoad(8000);
                        } else {
                          // 3x3: '없음'을 연속으로 확인해야 제출
                          if (indexes.length === 0) {
                            // 안정성 체크: 타일이 더 이상 갱신되지 않는지 짧게 확인
                            try {
                              await browserController.waitForRecaptchaTilesLoaded(0.95, 2000);
                            } catch (_) {}
                            const sigsA = await browserController.getRecaptchaTileSignatures();
                            await new Promise(r => setTimeout(r, 700));
                            const sigsB = await browserController.getRecaptchaTileSignatures();
                            const stable = Array.isArray(sigsA) && Array.isArray(sigsB) && sigsA.length === sigsB.length && sigsA.every((s, i) => s === sigsB[i]);
                            if (stable) {
                              progressiveNoMatchStreak++;
                              this.emitLog('system', { message: `3x3 no-match stable check passed. Streak=${progressiveNoMatchStreak}` });
                            } else {
                              progressiveNoMatchStreak = 0;
                              this.emitLog('system', { message: '3x3 no-match not stable (tiles changed). Re-evaluating next round.' });
                            }

                            // If vision kept returning null multiple times, relax threshold to avoid infinite loop
                            const threshold = visionNullStreak >= 2 ? 1 : 2;
                            if (progressiveNoMatchStreak >= threshold) {
                              await browserController.submitRecaptchaChallenge();
                              await browserController.streamScreenshot('recaptcha-submitted');
                              await browserController.waitForPageLoad(8000);
                            } else {
                              // 다시 한 번 분석 라운드 실행
                              const next = await browserController.getRecaptchaChallenge();
                              if (!next || !next.gridImageBase64) break;
                              challenge = next;
                              await new Promise(r => setTimeout(r, 300));
                              continue;
                            }
                          }
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
                    // Fallback: Not a real reCAPTCHA frame (e.g., custom checkbox like neal.fun).
                    this.emitLog('system', { message: 'reCAPTCHA anchor not found. This is a custom challenge (not real reCAPTCHA). Using direct click approach.' });

                    // 먼저 스크린샷 찍어서 live view 업데이트
                    await browserController.streamScreenshot('custom-checkbox-challenge');

                    // 1차: Vision 우선 (가장 확실하고 빠름)
                    let clicked = false;
                    this.emitLog('system', { message: 'Using vision to find and click checkbox.' });
                    const res = await this.visionInteractViewport(browserController, 'Find and click the checkbox or clickable area next to "I\'m not a robot" text. Click on the checkbox square or the entire checkbox area.');
                    clicked = res.success;
                    if (clicked) {
                      this.emitLog('system', { message: `Vision click successful: ${res.report}` });
                    }

                    // 2차: heuristic 방식 (텍스트 왼쪽 영역)
                    if (!clicked) {
                      this.emitLog('system', { message: 'Vision failed, trying heuristic click.' });
                      clicked = await browserController.clickCheckboxLeftOfText(["i'm not a robot", 'i am not a robot', '로봇이 아닙니다', 'not a robot', 'checkbox']);
                    }

                    // 3차: 텍스트 포함 요소 클릭
                    if (!clicked) {
                      this.emitLog('system', { message: 'Heuristic failed, trying text-based click.' });
                      clicked = await browserController.clickFirstVisibleContainingText(["not a robot", "i'm not a robot", "checkbox", "recaptcha"]);
                    }

                    if (clicked) {
                      actionObservation = 'Custom checkbox clicked successfully.';
                      await browserController.waitForPageLoad(3000);
                    } else {
                      actionObservation = 'Failed to click checkbox via all methods.';
                      actionError = true;
                    }
                  }
                } else if (classified.kind === 'text_captcha') {
                  // Text-based captcha: crop not yet implemented; rely on viewport OCR first
                  this.emitLog('system', { message: 'Text captcha detected. Attempting direct OCR on viewport image.' });
                  const { imageBase64 } = await browserController.captureViewportScreenshotBase64();
                  const text = await this.solveCaptchaImageToText(imageBase64);
                  if (!text) {
                    actionError = true;
                    actionObservation = 'Vision model failed to extract text from captcha image.';
                  } else {
                    // Best-effort: try common input/submit without URL selectors
                    const typed = await browserController.typeCaptchaAndSubmit(undefined as any, text, []);
                    actionObservation = typed ? `Captcha text "${text}" entered and submitted.` : 'Failed to enter/submit captcha text.';
                    if (!typed) actionError = true;
                  }
                } else if (classified.kind === 'gate') {
                  // Generic gate: use common Cloudflare waiting method
                  try {
                    if (await browserController.isCloudflareWaiting()) {
                      const cleared = await browserController.waitForCloudflarePassthrough(60000);
                      actionObservation = cleared ? 'Gate waiting pass-through completed.' : 'Gate waiting timed out without clearance.';
                      if (!cleared) actionError = true;
                    } else {
                      const res = await this.visionInteractViewport(browserController, 'Pass the gate or continue/verify to proceed.');
                      actionObservation = `Gate handled via vision: ${res.report}`;
                      if (!res.success) actionError = true;
                    }
                  } catch (_e) {
                    const res = await this.visionInteractViewport(browserController, 'Pass the gate or continue/verify to proceed.');
                    actionObservation = `Gate handled via vision: ${res.report}`;
                    if (!res.success) actionError = true;
                  }
                  } else {
                    // Unknown/none: try generic vision interaction; if no progress, try textual click heuristic
                    const res = await this.visionInteractViewport(browserController, 'If a challenge is present, solve it to proceed. Click obvious buttons like I\'m not a robot / Verify / Continue.');
                    actionObservation = `Generic vision attempt: ${res.report}`;
                    if (!res.success) {
                      try {
                        const clicked = await browserController.clickFirstVisibleContainingText(['i\'m not a robot', 'i am not a robot', 'verify', 'continue', 'checkbox', 'reCAPTCHA']);
                        if (clicked) {
                          actionObservation += ' | Heuristic text click performed.';
                        } else {
                          actionError = true;
                        }
                      } catch (_) {
                        actionError = true;
                      }
                    }
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

                // Check if still on CAPTCHA/sorry page after solving attempt
                const stillOnCaptchaPage = currentUrl.includes('/sorry/index') ||
                                          currentUrl.includes('sorry?continue') ||
                                          currentPageContent.includes('비정상적인 트래픽') ||
                                          currentPageContent.includes('unusual traffic');

                if (stillOnCaptchaPage && !actionError) {
                  // We tried to solve CAPTCHA but we're still on the CAPTCHA page
                  actionError = true;
                  actionObservation += ' | WARNING: Still on CAPTCHA page after solve attempt. CAPTCHA not bypassed.';
                  this.emitLog('error', { message: 'solveCaptcha did not advance past CAPTCHA page.' });
                }
              } catch (e: any) {
                actionObservation += ` Could not fetch page content after captcha solve: ${e.message}`;
              }

              observation = actionObservation;

              // Track consecutive CAPTCHA failures
              if (actionError) {
                consecutiveCaptchaFailures++;
                this.emitLog('error', { message: observation });
                this.emitLog('system', { message: `CAPTCHA failure count: ${consecutiveCaptchaFailures}/3` });

                // If 3 consecutive CAPTCHA failures, stop trying
                if (consecutiveCaptchaFailures >= 3) {
                  this.emitLog('error', { message: 'CAPTCHA failed 3 times in a row. Site has strong bot detection. Stopping task.' });
                  return {
                    success: false,
                    message: 'Task failed: Unable to bypass CAPTCHA after 3 attempts. The website has detected automation and is blocking access.'
                  };
                }
              } else {
                // Reset counter on success
                consecutiveCaptchaFailures = 0;
              }
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
            } else if (action.tool === 'visionInteract') {
              // Generic vision-driven interaction for arbitrary bot challenges
              try {
                const goal = action.instruction || 'Solve the current challenge/gate to continue.';
                const result = await this.visionInteractViewport(browserController, goal);
                actionObservation = `VisionInteract: ${result.report}`;
                if (!result.success) actionError = true;
              } catch (e: any) {
                actionError = true;
                actionObservation = `Error during visionInteract: ${e.message}`;
              }
              // Post-state update
              try {
                await browserController.waitForPageLoad();
                await browserController.streamScreenshot('post-vision-interact');
                const currentPageContent = await browserController.getPageContent();
                const currentUrl = browserController.getCurrentUrl();
                actionObservation += ` Current URL: ${currentUrl}. Page content (first 500 chars): ${currentPageContent.substring(0, 500)}`;
              } catch (e: any) {
                actionObservation += ` Could not fetch page content after visionInteract: ${e.message}`;
              }
              observation = actionObservation;
              if (actionError) this.emitLog('error', { message: observation });
              break;
            } else if (action.tool === 'findElement') {
              // Vision-based element locator for when standard selectors fail
              try {
                const instruction = action.instruction || 'Find and click the target element';
                this.emitLog('system', { message: `[findElement] Instruction: ${instruction}` });

                // Use visionInteractViewport but with simpler instruction format
                const result = await this.visionInteractViewport(browserController, instruction);
                actionObservation = `findElement: ${result.report}`;
                if (!result.success) actionError = true;

                // Wait for potential page change and verify
                await browserController.waitForPageLoad(3000);
                const urlAfter = browserController.getCurrentUrl();
                actionObservation += ` | URL after: ${urlAfter}`;

                // Take screenshot to verify the action
                await browserController.streamScreenshot('post-findElement');
              } catch (e: any) {
                actionError = true;
                actionObservation = `Error during findElement: ${e.message}`;
              }
              observation = actionObservation;
              if (actionError) this.emitLog('error', { message: observation });
              break;
            }
            // NEW UTILITY TOOLS
            else if (action.tool === 'calculate') {
              try {
                const result = await this.tools.calculate(action.expression);
                if (result.success) {
                  actionObservation = `Calculation result: ${action.expression} = ${result.result}`;
                } else {
                  actionError = true;
                  actionObservation = `Calculation failed: ${result.error}`;
                }
              } catch (e: any) {
                actionError = true;
                actionObservation = `Error during calculation: ${e.message}`;
              }
              observation = actionObservation;
              if (actionError) this.emitLog('error', { message: observation });
              break;
            } else if (action.tool === 'storeMemory') {
              try {
                const result = await this.tools.storeMemory(action.key, action.value);
                if (result.success) {
                  actionObservation = `Memory stored: ${action.key} = ${JSON.stringify(action.value).substring(0, 100)}`;
                } else {
                  actionError = true;
                  actionObservation = `Failed to store memory: ${result.error}`;
                }
              } catch (e: any) {
                actionError = true;
                actionObservation = `Error storing memory: ${e.message}`;
              }
              observation = actionObservation;
              if (actionError) this.emitLog('error', { message: observation });
              break;
            } else if (action.tool === 'retrieveMemory') {
              try {
                const result = await this.tools.retrieveMemory(action.key);
                if (result.success) {
                  actionObservation = `Memory retrieved: ${action.key} = ${JSON.stringify(result.result)}`;
                } else {
                  actionError = true;
                  actionObservation = `Failed to retrieve memory: ${result.error}`;
                }
              } catch (e: any) {
                actionError = true;
                actionObservation = `Error retrieving memory: ${e.message}`;
              }
              observation = actionObservation;
              if (actionError) this.emitLog('error', { message: observation });
              break;
            } else if (action.tool === 'listMemory') {
              try {
                const result = await this.tools.listMemory();
                if (result.success) {
                  actionObservation = `Stored memory keys: ${JSON.stringify(result.result)}`;
                } else {
                  actionError = true;
                  actionObservation = `Failed to list memory: ${result.error}`;
                }
              } catch (e: any) {
                actionError = true;
                actionObservation = `Error listing memory: ${e.message}`;
              }
              observation = actionObservation;
              if (actionError) this.emitLog('error', { message: observation });
              break;
            } else if (action.tool === 'getCurrentDateTime') {
              try {
                const result = await this.tools.getCurrentDateTime(action.format);
                if (result.success) {
                  actionObservation = `Current date/time: ${result.result.formatted} (ISO: ${result.result.iso})`;
                } else {
                  actionError = true;
                  actionObservation = `Failed to get date/time: ${result.error}`;
                }
              } catch (e: any) {
                actionError = true;
                actionObservation = `Error getting date/time: ${e.message}`;
              }
              observation = actionObservation;
              if (actionError) this.emitLog('error', { message: observation });
              break;
            } else if (action.tool === 'calculateDateDiff') {
              try {
                const result = await this.tools.calculateDateDiff(action.date1, action.date2);
                if (result.success) {
                  actionObservation = `Date difference: ${result.result.days} days, ${result.result.hours} hours (total: ${result.result.totalHours} hours)`;
                } else {
                  actionError = true;
                  actionObservation = `Failed to calculate date difference: ${result.error}`;
                }
              } catch (e: any) {
                actionError = true;
                actionObservation = `Error calculating date difference: ${e.message}`;
              }
              observation = actionObservation;
              if (actionError) this.emitLog('error', { message: observation });
              break;
            } else if (action.tool === 'extractNumbers') {
              try {
                const result = await this.tools.extractNumbers(action.text);
                if (result.success) {
                  actionObservation = `Extracted numbers: ${JSON.stringify(result.result)}`;
                } else {
                  actionError = true;
                  actionObservation = `Failed to extract numbers: ${result.error}`;
                }
              } catch (e: any) {
                actionError = true;
                actionObservation = `Error extracting numbers: ${e.message}`;
              }
              observation = actionObservation;
              if (actionError) this.emitLog('error', { message: observation });
              break;
            } else if (action.tool === 'extractEmails') {
              try {
                const result = await this.tools.extractEmails(action.text);
                if (result.success) {
                  actionObservation = `Extracted emails: ${JSON.stringify(result.result)}`;
                } else {
                  actionError = true;
                  actionObservation = `Failed to extract emails: ${result.error}`;
                }
              } catch (e: any) {
                actionError = true;
                actionObservation = `Error extracting emails: ${e.message}`;
              }
              observation = actionObservation;
              if (actionError) this.emitLog('error', { message: observation });
              break;
            } else if (action.tool === 'extractURLs') {
              try {
                const result = await this.tools.extractURLs(action.text);
                if (result.success) {
                  actionObservation = `Extracted URLs: ${JSON.stringify(result.result)}`;
                } else {
                  actionError = true;
                  actionObservation = `Failed to extract URLs: ${result.error}`;
                }
              } catch (e: any) {
                actionError = true;
                actionObservation = `Error extracting URLs: ${e.message}`;
              }
              observation = actionObservation;
              if (actionError) this.emitLog('error', { message: observation });
              break;
            } else if (action.tool === 'formatAsTable') {
              try {
                const result = await this.tools.formatAsTable(action.data, action.columns);
                if (result.success) {
                  actionObservation = `Formatted as table:\n${result.result}`;
                } else {
                  actionError = true;
                  actionObservation = `Failed to format as table: ${result.error}`;
                }
              } catch (e: any) {
                actionError = true;
                actionObservation = `Error formatting as table: ${e.message}`;
              }
              observation = actionObservation;
              if (actionError) this.emitLog('error', { message: observation });
              break;
            } else if (action.tool === 'formatAsJSON') {
              try {
                const result = await this.tools.formatAsJSON(action.data, action.pretty !== false);
                if (result.success) {
                  actionObservation = `Formatted as JSON:\n${result.result}`;
                } else {
                  actionError = true;
                  actionObservation = `Failed to format as JSON: ${result.error}`;
                }
              } catch (e: any) {
                actionError = true;
                actionObservation = `Error formatting as JSON: ${e.message}`;
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

  // Simple chat method for direct questions
  async chat(messages: Array<{ role: string; content: string }>): Promise<string> {
    try {
      const response = await this.model.invoke(messages.map(m => {
        if (m.role === 'user') {
          return new HumanMessage(m.content);
        }
        return m;
      }));

      return response.content;
    } catch (error: any) {
      console.error('[LLMService] Error in chat:', error);
      throw error;
    }
  }

  // Chat with tool calling support
  async chatWithTools(messages: Array<{ role: string; content: string }>, tools: any[]): Promise<any> {
    try {
      const modelWithTools = this.model.bind({ tools });

      const response = await modelWithTools.invoke(messages.map(m => {
        if (m.role === 'user') {
          return new HumanMessage(m.content);
        }
        return m;
      }));

      // Parse tool calls from response
      const toolCalls = response.tool_calls || response.additional_kwargs?.tool_calls || [];

      return {
        content: response.content,
        toolCalls: toolCalls.map((tc: any) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name || tc.function?.name,
            arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args || tc.function?.arguments || {})
          }
        }))
      };
    } catch (error: any) {
      console.error('[LLMService] Error in chatWithTools:', error);
      throw error;
    }
  }
}