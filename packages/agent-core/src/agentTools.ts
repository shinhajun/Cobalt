/**
 * Additional tools for the autonomous web agent
 * These tools extend the agent's capabilities beyond browser automation
 */

export interface ToolResult {
  success: boolean;
  result: any;
  error?: string;
}

export class AgentTools {
  private memory: Map<string, any> = new Map();
  private searchHistory: Array<{ query: string; results: any; timestamp: number }> = [];

  /**
   * Calculator tool - performs mathematical calculations
   */
  async calculate(expression: string): Promise<ToolResult> {
    try {
      // Safe eval using Function constructor (only for numbers and basic operators)
      const sanitized = expression.replace(/[^0-9+\-*/().\s]/g, '');
      if (sanitized !== expression) {
        return {
          success: false,
          result: null,
          error: 'Invalid characters in expression'
        };
      }

      const result = Function(`'use strict'; return (${sanitized})`)();

      return {
        success: true,
        result: result
      };
    } catch (error) {
      return {
        success: false,
        result: null,
        error: (error as Error).message
      };
    }
  }

  /**
   * Memory tool - stores and retrieves information
   */
  async storeMemory(key: string, value: any): Promise<ToolResult> {
    try {
      this.memory.set(key, {
        value,
        timestamp: Date.now()
      });

      return {
        success: true,
        result: `Stored: ${key}`
      };
    } catch (error) {
      return {
        success: false,
        result: null,
        error: (error as Error).message
      };
    }
  }

  async retrieveMemory(key: string): Promise<ToolResult> {
    try {
      const data = this.memory.get(key);

      if (!data) {
        return {
          success: false,
          result: null,
          error: `No memory found for key: ${key}`
        };
      }

      return {
        success: true,
        result: data.value
      };
    } catch (error) {
      return {
        success: false,
        result: null,
        error: (error as Error).message
      };
    }
  }

  async listMemory(): Promise<ToolResult> {
    try {
      const keys = Array.from(this.memory.keys());
      return {
        success: true,
        result: keys
      };
    } catch (error) {
      return {
        success: false,
        result: null,
        error: (error as Error).message
      };
    }
  }

  /**
   * Date/Time tool - gets current date and time or calculates date differences
   */
  async getCurrentDateTime(format?: 'date' | 'time' | 'full'): Promise<ToolResult> {
    try {
      const now = new Date();
      let result: string;

      switch (format) {
        case 'date':
          result = now.toLocaleDateString('ko-KR');
          break;
        case 'time':
          result = now.toLocaleTimeString('ko-KR');
          break;
        default:
          result = now.toLocaleString('ko-KR');
      }

      return {
        success: true,
        result: {
          formatted: result,
          iso: now.toISOString(),
          timestamp: now.getTime()
        }
      };
    } catch (error) {
      return {
        success: false,
        result: null,
        error: (error as Error).message
      };
    }
  }

  async calculateDateDiff(date1: string, date2: string): Promise<ToolResult> {
    try {
      const d1 = new Date(date1);
      const d2 = new Date(date2);

      if (isNaN(d1.getTime()) || isNaN(d2.getTime())) {
        return {
          success: false,
          result: null,
          error: 'Invalid date format'
        };
      }

      const diffMs = Math.abs(d2.getTime() - d1.getTime());
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

      return {
        success: true,
        result: {
          days: diffDays,
          hours: diffHours,
          totalHours: Math.floor(diffMs / (1000 * 60 * 60)),
          totalMinutes: Math.floor(diffMs / (1000 * 60))
        }
      };
    } catch (error) {
      return {
        success: false,
        result: null,
        error: (error as Error).message
      };
    }
  }

  /**
   * Text processing tool - extracts, formats, or analyzes text
   */
  async extractNumbers(text: string): Promise<ToolResult> {
    try {
      const numbers = text.match(/\d+(\.\d+)?/g);
      return {
        success: true,
        result: numbers ? numbers.map(n => parseFloat(n)) : []
      };
    } catch (error) {
      return {
        success: false,
        result: null,
        error: (error as Error).message
      };
    }
  }

  async extractEmails(text: string): Promise<ToolResult> {
    try {
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const emails = text.match(emailRegex);
      return {
        success: true,
        result: emails || []
      };
    } catch (error) {
      return {
        success: false,
        result: null,
        error: (error as Error).message
      };
    }
  }

  async extractURLs(text: string): Promise<ToolResult> {
    try {
      const urlRegex = /https?:\/\/[^\s]+/g;
      const urls = text.match(urlRegex);
      return {
        success: true,
        result: urls || []
      };
    } catch (error) {
      return {
        success: false,
        result: null,
        error: (error as Error).message
      };
    }
  }

  /**
   * Search history tool - remembers previous searches
   */
  async recordSearch(query: string, results: any): Promise<ToolResult> {
    try {
      this.searchHistory.push({
        query,
        results,
        timestamp: Date.now()
      });

      // Keep only last 50 searches
      if (this.searchHistory.length > 50) {
        this.searchHistory.shift();
      }

      return {
        success: true,
        result: 'Search recorded'
      };
    } catch (error) {
      return {
        success: false,
        result: null,
        error: (error as Error).message
      };
    }
  }

  async searchInHistory(keyword: string): Promise<ToolResult> {
    try {
      const matches = this.searchHistory.filter(item =>
        item.query.toLowerCase().includes(keyword.toLowerCase()) ||
        JSON.stringify(item.results).toLowerCase().includes(keyword.toLowerCase())
      );

      return {
        success: true,
        result: matches
      };
    } catch (error) {
      return {
        success: false,
        result: null,
        error: (error as Error).message
      };
    }
  }

  /**
   * Data formatting tool - formats data for display
   */
  async formatAsTable(data: any[], columns?: string[]): Promise<ToolResult> {
    try {
      if (!Array.isArray(data) || data.length === 0) {
        return {
          success: false,
          result: null,
          error: 'Data must be a non-empty array'
        };
      }

      const keys = columns || Object.keys(data[0]);
      let table = '| ' + keys.join(' | ') + ' |\n';
      table += '| ' + keys.map(() => '---').join(' | ') + ' |\n';

      for (const row of data) {
        const values = keys.map(key => String(row[key] || ''));
        table += '| ' + values.join(' | ') + ' |\n';
      }

      return {
        success: true,
        result: table
      };
    } catch (error) {
      return {
        success: false,
        result: null,
        error: (error as Error).message
      };
    }
  }

  async formatAsJSON(data: any, pretty: boolean = true): Promise<ToolResult> {
    try {
      const result = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
      return {
        success: true,
        result
      };
    } catch (error) {
      return {
        success: false,
        result: null,
        error: (error as Error).message
      };
    }
  }

  /**
   * Clear all stored data
   */
  async clearAll(): Promise<ToolResult> {
    try {
      this.memory.clear();
      this.searchHistory = [];
      return {
        success: true,
        result: 'All data cleared'
      };
    } catch (error) {
      return {
        success: false,
        result: null,
        error: (error as Error).message
      };
    }
  }
}
