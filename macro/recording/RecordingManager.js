// RecordingManager.js - Manages macro recording state and lifecycle

const { RecordingState, createMacro } = require('../types/MacroTypes');

class RecordingManager {
  constructor() {
    this.state = RecordingState.IDLE;
    this.currentMacro = null;
    this.recordedEvents = [];
    this.startTime = 0;
    this.eventCollector = null;
  }

  /**
   * Start recording a new macro
   * @param {string} name - Macro name
   * @returns {Object} Recording info
   */
  startRecording(name = 'Untitled Macro') {
    if (this.state === RecordingState.RECORDING) {
      console.warn('[RecordingManager] Already recording');
      return { success: false, error: 'Already recording' };
    }

    console.log('[RecordingManager] Starting new recording:', name);

    // Initialize new macro
    this.currentMacro = createMacro(name);
    this.recordedEvents = [];
    this.startTime = Date.now();
    this.state = RecordingState.RECORDING;

    return {
      success: true,
      macroId: this.currentMacro.id,
      startTime: this.startTime
    };
  }

  /**
   * Stop recording
   * @returns {Object} Recording result with events
   */
  stopRecording() {
    if (this.state !== RecordingState.RECORDING) {
      console.warn('[RecordingManager] Not currently recording');
      return { success: false, error: 'Not recording' };
    }

    console.log('[RecordingManager] Stopping recording');
    console.log('[RecordingManager] Total events recorded:', this.recordedEvents.length);

    this.state = RecordingState.SAVING;

    const duration = Date.now() - this.startTime;

    // Update macro metadata
    if (this.currentMacro) {
      this.currentMacro.metadata.duration = duration;
      this.currentMacro.metadata.totalSteps = this.recordedEvents.length;
    }

    const result = {
      success: true,
      macro: this.currentMacro,
      events: this.recordedEvents,
      duration: duration
    };

    // Reset state after a short delay
    setTimeout(() => {
      this.state = RecordingState.IDLE;
    }, 1000);

    return result;
  }

  /**
   * Pause recording
   */
  pauseRecording() {
    if (this.state === RecordingState.RECORDING) {
      this.state = RecordingState.PAUSED;
      console.log('[RecordingManager] Recording paused');
      return { success: true };
    }
    return { success: false, error: 'Not recording' };
  }

  /**
   * Resume recording
   */
  resumeRecording() {
    if (this.state === RecordingState.PAUSED) {
      this.state = RecordingState.RECORDING;
      console.log('[RecordingManager] Recording resumed');
      return { success: true };
    }
    return { success: false, error: 'Not paused' };
  }

  /**
   * Add an event to the recording
   * @param {Object} event - Event object
   */
  addEvent(event) {
    if (this.state !== RecordingState.RECORDING) {
      return;
    }

    // Add relative timestamp
    event.timestamp = Date.now() - this.startTime;

    this.recordedEvents.push(event);
    console.log('[RecordingManager] Event recorded:', event.type, 'at', event.timestamp + 'ms');
  }

  /**
   * Get current recording state
   * @returns {string} Current state
   */
  getState() {
    return this.state;
  }

  /**
   * Check if currently recording
   * @returns {boolean} True if recording
   */
  isRecording() {
    return this.state === RecordingState.RECORDING;
  }

  /**
   * Get current macro info
   * @returns {Object|null} Current macro or null
   */
  getCurrentMacro() {
    return this.currentMacro;
  }

  /**
   * Get recorded events count
   * @returns {number} Number of events
   */
  getEventCount() {
    return this.recordedEvents.length;
  }

  /**
   * Clear current recording
   */
  clear() {
    console.log('[RecordingManager] Clearing recording');
    this.state = RecordingState.IDLE;
    this.currentMacro = null;
    this.recordedEvents = [];
    this.startTime = 0;
  }

  /**
   * Set the event collector instance
   * @param {Object} collector - EventCollector instance
   */
  setEventCollector(collector) {
    this.eventCollector = collector;
  }
}

module.exports = RecordingManager;
