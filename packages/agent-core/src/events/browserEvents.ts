/**
 * Browser Events - All browser-use style event types
 * TypeScript port of browser_use.browser.events
 */

import { TabInfo } from '../browserController.js';

// ============================================================================
// Base Event
// ============================================================================

export interface BaseEvent {
  timestamp: number;
}

// ============================================================================
// Browser Lifecycle Events
// ============================================================================

export interface BrowserLaunchEvent extends BaseEvent {
  type: 'browser_launch';
  headless: boolean;
  userDataDir?: string;
}

export interface BrowserLaunchResult extends BaseEvent {
  type: 'browser_launch_result';
  success: boolean;
  error?: string;
}

export interface BrowserStartEvent extends BaseEvent {
  type: 'browser_start';
}

export interface BrowserStopEvent extends BaseEvent {
  type: 'browser_stop';
}

export interface BrowserStoppedEvent extends BaseEvent {
  type: 'browser_stopped';
  reason?: string;
}

export interface BrowserConnectedEvent extends BaseEvent {
  type: 'browser_connected';
  cdpUrl: string;
}

export interface BrowserErrorEvent extends BaseEvent {
  type: 'browser_error';
  error: string;
  details?: any;
}

// ============================================================================
// Navigation Events
// ============================================================================

export interface NavigateToUrlEvent extends BaseEvent {
  type: 'navigate_to_url';
  url: string;
  newTab: boolean;
}

export interface NavigationStartedEvent extends BaseEvent {
  type: 'navigation_started';
  url: string;
  tabId?: string;
}

export interface NavigationCompleteEvent extends BaseEvent {
  type: 'navigation_complete';
  url: string;
  title: string;
  tabId?: string;
  success: boolean;
  error?: string;
}

// ============================================================================
// Tab Events
// ============================================================================

export interface TabCreatedEvent extends BaseEvent {
  type: 'tab_created';
  tab: TabInfo;
}

export interface TabClosedEvent extends BaseEvent {
  type: 'tab_closed';
  tabId: string;
}

export interface SwitchTabEvent extends BaseEvent {
  type: 'switch_tab';
  tabId: string;
  previousTabId?: string;
}

// ============================================================================
// State Events
// ============================================================================

export interface BrowserStateRequestEvent extends BaseEvent {
  type: 'browser_state_request';
  includeScreenshot: boolean;
  includeDOM: boolean;
}

// ============================================================================
// Download Events
// ============================================================================

export interface FileDownloadedEvent extends BaseEvent {
  type: 'file_downloaded';
  fileName: string;
  filePath: string;
  size: number;
  url: string;
}

// ============================================================================
// Agent Events
// ============================================================================

export interface AgentFocusChangedEvent extends BaseEvent {
  type: 'agent_focus_changed';
  focused: boolean;
}

// ============================================================================
// Screenshot Events (existing)
// ============================================================================

export interface ScreenshotEvent extends BaseEvent {
  type: 'screenshot';
  image: string; // base64
  action?: string;
  url: string;
}

// ============================================================================
// Log Events (existing)
// ============================================================================

export interface AgentLogEvent extends BaseEvent {
  type: 'agent_log';
  logType: 'thought' | 'observation' | 'system' | 'error';
  data: any;
}

// ============================================================================
// Union Type
// ============================================================================

export type BrowserEvent =
  | BrowserLaunchEvent
  | BrowserLaunchResult
  | BrowserStartEvent
  | BrowserStopEvent
  | BrowserStoppedEvent
  | BrowserConnectedEvent
  | BrowserErrorEvent
  | NavigateToUrlEvent
  | NavigationStartedEvent
  | NavigationCompleteEvent
  | TabCreatedEvent
  | TabClosedEvent
  | SwitchTabEvent
  | BrowserStateRequestEvent
  | FileDownloadedEvent
  | AgentFocusChangedEvent
  | ScreenshotEvent
  | AgentLogEvent;

// ============================================================================
// Event Type Names (for type-safe event emission)
// ============================================================================

export const BrowserEventTypes = {
  BROWSER_LAUNCH: 'browser_launch',
  BROWSER_LAUNCH_RESULT: 'browser_launch_result',
  BROWSER_START: 'browser_start',
  BROWSER_STOP: 'browser_stop',
  BROWSER_STOPPED: 'browser_stopped',
  BROWSER_CONNECTED: 'browser_connected',
  BROWSER_ERROR: 'browser_error',
  NAVIGATE_TO_URL: 'navigate_to_url',
  NAVIGATION_STARTED: 'navigation_started',
  NAVIGATION_COMPLETE: 'navigation_complete',
  TAB_CREATED: 'tab_created',
  TAB_CLOSED: 'tab_closed',
  SWITCH_TAB: 'switch_tab',
  BROWSER_STATE_REQUEST: 'browser_state_request',
  FILE_DOWNLOADED: 'file_downloaded',
  AGENT_FOCUS_CHANGED: 'agent_focus_changed',
  SCREENSHOT: 'screenshot',
  AGENT_LOG: 'agent_log',
} as const;

export type BrowserEventType = typeof BrowserEventTypes[keyof typeof BrowserEventTypes];
