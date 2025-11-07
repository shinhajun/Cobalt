import sqlite3 from 'sqlite3';
import path from 'path';

// Determine a writable path for the database.
// For a real app, consider user-specific app data directories.
// For now, let's place it in the project root's 'data' folder (which we might need to create).
// Or, for simplicity in development, within packages/server/data/
const dbPath = path.resolve(__dirname, '../../data/ai_agent.db'); 
// This path will resolve to ai-agent/packages/server/data/ai_agent.db from dist/src

// Ensure the directory exists (Node.js > 10.12.0 for recursive mkdir)
// For now, we assume the user will create 'packages/server/data' or we handle it manually.
// import fs from 'fs';
// const dbDir = path.dirname(dbPath);
// if (!fs.existsSync(dbDir)) {
//   fs.mkdirSync(dbDir, { recursive: true });
// }

const verboseSqlite3 = sqlite3.verbose();
const db = new verboseSqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database', err.message);
    // In a real app, you might want to throw this error or exit
  } else {
    console.log('Connected to the SQLite database.');
    // db.run('PRAGMA journal_mode = WAL;'); // Optional: For better concurrency
    createTables();
  }
});

function createTables() {
  db.serialize(() => {
    // Users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,  -- Firebase UID
        email TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) console.error('Error creating users table', err.message);
      else console.log('Users table checked/created.');
    });

    // Task Logs table
    db.run(`
      CREATE TABLE IF NOT EXISTS task_logs (
        log_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        task_received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        task_plan TEXT, -- JSON or URL
        status TEXT DEFAULT 'pending', -- e.g., pending, processing, completed, failed
        summary_result TEXT,
        playwright_trace_path TEXT, -- Path to the trace.zip
        completed_at DATETIME,
        error_message TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )
    `, (err) => {
      if (err) console.error('Error creating task_logs table', err.message);
      else console.log('Task_logs table checked/created.');
    });
  });
}

export default db; 