import { Page } from 'playwright';

// Enhanced element information with browser-use style indexing
export interface InteractiveElement {
  index: number;
  xpath: string;
  selector: string;
  tag: string;
  text: string;
  attributes: Record<string, string>;
  coordinates: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  isVisible: boolean;
  isClickable: boolean;
  accessibility?: {
    role?: string;
    name?: string;
    description?: string;
  };
}

export interface InteractiveElementMap {
  elements: InteractiveElement[];
  timestamp: number;
  url: string;
  summary: string; // Text representation for LLM
}

export class DOMExtractor {
  /**
   * Extract all interactive elements from the page using CDP (Chrome DevTools Protocol)
   * Similar to browser-use's DOM extraction approach
   */
  async extractInteractiveElements(page: Page): Promise<InteractiveElementMap> {
    const url = page.url();
    const timestamp = Date.now();

    try {
      // Use JavaScript evaluation to extract elements (including Shadow DOM and iframes)
      const elements = await page.evaluate(() => {
        const interactiveSelectors = [
          'a[href]',
          'button',
          'input',
          'textarea',
          'select',
          '[role="button"]',
          '[role="link"]',
          '[role="checkbox"]',
          '[role="radio"]',
          '[role="textbox"]',
          '[role="menuitem"]',
          '[role="tab"]',
          '[role="option"]',
          '[role="gridcell"]',
          '[role="row"]',
          '[onclick]',
          '[tabindex]',
          '[contenteditable="true"]',
          '[draggable="true"]',
        ];

        const allElements = new Set<Element>();

        // Helper function to extract elements from a root (supports Shadow DOM)
        const extractFromRoot = (root: Document | ShadowRoot | Element) => {
          interactiveSelectors.forEach(selector => {
            try {
              root.querySelectorAll(selector).forEach(el => allElements.add(el));
            } catch (_) {}
          });

          // Recursively traverse Shadow DOM
          root.querySelectorAll('*').forEach(el => {
            if (el.shadowRoot) {
              extractFromRoot(el.shadowRoot);
            }
          });
        };

        // Extract from main document
        extractFromRoot(document);

        // Extract from iframes (same-origin only)
        document.querySelectorAll('iframe').forEach(iframe => {
          try {
            const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
            if (iframeDoc) {
              extractFromRoot(iframeDoc);
            }
          } catch (_) {
            // Cross-origin iframe, skip
          }
        });

        // Also detect canvas and SVG interactive areas
        document.querySelectorAll('canvas, svg').forEach(canvasEl => {
          const rect = canvasEl.getBoundingClientRect();
          const style = window.getComputedStyle(canvasEl);
          const isVisible =
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0';

          if (isVisible && (canvasEl.hasAttribute('onclick') || canvasEl.hasAttribute('tabindex'))) {
            allElements.add(canvasEl);
          }
        });

        const extractedElements: any[] = [];
        let index = 0;

        Array.from(allElements).forEach((el) => {
          // Get bounding box
          const rect = el.getBoundingClientRect();

          // Check visibility (enhanced check)
          const style = window.getComputedStyle(el);
          const isVisible =
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            parseFloat(style.opacity) > 0.1 && // Allow slight transparency
            rect.top < window.innerHeight && // Within viewport or scrollable area
            rect.left < window.innerWidth;

          if (!isVisible) return; // Skip invisible elements

          // Extract attributes
          const attributes: Record<string, string> = {};
          Array.from(el.attributes).forEach(attr => {
            attributes[attr.name] = attr.value;
          });

          // Get text content
          const text = (el.textContent || '').trim().substring(0, 100);

          // Get XPath
          const getXPath = (element: Element): string => {
            if (element.id) {
              return `//*[@id="${element.id}"]`;
            }
            const idx = Array.from(element.parentNode?.children || []).indexOf(element) + 1;
            const tagName = element.tagName.toLowerCase();
            const parent = element.parentElement;
            if (!parent) return `/${tagName}`;
            return `${getXPath(parent)}/${tagName}[${idx}]`;
          };

          // Get CSS selector
          const getSelector = (element: Element): string => {
            if (element.id) return `#${element.id}`;
            if (element.className && typeof element.className === 'string') {
              const classes = element.className.trim().split(/\s+/).filter(c => c);
              if (classes.length > 0) {
                return `${element.tagName.toLowerCase()}.${classes[0]}`;
              }
            }
            return element.tagName.toLowerCase();
          };

          // Check if clickable (enhanced detection)
          const isClickable =
            el.tagName === 'A' ||
            el.tagName === 'BUTTON' ||
            el.tagName === 'INPUT' ||
            el.tagName === 'SELECT' ||
            el.tagName === 'TEXTAREA' ||
            el.hasAttribute('onclick') ||
            el.hasAttribute('onmousedown') ||
            el.hasAttribute('onmouseup') ||
            el.hasAttribute('tabindex') ||
            el.getAttribute('role') === 'button' ||
            el.getAttribute('role') === 'link' ||
            el.getAttribute('role') === 'menuitem' ||
            el.getAttribute('role') === 'tab' ||
            el.getAttribute('role') === 'option' ||
            el.getAttribute('role') === 'gridcell' ||
            el.getAttribute('contenteditable') === 'true' ||
            style.cursor === 'pointer';

          // Extract accessibility info
          const accessibility: any = {
            role: el.getAttribute('role') || undefined,
            name: el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || undefined,
            description: el.getAttribute('aria-description') || el.getAttribute('title') || undefined,
          };

          extractedElements.push({
            index: index++,
            xpath: getXPath(el),
            selector: getSelector(el),
            tag: el.tagName.toLowerCase(),
            text: text,
            attributes: attributes,
            coordinates: {
              x: Math.round(rect.left + rect.width / 2),
              y: Math.round(rect.top + rect.height / 2),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
            isVisible: true,
            isClickable: isClickable,
            accessibility: accessibility,
          });
        });

        return extractedElements;
      });

      // Create summary text for LLM
      const summary = this.createElementSummary(elements);

      return {
        elements,
        timestamp,
        url,
        summary,
      };
    } catch (error) {
      console.error('[DOMExtractor] Error extracting elements:', error);
      return {
        elements: [],
        timestamp,
        url,
        summary: 'Error: Could not extract interactive elements',
      };
    }
  }

  /**
   * Create a text summary of elements for LLM consumption
   * Format: [index] tag "text" (x, y) attributes
   */
  private createElementSummary(elements: InteractiveElement[]): string {
    if (elements.length === 0) {
      return 'No interactive elements found on the page.';
    }

    const lines = elements.map(el => {
      const attrParts: string[] = [];

      // Important attributes first
      if (el.attributes.id) attrParts.push(`id="${el.attributes.id}"`);
      if (el.attributes.name) attrParts.push(`name="${el.attributes.name}"`);
      if (el.attributes.type) attrParts.push(`type="${el.attributes.type}"`);
      if (el.attributes.placeholder) attrParts.push(`placeholder="${el.attributes.placeholder}"`);
      if (el.attributes.href) attrParts.push(`href="${el.attributes.href.substring(0, 50)}"`);
      if (el.accessibility?.role) attrParts.push(`role="${el.accessibility.role}"`);
      if (el.accessibility?.name) attrParts.push(`aria-label="${el.accessibility.name}"`);

      const attrs = attrParts.length > 0 ? ' ' + attrParts.join(' ') : '';
      const text = el.text ? ` "${el.text}"` : '';
      const coords = `(x=${el.coordinates.x}, y=${el.coordinates.y})`;

      return `[${el.index}] <${el.tag}${attrs}>${text} ${coords}`;
    });

    return lines.join('\n');
  }

  /**
   * Find element by index
   */
  findElementByIndex(elementMap: InteractiveElementMap, index: number): InteractiveElement | null {
    return elementMap.elements.find(el => el.index === index) || null;
  }

  /**
   * Filter elements by type (button, input, link, etc.)
   */
  filterElementsByType(elementMap: InteractiveElementMap, type: string): InteractiveElement[] {
    return elementMap.elements.filter(el => el.tag === type.toLowerCase());
  }

  /**
   * Search elements by text content
   */
  searchElementsByText(elementMap: InteractiveElementMap, searchText: string): InteractiveElement[] {
    const lowerSearch = searchText.toLowerCase();
    return elementMap.elements.filter(el =>
      el.text.toLowerCase().includes(lowerSearch) ||
      el.accessibility?.name?.toLowerCase().includes(lowerSearch)
    );
  }
}
