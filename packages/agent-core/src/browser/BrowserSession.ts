import { CDPSession, Page, BrowserContext } from 'playwright';
import { EventEmitter } from 'events';

/**
 * Target ID from CDP
 */
export type TargetID = string;

/**
 * Session ID from CDP
 */
export type SessionID = string;

/**
 * CDP Session information
 */
export interface CDPSessionInfo {
  targetId: TargetID;
  sessionId: SessionID;
  cdpSession: CDPSession;
  createdAt: number;
  lastUsedAt: number;
}

/**
 * Agent focus information
 */
export interface AgentFocus {
  targetId: TargetID | null;
  sessionId: SessionID | null;
  page: Page | null;
}

/**
 * BrowserSession manages CDP sessions and targets
 *
 * This class is responsible for:
 * - CDP session pooling and reuse
 * - Target management (pages, iframes)
 * - Automatic reconnection on connection errors
 * - Agent focus tracking (current active target)
 *
 * Inspired by browser-use's BrowserSession architecture
 */
export class BrowserSession extends EventEmitter {
  // CDP session pool: targetId -> session info
  private _cdpSessionPool: Map<TargetID, CDPSessionInfo> = new Map();

  // Current agent focus (which target/page we're working on)
  private _agentFocus: AgentFocus = {
    targetId: null,
    sessionId: null,
    page: null,
  };

  // Browser context from Playwright
  private context: BrowserContext;

  // Current main page
  private currentPage: Page | null = null;

  // Session timeout (30 seconds of inactivity)
  private readonly SESSION_TIMEOUT = 30000;

  // Cleanup interval (check every 10 seconds)
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(context: BrowserContext, initialPage: Page) {
    super();
    this.context = context;
    this.currentPage = initialPage;

    // Set initial agent focus to the first page
    this._agentFocus = {
      targetId: 'main', // Placeholder for main page
      sessionId: null,
      page: initialPage,
    };

    // Start cleanup interval
    this.startCleanup();
  }

  /**
   * Get or create a CDP session for a target
   *
   * @param targetId Target ID (optional, uses current page if not provided)
   * @param focus Whether to set this as the agent focus
   * @param newSocket Whether to create a new CDP session (force reconnect)
   * @returns CDP session information
   */
  async getOrCreateCDPSession(
    targetId?: TargetID,
    focus: boolean = true,
    newSocket: boolean = false
  ): Promise<CDPSessionInfo> {
    // Use current target if not provided
    const actualTargetId = targetId || this._agentFocus.targetId || 'main';

    // Check if we have a cached session and it's not expired
    if (!newSocket && this._cdpSessionPool.has(actualTargetId)) {
      const sessionInfo = this._cdpSessionPool.get(actualTargetId)!;

      // Check if session is still valid (not timed out)
      const now = Date.now();
      if (now - sessionInfo.lastUsedAt < this.SESSION_TIMEOUT) {
        sessionInfo.lastUsedAt = now;

        if (focus) {
          this._agentFocus = {
            targetId: actualTargetId,
            sessionId: sessionInfo.sessionId,
            page: this.currentPage,
          };
        }

        return sessionInfo;
      } else {
        // Session expired, remove from pool
        console.log(`[BrowserSession] CDP session expired for target ${actualTargetId}`);
        await this.disconnectSession(actualTargetId);
      }
    }

    // Create new CDP session
    const page = this.getPageForTarget(actualTargetId);
    const cdpSession = await page.context().newCDPSession(page);

    const sessionInfo: CDPSessionInfo = {
      targetId: actualTargetId,
      sessionId: `session_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      cdpSession,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    };

    // Store in pool
    this._cdpSessionPool.set(actualTargetId, sessionInfo);
    console.log(`[BrowserSession] Created new CDP session for target ${actualTargetId}`);

    // Set as agent focus if requested
    if (focus) {
      this._agentFocus = {
        targetId: actualTargetId,
        sessionId: sessionInfo.sessionId,
        page,
      };
    }

    return sessionInfo;
  }

  /**
   * Get the page for a target ID
   * For now, we support main page only. Can be extended for multi-target support.
   */
  private getPageForTarget(targetId: TargetID): Page {
    // For simplicity, return current page
    // In a full implementation, this would map targetId to actual pages
    if (!this.currentPage) {
      throw new Error('No current page available');
    }
    return this.currentPage;
  }

  /**
   * Disconnect a CDP session
   */
  async disconnectSession(targetId: TargetID): Promise<void> {
    const sessionInfo = this._cdpSessionPool.get(targetId);
    if (sessionInfo) {
      try {
        await sessionInfo.cdpSession.detach();
      } catch (error) {
        // Ignore detach errors
      }
      this._cdpSessionPool.delete(targetId);
      console.log(`[BrowserSession] Disconnected CDP session for target ${targetId}`);
    }
  }

  /**
   * Get all frames for the current page
   * This is used for iframe support
   */
  async getAllFrames(): Promise<[Record<string, any>, any]> {
    if (!this.currentPage) {
      return [{}, null];
    }

    const frames = this.currentPage.frames();
    const frameMap: Record<string, any> = {};

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      frameMap[`frame_${i}`] = {
        frameId: `frame_${i}`,
        url: frame.url(),
        name: frame.name(),
        parentFrameId: frame.parentFrame() ? 'parent' : null,
      };
    }

    return [frameMap, null];
  }

  /**
   * Cleanup expired sessions
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const toRemove: TargetID[] = [];

      for (const [targetId, sessionInfo] of this._cdpSessionPool.entries()) {
        if (now - sessionInfo.lastUsedAt > this.SESSION_TIMEOUT) {
          toRemove.push(targetId);
        }
      }

      for (const targetId of toRemove) {
        this.disconnectSession(targetId).catch(err => {
          console.error(`[BrowserSession] Failed to disconnect session ${targetId}:`, err);
        });
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Stop cleanup and disconnect all sessions
   */
  async destroy(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Disconnect all sessions
    for (const targetId of this._cdpSessionPool.keys()) {
      await this.disconnectSession(targetId);
    }

    this._cdpSessionPool.clear();
    console.log('[BrowserSession] All CDP sessions disconnected');
  }

  /**
   * Get current agent focus
   */
  get agentFocus(): AgentFocus {
    return this._agentFocus;
  }

  /**
   * Set agent focus
   */
  set agentFocus(focus: AgentFocus) {
    this._agentFocus = focus;
  }

  /**
   * Get current target ID
   */
  get currentTargetId(): TargetID | null {
    return this._agentFocus.targetId;
  }

  /**
   * Get current page
   */
  get page(): Page | null {
    return this._agentFocus.page || this.currentPage;
  }

  /**
   * Set current page
   */
  set page(page: Page | null) {
    this.currentPage = page;
    if (page) {
      this._agentFocus.page = page;
    }
  }

  /**
   * Get browser context
   */
  get browserContext(): BrowserContext {
    return this.context;
  }

  /**
   * Get CDP session pool size (for debugging)
   */
  get sessionPoolSize(): number {
    return this._cdpSessionPool.size;
  }
}
