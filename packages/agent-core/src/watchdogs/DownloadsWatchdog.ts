import { BaseWatchdog, WatchdogConfig } from './BaseWatchdog.js';
import { EventBus } from '../events/EventBus.js';
import { BrowserController } from '../browserController.js';
import { FileDownloadedEvent, NavigationCompleteEvent } from '../events/browserEvents.js';
import { debug, warn, error as logError } from '../utils/logger.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export interface DownloadsConfig extends WatchdogConfig {
  downloadsPath?: string; // Path to save downloads (default: ~/Downloads)
  autoDownloadPDFs?: boolean; // Auto-download PDFs (default: true)
}

/**
 * Downloads Watchdog for monitoring and handling file downloads
 *
 * Based on browser-use's DownloadsWatchdog
 */
export class DownloadsWatchdog extends BaseWatchdog {
  private downloadsConfig: Required<DownloadsConfig>;
  private downloadsPath: string;
  private cdpSessionSetup: boolean = false;
  private activeDownloads: Map<string, any> = new Map();
  private pdfUrlCache: Map<string, string> = new Map(); // URL -> download path
  private pdfViewerCache: Map<string, boolean> = new Map(); // URL -> is PDF

  constructor(eventBus: EventBus, browserController: BrowserController, config: DownloadsConfig = {}) {
    super(eventBus, browserController, config);

    this.downloadsConfig = {
      enabled: config.enabled ?? true,
      debug: config.debug ?? false,
      downloadsPath: config.downloadsPath ?? path.join(os.homedir(), 'Downloads'),
      autoDownloadPDFs: config.autoDownloadPDFs ?? true,
    };

    this.downloadsPath = this.downloadsConfig.downloadsPath;
  }

  async onInitialize(): Promise<void> {
    debug('[DownloadsWatchdog] Initializing...');

    // Ensure downloads directory exists
    if (!fs.existsSync(this.downloadsPath)) {
      fs.mkdirSync(this.downloadsPath, { recursive: true });
      debug(`[DownloadsWatchdog] Created downloads directory: ${this.downloadsPath}`);
    }

    // Listen to navigation complete events for PDF detection
    this.eventBus.on('navigation_complete', async (event: NavigationCompleteEvent) => {
      await this.on_NavigationCompleteEvent(event);
    });

    debug('[DownloadsWatchdog] Initialized');
  }

  async onDestroy(): Promise<void> {
    debug('[DownloadsWatchdog] Destroying...');
    this.activeDownloads.clear();
    this.pdfUrlCache.clear();
    this.pdfViewerCache.clear();
  }

  /**
   * Handle navigation complete event - check for PDFs
   */
  private async on_NavigationCompleteEvent(event: NavigationCompleteEvent): Promise<void> {
    if (!this.downloadsConfig.autoDownloadPDFs) {
      return;
    }

    debug(`[DownloadsWatchdog] NavigationCompleteEvent: ${event.url}`);

    // Clear cache for this URL
    if (this.pdfViewerCache.has(event.url)) {
      this.pdfViewerCache.delete(event.url);
    }

    // Check if this is a PDF
    const isPDF = await this.checkForPDFViewer(event.url);
    if (isPDF) {
      debug(`[DownloadsWatchdog] PDF detected at ${event.url}, triggering auto-download...`);
      const downloadPath = await this.triggerPDFDownload(event.url);
      if (!downloadPath) {
        warn(`[DownloadsWatchdog] PDF download failed for ${event.url}`);
      }
    }
  }

  /**
   * Check if the current URL is a PDF using network-based detection
   */
  private async checkForPDFViewer(url: string): Promise<boolean> {
    debug(`[DownloadsWatchdog] Checking if ${url} is a PDF...`);

    // Check cache first
    if (this.pdfViewerCache.has(url)) {
      const cachedResult = this.pdfViewerCache.get(url)!;
      debug(`[DownloadsWatchdog] Using cached PDF check result: ${cachedResult}`);
      return cachedResult;
    }

    try {
      // Method 1: Check URL patterns (fastest, most reliable)
      if (this.checkUrlForPDF(url)) {
        debug(`[DownloadsWatchdog] PDF detected via URL pattern`);
        this.pdfViewerCache.set(url, true);
        return true;
      }

      // Method 2: Check Chrome's PDF viewer specific URLs
      if (this.isChromePDFViewerUrl(url)) {
        debug(`[DownloadsWatchdog] Chrome PDF viewer detected`);
        this.pdfViewerCache.set(url, true);
        return true;
      }

      // Not a PDF
      this.pdfViewerCache.set(url, false);
      return false;
    } catch (error: any) {
      warn(`[DownloadsWatchdog] Error checking for PDF viewer: ${error.message}`);
      this.pdfViewerCache.set(url, false);
      return false;
    }
  }

  /**
   * Check if URL indicates a PDF file
   */
  private checkUrlForPDF(url: string): boolean {
    if (!url) return false;

    const urlLower = url.toLowerCase();

    // Direct PDF file extensions
    if (urlLower.endsWith('.pdf')) {
      return true;
    }

    // PDF in path
    if (urlLower.includes('.pdf')) {
      return true;
    }

    // PDF MIME type in URL parameters
    const pdfParams = [
      'content-type=application/pdf',
      'content-type=application%2fpdf',
      'mimetype=application/pdf',
      'type=application/pdf',
    ];

    return pdfParams.some(param => urlLower.includes(param));
  }

  /**
   * Check if this is Chrome's internal PDF viewer URL
   */
  private isChromePDFViewerUrl(url: string): boolean {
    if (!url) return false;

    const urlLower = url.toLowerCase();

    // Chrome PDF viewer uses chrome-extension:// URLs
    if (urlLower.includes('chrome-extension://') && urlLower.includes('pdf')) {
      return true;
    }

    // Chrome PDF viewer internal URLs
    if (urlLower.startsWith('chrome://') && urlLower.includes('pdf')) {
      return true;
    }

    return false;
  }

