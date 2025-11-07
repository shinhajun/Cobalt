import * as admin from 'firebase-admin';
import * as path from 'path';

// Construct the absolute path to the service account key JSON file
// __dirname will be 'ai-agent/packages/server/dist/src' after compilation, so we go up two levels.
// For development, when running with ts-node, __dirname might be 'ai-agent/packages/server/src'.
// A more robust way is to ensure the path is relative to the package root or use an environment variable.
// For now, let's try to make it work for both compiled and ts-node scenarios if possible,
// but a common pattern is to copy non-TS assets to the dist folder.

// Simpler approach: Assume the key is in 'config' directory relative to 'src' or 'dist/src'
// and node's `require` can resolve it by traversing up.
// Or, more directly, path from project root if CWD is consistent.

// Let's use a path relative to the current file (__dirname) first.
// The key is in packages/server/config/
// This file is in packages/server/src/
// So from src, it's ../config/your-key-file.json
// From dist/src, it's also ../../config/your-key-file.json (this needs adjustment or asset copying)

// Best practice for service account keys in TypeScript projects:
// 1. Place the key outside the 'src' directory, e.g., in a 'config' directory at the package root.
// 2. Copy this 'config' directory to the 'dist' directory as part of your build process.
// 3. Or, use an environment variable for the path to the key file or the key content itself.

// For this setup, we'll assume the key is in 'packages/server/config/'
// and npm start is run from 'packages/server/', so process.cwd() or relative path from there.
// Use absolute path directly to avoid any path resolution issues
const serviceAccountPath = 'C:/Users/marti/ai-agent/ai-agent/packages/server/config/ai-agent-cad35-firebase-adminsdk-fbsvc-e97b790820.json';

try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccountPath),
  });
  console.log('Firebase Admin SDK initialized successfully.');
} catch (error) {
  console.error('Error initializing Firebase Admin SDK:', error);
  // Consider how to handle this error more gracefully in a real application
  // For example, prevent the server from starting or log and alert.
}

export const auth = admin.auth();
export const db = admin.firestore(); // If you plan to use Firestore 