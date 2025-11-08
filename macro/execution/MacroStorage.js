// MacroStorage.js - Handles saving and loading macros using localStorage/file system

const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');

class MacroStorage {
  constructor() {
    // Use app user data directory for storage
    this.storageDir = path.join(app.getPath('userData'), 'macros');
    this.ready = false;
    this.initPromise = this.ensureStorageDir();
  }

  /**
   * Ensure storage directory exists
   */
  async ensureStorageDir() {
    if (this.ready) return;

    try {
      await fs.mkdir(this.storageDir, { recursive: true });
      this.ready = true;
      console.log('[MacroStorage] Storage directory ready:', this.storageDir);
    } catch (error) {
      console.error('[MacroStorage] Failed to create storage directory:', error);
      throw error;
    }
  }

  /**
   * Validate macro data before saving
   * @param {Object} macro - Macro object
   * @throws {Error} If validation fails
   */
  validateMacro(macro) {
    // Check required fields
    if (!macro || typeof macro !== 'object') {
      throw new Error('Macro must be an object');
    }

    if (!macro.id || typeof macro.id !== 'string') {
      throw new Error('Macro must have a valid ID');
    }

    if (!macro.name || typeof macro.name !== 'string') {
      throw new Error('Macro must have a valid name');
    }

    const trimmedName = macro.name.trim();
    if (trimmedName.length === 0) {
      throw new Error('Macro name cannot be empty or contain only spaces');
    }

    if (trimmedName.length < 3) {
      throw new Error('Macro name must be at least 3 characters long');
    }

    if (trimmedName.length > 100) {
      throw new Error('Macro name must be less than 100 characters');
    }

    // Check for invalid filename characters
    const invalidChars = /[<>:"/\\|?*\x00-\x1f]/g;
    if (invalidChars.test(trimmedName)) {
      throw new Error('Macro name contains invalid characters (< > : " / \\ | ? *)');
    }

    if (!Array.isArray(macro.steps)) {
      throw new Error('Macro must have a steps array');
    }

    // Validate each step
    macro.steps.forEach((step, index) => {
      if (!step || typeof step !== 'object') {
        throw new Error(`Step ${index} is invalid`);
      }

      if (!step.type || typeof step.type !== 'string') {
        throw new Error(`Step ${index} must have a valid type`);
      }

      // Validate input steps with 'prompt' mode
      if (step.type === 'input' && step.inputMode === 'prompt') {
        if (!step.promptConfig || typeof step.promptConfig !== 'object') {
          throw new Error(`Step ${index}: Input step with 'prompt' mode must have promptConfig`);
        }

        if (!step.promptConfig.question || typeof step.promptConfig.question !== 'string') {
          throw new Error(`Step ${index}: Prompt mode requires a question`);
        }
      }

      // Validate AI mode
      if (step.type === 'input' && step.inputMode === 'ai') {
        if (!step.aiConfig || typeof step.aiConfig !== 'object') {
          throw new Error(`Step ${index}: Input step with 'ai' mode must have aiConfig`);
        }

        if (!step.aiConfig.prompt || typeof step.aiConfig.prompt !== 'string') {
          throw new Error(`Step ${index}: AI mode requires a prompt`);
        }
      }
    });

    // Validate metadata
    if (!macro.metadata || typeof macro.metadata !== 'object') {
      console.warn('[MacroStorage] Macro missing metadata, using defaults');
      macro.metadata = {
        totalSteps: macro.steps.length,
        duration: 0,
        startUrl: '',
        endUrl: '',
        browserVersion: 'Cobalt 1.0'
      };
    }

    return true;
  }

  /**
   * Save a macro to disk
   * @param {Object} macro - Macro object
   * @returns {Promise<boolean>} Success
   */
  async save(macro) {
    console.log('[MacroStorage] Saving macro:', macro.id);

    try {
      // Wait for initialization to complete
      await this.initPromise;
      // Ensure directory exists
      await this.ensureStorageDir();

      // Validate macro before saving
      this.validateMacro(macro);

      // Trim macro name
      macro.name = macro.name.trim();

      // Generate filename from macro ID
      const filename = `${macro.id}.json`;
      const filepath = path.join(this.storageDir, filename);

      // Save as JSON
      const jsonData = JSON.stringify(macro, null, 2);
      await fs.writeFile(filepath, jsonData, 'utf8');

      console.log('[MacroStorage] Macro saved successfully:', filepath);

      // Update index
      await this.updateIndex(macro);

      return true;
    } catch (error) {
      console.error('[MacroStorage] Failed to save macro:', error);
      throw error;
    }
  }

  /**
   * Load a macro from disk
   * @param {string} macroId - Macro ID
   * @returns {Promise<Object>} Macro object
   */
  async load(macroId) {
    console.log('[MacroStorage] Loading macro:', macroId);

    try {
      const filename = `${macroId}.json`;
      const filepath = path.join(this.storageDir, filename);

      // Read file
      const jsonData = await fs.readFile(filepath, 'utf8');
      const macro = JSON.parse(jsonData);

      console.log('[MacroStorage] Macro loaded successfully');
      return macro;
    } catch (error) {
      console.error('[MacroStorage] Failed to load macro:', error);
      throw error;
    }
  }

  /**
   * List all saved macros
   * @returns {Promise<Array>} Array of macro metadata
   */
  async listAll() {
    console.log('[MacroStorage] Listing all macros');

    try {
      // Ensure directory exists
      await this.ensureStorageDir();

      // Read all JSON files in directory
      const files = await fs.readdir(this.storageDir);
      const jsonFiles = files.filter(f => f.endsWith('.json') && f !== 'index.json');

      const macros = [];

      for (const file of jsonFiles) {
        try {
          const filepath = path.join(this.storageDir, file);
          const jsonData = await fs.readFile(filepath, 'utf8');
          const macro = JSON.parse(jsonData);

          // Add summary info only
          macros.push({
            id: macro.id,
            name: macro.name,
            description: macro.description,
            createdAt: macro.createdAt,
            updatedAt: macro.updatedAt,
            stepCount: macro.steps?.length || 0,
            duration: macro.metadata?.duration || 0
          });
        } catch (error) {
          console.warn('[MacroStorage] Failed to read macro file:', file, error);
        }
      }

      // Sort by updated date (newest first)
      macros.sort((a, b) => b.updatedAt - a.updatedAt);

      console.log('[MacroStorage] Found', macros.length, 'macros');
      return macros;
    } catch (error) {
      console.error('[MacroStorage] Failed to list macros:', error);
      return [];
    }
  }

  /**
   * Delete a macro
   * @param {string} macroId - Macro ID
   * @returns {Promise<boolean>} Success
   */
  async delete(macroId) {
    console.log('[MacroStorage] Deleting macro:', macroId);

    try {
      const filename = `${macroId}.json`;
      const filepath = path.join(this.storageDir, filename);

      await fs.unlink(filepath);

      console.log('[MacroStorage] Macro deleted successfully');

      // Update index
      await this.removeFromIndex(macroId);

      return true;
    } catch (error) {
      console.error('[MacroStorage] Failed to delete macro:', error);
      throw error;
    }
  }

  /**
   * Check if a macro exists
   * @param {string} macroId - Macro ID
   * @returns {Promise<boolean>} True if exists
   */
  async exists(macroId) {
    try {
      const filename = `${macroId}.json`;
      const filepath = path.join(this.storageDir, filename);

      await fs.access(filepath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Export a macro to a user-selected location
   * @param {Object} macro - Macro object
   * @param {string} exportPath - Export file path
   * @returns {Promise<boolean>} Success
   */
  async export(macro, exportPath) {
    console.log('[MacroStorage] Exporting macro to:', exportPath);

    try {
      const jsonData = JSON.stringify(macro, null, 2);
      await fs.writeFile(exportPath, jsonData, 'utf8');

      console.log('[MacroStorage] Macro exported successfully');
      return true;
    } catch (error) {
      console.error('[MacroStorage] Failed to export macro:', error);
      throw error;
    }
  }

  /**
   * Import a macro from a file
   * @param {string} importPath - Import file path
   * @returns {Promise<Object>} Imported macro
   */
  async import(importPath) {
    console.log('[MacroStorage] Importing macro from:', importPath);

    try {
      const jsonData = await fs.readFile(importPath, 'utf8');
      const macro = JSON.parse(jsonData);

      // Validate macro structure
      if (!macro.id || !macro.name || !Array.isArray(macro.steps)) {
        throw new Error('Invalid macro file format');
      }

      // Generate new ID to avoid conflicts
      macro.id = `macro_${Date.now()}`;
      macro.createdAt = Date.now();
      macro.updatedAt = Date.now();

      // Save imported macro
      await this.save(macro);

      console.log('[MacroStorage] Macro imported successfully');
      return macro;
    } catch (error) {
      console.error('[MacroStorage] Failed to import macro:', error);
      throw error;
    }
  }

  /**
   * Update index file with macro metadata
   * @param {Object} macro - Macro object
   */
  async updateIndex(macro) {
    try {
      const indexPath = path.join(this.storageDir, 'index.json');

      // Read existing index
      let index = [];
      try {
        const indexData = await fs.readFile(indexPath, 'utf8');
        index = JSON.parse(indexData);
      } catch {
        // Index doesn't exist yet
      }

      // Remove old entry if exists
      index = index.filter(item => item.id !== macro.id);

      // Add new entry
      index.push({
        id: macro.id,
        name: macro.name,
        updatedAt: macro.updatedAt
      });

      // Write index
      await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf8');
    } catch (error) {
      console.warn('[MacroStorage] Failed to update index:', error);
    }
  }

  /**
   * Remove macro from index
   * @param {string} macroId - Macro ID
   */
  async removeFromIndex(macroId) {
    try {
      const indexPath = path.join(this.storageDir, 'index.json');

      // Read existing index
      let index = [];
      try {
        const indexData = await fs.readFile(indexPath, 'utf8');
        index = JSON.parse(indexData);
      } catch {
        return;
      }

      // Remove entry
      index = index.filter(item => item.id !== macroId);

      // Write index
      await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf8');
    } catch (error) {
      console.warn('[MacroStorage] Failed to remove from index:', error);
    }
  }

  /**
   * Get storage directory path
   * @returns {string} Storage directory path
   */
  getStorageDir() {
    return this.storageDir;
  }

  /**
   * Clear all macros (use with caution!)
   * @returns {Promise<boolean>} Success
   */
  async clearAll() {
    console.warn('[MacroStorage] Clearing all macros!');

    try {
      const files = await fs.readdir(this.storageDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      for (const file of jsonFiles) {
        const filepath = path.join(this.storageDir, file);
        await fs.unlink(filepath);
      }

      console.log('[MacroStorage] All macros cleared');
      return true;
    } catch (error) {
      console.error('[MacroStorage] Failed to clear macros:', error);
      throw error;
    }
  }
}

module.exports = MacroStorage;
