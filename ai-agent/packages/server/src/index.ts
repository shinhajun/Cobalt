import Fastify from 'fastify';
import './firebase'; // Initialize Firebase Admin SDK
import { auth } from './firebase'; // Import Firebase auth instance
import db from './database'; // Import SQLite database instance

const fastify = Fastify({
  logger: true,
});

// Signup route
fastify.post('/auth/signup', async (request, reply) => {
  const { email, password } = request.body as any;

  if (!email || !password) {
    return reply.status(400).send({ error: 'Email and password are required' });
  }

  try {
    const userRecord = await auth.createUser({
      email,
      password,
    });

    // Save user to SQLite database
    const stmt = db.prepare("INSERT INTO users (id, email) VALUES (?, ?)");
    stmt.run(userRecord.uid, userRecord.email, (err: Error | null) => {
      if (err) {
        fastify.log.error('Error saving user to SQLite:', err.message);
        // If Firebase user was created but DB save failed, this is a compensation scenario.
        // For simplicity, we'll still return success to client, but log the error.
        // In a production app, you might want to delete the Firebase user or retry DB operation.
      }
      fastify.log.info(`User ${userRecord.uid} (${userRecord.email}) saved to SQLite.`);
    });
    stmt.finalize();

    reply.status(201).send({ uid: userRecord.uid, email: userRecord.email });
  } catch (error: any) {
    fastify.log.error('Firebase createUser error:', error);
    reply.status(400).send({ error: error.message });
  }
});

// Login route (Firebase client SDK typically handles login and then sends ID token to backend)
// This is a simplified example for backend token verification if client sends one.
// Or, you could use Firebase client SDK to sign in and then make authenticated requests.
// For a server-centric flow with email/password, you'd typically use Firebase client SDK
// to get an ID token, then verify it on the backend.

fastify.post('/auth/login', async (request, reply) => {
  const { idToken } = request.body as any; // Assuming client sends an ID token

  if (!idToken) {
    return reply.status(400).send({ error: 'ID token is required' });
  }

  try {
    const decodedToken = await auth.verifyIdToken(idToken);
    const uid = decodedToken.uid;
    // Here, you would typically fetch user details from your database
    // and perhaps generate a session or your own app-specific token.
    reply.send({ uid, message: 'Login successful, token verified.' });
  } catch (error: any) {
    fastify.log.error(error);
    reply.status(401).send({ error: 'Invalid ID token or login failed' });
  }
});

// Task endpoint (protected, requires authentication)
fastify.post('/task', async (request, reply) => {
  const authorization = request.headers.authorization;

  if (!authorization || !authorization.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Unauthorized: Missing or invalid token' });
  }

  const idToken = authorization.split('Bearer ')[1];

  try {
    const decodedToken = await auth.verifyIdToken(idToken);
    const uid = decodedToken.uid;

    // User is authenticated, process the task
    const taskPlan = request.body;
    fastify.log.info(`Task received from user ${uid}: ${JSON.stringify(taskPlan)}`);
    
    // TODO: Implement actual task processing logic using packages/agent

    reply.send({ message: 'Task received and is being processed', uid, task: taskPlan });
  } catch (error: any) {
    fastify.log.error('Token verification failed:', error);
    reply.status(401).send({ error: 'Unauthorized: Invalid token' });
  }
});


const start = async () => {
  try {
    await fastify.listen({ port: 3000 });
    fastify.log.info(`Server listening on ${ (fastify.server.address() as any).port }`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start(); 