// index.jsx - React entry point for macro flowchart viewer

import React from 'react';
import { createRoot } from 'react-dom/client';
import MacroFlowViewer from './MacroFlowViewer';
import './styles.css';

const { ipcRenderer } = window.require('electron');

// Initialize React app
async function initApp() {
  console.log('[Flowchart] Initializing React Flow viewer...');

  try {
    // Get macro data from main process
    const macroData = await ipcRenderer.invoke('get-current-macro');

    if (!macroData) {
      console.error('[Flowchart] No macro data received');
      document.getElementById('root').innerHTML = `
        <div style="text-align: center; padding: 40px; color: #999;">
          <h2>No macro data found</h2>
          <p>Unable to load macro information</p>
        </div>
      `;
      return;
    }

    console.log('[Flowchart] Received macro data:', macroData.name, 'with', macroData.steps?.length, 'steps');

    // Render React app
    const container = document.getElementById('root');
    const root = createRoot(container);
    root.render(<MacroFlowViewer macroData={macroData} />);

  } catch (error) {
    console.error('[Flowchart] Failed to initialize:', error);
    document.getElementById('root').innerHTML = `
      <div style="text-align: center; padding: 40px; color: #f87171;">
        <h2>Error Loading Macro</h2>
        <p>${error.message}</p>
      </div>
    `;
  }
}

// Wait for DOM and then initialize
window.addEventListener('DOMContentLoaded', initApp);
