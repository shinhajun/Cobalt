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
  url: string;
  path: string; // Full path to downloaded file
  fileName: string; // File name only
  fileSize: number; // Size in bytes
  fileType?: string; // Extension (e.g., 'pdf', 'zip')
  mimeType?: string; // MIME type (e.g., 'application/pdf')
  fromCache?: boolean; // Whether file was served from cache
  autoDownload?: boolean; // Whether it was auto-downloaded (e.g., PDF)
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
// Watchdog Events
// ============================================================================

export interface BrowserCrashEvent extends BaseEvent {
  type: 'browser_crash';
  tabId: string;
  errorMessage?: string;
}

export interface BrowserCrashRecoveredEvent extends BaseEvent {
  type: 'browser_crash_recovered';
  tabId: string;
  attemptNumber: number;
}

export interface PermissionRequestEvent extends BaseEvent {
  type: 'permission_request';
  permission: string; // 'geolocation' | 'notifications' | 'camera' | 'microphone'
  granted: boolean;
}

export interface PopupDetectedEvent extends BaseEvent {
  type: 'popup_detected';
  url: string;
  blocked: boolean;
}

export interface SecurityWarningEvent extends BaseEvent {
  type: 'security_warning';
  warningType: string; // 'ssl' | 'phishing' | 'malware'
  bypassed: boolean;
}

export interface DOMStateUpdatedEvent extends BaseEvent {
  type: 'dom_state_updated';
  elementCount: number;
  timing: Record<string, number>;
}

export interface NetworkRequestEvent extends BaseEvent {
  type: 'network_request';
  url: string;
  method: string;
  status?: number;
  pending: boolean;
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
  | AgentLogEvent
  | BrowserCrashEvent
  | BrowserCrashRecoveredEvent
  | PermissionRequestEvent
  | PopupDetectedEvent
  | SecurityWarningEvent
  | DOMStateUpdatedEvent
  | NetworkRequestEvent;

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
  // Watchdog Events
  BROWSER_CRASH: 'browser_crash',
  BROWSER_CRASH_RECOVERED: 'browser_crash_recovered',
  PERMISSION_REQUEST: 'permission_request',
  POPUP_DETECTED: 'popup_detected',
  SECURITY_WARNING: 'security_warning',
  DOM_STATE_UPDATED: 'dom_state_updated',
  NETWORK_REQUEST: 'network_request',
} as const;

export type BrowserEventType = typeof BrowserEventTypes[keyof typeof BrowserEventTypes];