  /**
   * Trigger download of a PDF from Chrome's PDF viewer
   */
  private async triggerPDFDownload(pdfUrl: string): Promise<string | null> {
    debug(`[DownloadsWatchdog] Triggering PDF download from: ${pdfUrl}`);

    try {
      // Check if already downloaded in this session
      if (this.pdfUrlCache.has(pdfUrl)) {
        const existingPath = this.pdfUrlCache.get(pdfUrl)!;
        debug(`[DownloadsWatchdog] PDF already downloaded in session: ${existingPath}`);
        return existingPath;
      }

      // Get browser session
      const browserSession = this.browserController['browserSession'];
      if (!browserSession) {
        throw new Error('BrowserSession not initialized');
      }

      // Generate filename from URL
      let pdfFilename = path.basename(pdfUrl.split('?')[0]); // Remove query params
      if (!pdfFilename || !pdfFilename.endsWith('.pdf')) {
        const urlPath = new URL(pdfUrl).pathname;
        pdfFilename = path.basename(urlPath) || 'document.pdf';
        if (!pdfFilename.endsWith('.pdf')) {
          pdfFilename += '.pdf';
        }
      }

      debug(`[DownloadsWatchdog] Generated filename: ${pdfFilename}`);

      // Generate unique filename if file exists
      const finalFilename = await this.getUniqueFilename(this.downloadsPath, pdfFilename);
      const downloadPath = path.join(this.downloadsPath, finalFilename);

      debug(`[DownloadsWatchdog] Starting PDF download...`);

      // Download using JavaScript fetch to leverage browser cache
      const sessionInfo = await browserSession.getOrCreateCDPSession();
      const escapedUrl = JSON.stringify(pdfUrl);

      const result = await (sessionInfo.cdpSession as any).send('Runtime.evaluate', {
        expression: `
          (async () => {
            try {
              // Use fetch with cache: 'force-cache' to prioritize cached version
              const response = await fetch(${escapedUrl}, {
                cache: 'force-cache'
              });
              if (!response.ok) {
                throw new Error(\`HTTP error! status: \${response.status}\`);
              }
              const blob = await response.blob();
              const arrayBuffer = await blob.arrayBuffer();
              const uint8Array = new Uint8Array(arrayBuffer);

              // Check if served from cache
              const fromCache = response.headers.has('age') || !response.headers.has('date');

              return {
                data: Array.from(uint8Array),
                fromCache: fromCache,
                responseSize: uint8Array.length,
                transferSize: response.headers.get('content-length') || 'unknown'
              };
            } catch (error) {
              throw new Error(\`Fetch failed: \${error.message}\`);
            }
          })()
        `,
        awaitPromise: true,
        returnByValue: true,
      });

      const downloadResult = result.result?.value;

      if (downloadResult && downloadResult.data && downloadResult.data.length > 0) {
        // Save the PDF
        const buffer = Buffer.from(downloadResult.data);
        fs.writeFileSync(downloadPath, buffer);

        const actualSize = fs.statSync(downloadPath).size;
        debug(`[DownloadsWatchdog] PDF file written successfully: ${downloadPath} (${actualSize} bytes)`);

        // Store URL->path mapping for this session
        this.pdfUrlCache.set(pdfUrl, downloadPath);

        // Emit file downloaded event
        await this.eventBus.emit('file_downloaded', {
          type: 'file_downloaded',
          url: pdfUrl,
          path: downloadPath,
          fileName: finalFilename,
          fileSize: actualSize,
          fileType: 'pdf',
          mimeType: 'application/pdf',
          fromCache: downloadResult.fromCache || false,
          autoDownload: true,
          timestamp: Date.now(),
        } as FileDownloadedEvent);

        debug(`[DownloadsWatchdog] Auto-downloaded PDF: ${downloadPath}`);
        return downloadPath;
      } else {
        warn(`[DownloadsWatchdog] No data received when downloading PDF from ${pdfUrl}`);
        return null;
      }
    } catch (error: any) {
      logError(`[DownloadsWatchdog] Failed to auto-download PDF: ${error.message}`);
      return null;
    }
  }

  /**
   * Generate a unique filename for downloads by appending (1), (2), etc.
   */
  private async getUniqueFilename(directory: string, filename: string): Promise<string> {
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    let counter = 1;
    let newFilename = filename;

    while (fs.existsSync(path.join(directory, newFilename))) {
      newFilename = `${base} (${counter})${ext}`;
      counter++;
    }

    return newFilename;
  }

  /**
   * Setup CDP download monitoring
   */
  async attachToTarget(targetId: string): Promise<void> {
    if (this.cdpSessionSetup) {
      return; // Already set up
    }

    try {
      const browserSession = this.browserController['browserSession'];
      if (!browserSession) {
        warn('[DownloadsWatchdog] BrowserSession not initialized');
        return;
      }

      const sessionInfo = await browserSession.getOrCreateCDPSession();

      // Set download behavior to allow downloads and enable events
      await (sessionInfo.cdpSession as any).send('Browser.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: this.downloadsPath,
        eventsEnabled: true,
      });

      // Register download event handlers
      // Note: Browser.downloadWillBegin and Browser.downloadProgress are CDP events
      // that need to be handled via CDP session event listeners
      // For now, we rely on PDF auto-download logic above

      this.cdpSessionSetup = true;
      debug('[DownloadsWatchdog] CDP download listeners set up');
    } catch (error: any) {
      warn(`[DownloadsWatchdog] Failed to set up CDP download listener: ${error.message}`);
    }
  }
}
