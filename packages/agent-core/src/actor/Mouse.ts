import { CDPSession, Page } from 'playwright';
import { BrowserSession, SessionID, TargetID } from '../browser/BrowserSession.js';

/**
 * Mouse button type (matching browser-use)
 */
export type MouseButton = 'left' | 'right' | 'middle';

/**
 * Mouse class for mouse operations on a target
 *
 * Based on browser-use's Mouse class
 */
export class Mouse {
  private browserSession: BrowserSession;
  private sessionId: SessionID | null;
  private targetId: TargetID | null;

  constructor(
    browserSession: BrowserSession,
    sessionId: SessionID | null = null,
    targetId: TargetID | null = null
  ) {
    this.browserSession = browserSession;
    this.sessionId = sessionId;
    this.targetId = targetId;
  }

  /**
   * Click at the specified coordinates
   */
  async click(x: number, y: number, button: MouseButton = 'left', clickCount: number = 1): Promise<void> {
    const sessionInfo = await this.ensureSession();
    const cdpSession = sessionInfo.cdpSession;

    // Mouse press
    await (cdpSession as any).send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button,
      clickCount,
    });

    // Mouse release
    await (cdpSession as any).send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button,
      clickCount,
    });
  }

  /**
   * Press mouse button down
   */
  async down(button: MouseButton = 'left', clickCount: number = 1): Promise<void> {
    const sessionInfo = await this.ensureSession();
    const cdpSession = sessionInfo.cdpSession;

    await (cdpSession as any).send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: 0, // Will use last mouse position
      y: 0,
      button,
      clickCount,
    });
  }

  /**
   * Release mouse button
   */
  async up(button: MouseButton = 'left', clickCount: number = 1): Promise<void> {
    const sessionInfo = await this.ensureSession();
    const cdpSession = sessionInfo.cdpSession;

    await (cdpSession as any).send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: 0, // Will use last mouse position
      y: 0,
      button,
      clickCount,
    });
  }

  /**
   * Move mouse to the specified coordinates
   * @param x - X coordinate
   * @param y - Y coordinate
   * @param steps - Number of steps for smooth movement (default 1)
   */
  async move(x: number, y: number, steps: number = 1): Promise<void> {
    const sessionInfo = await this.ensureSession();
    const cdpSession = sessionInfo.cdpSession;

    // TODO: Implement smooth movement with multiple steps if needed
    await (cdpSession as any).send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
    });
  }

  /**
   * Scroll the page using robust CDP methods
   * @param x - X coordinate (default 0, will use viewport center)
   * @param y - Y coordinate (default 0, will use viewport center)
   * @param deltaX - Horizontal scroll delta
   * @param deltaY - Vertical scroll delta
   */
  async scroll(
    x: number = 0,
    y: number = 0,
    deltaX: number | null = null,
    deltaY: number | null = null
  ): Promise<void> {
    const sessionInfo = await this.ensureSession();
    const cdpSession = sessionInfo.cdpSession;
    const page = this.getPage();

    // Method 1: Try mouse wheel event (most reliable)
    try {
      // Get viewport dimensions
      const layoutMetrics = await (cdpSession as any).send('Page.getLayoutMetrics');
      const viewportWidth = layoutMetrics.layoutViewport.clientWidth;
      const viewportHeight = layoutMetrics.layoutViewport.clientHeight;

      // Use provided coordinates or center of viewport
      const scrollX = x > 0 ? x : viewportWidth / 2;
      const scrollY = y > 0 ? y : viewportHeight / 2;

      // Calculate delta values
      const scrollDeltaX = deltaX !== null ? deltaX : 0;
      const scrollDeltaY = deltaY !== null ? deltaY : 0;

      // Dispatch mouse wheel event
      await (cdpSession as any).send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: scrollX,
        y: scrollY,
        deltaX: scrollDeltaX,
        deltaY: scrollDeltaY,
      });
    } catch (error) {
      // Fallback to JavaScript scrollBy if CDP fails
      await page.evaluate(
        ({ deltaX, deltaY }) => {
          window.scrollBy(deltaX || 0, deltaY || 0);
        },
        { deltaX, deltaY }
      );
    }
  }

  /**
   * Ensure we have a CDP session for this target
   */
  private async ensureSession() {
    if (this.sessionId) {
      // Use existing session
      return await this.browserSession.getOrCreateCDPSession(this.targetId || undefined, false, false);
    } else {
      // Get or create session for current target
      return await this.browserSession.getOrCreateCDPSession(this.targetId || undefined);
    }
  }

  /**
   * Get the Playwright Page instance
   */
  private getPage(): Page {
    if (!this.browserSession.currentPage) {
      throw new Error('No active page in browser session');
    }
    return this.browserSession.currentPage;
  }
}
