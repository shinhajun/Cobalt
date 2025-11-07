import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs'; // Import fs for debugging
import { BrowserController } from './browserController'; // Make sure this path is correct
import { LLMService } from './llmService'; // Make sure this path is correct

const envPath = path.resolve(process.cwd(), '.env');
console.log(`[Server] Attempting to load .env file from: ${envPath}`);
try {
  const envContent = fs.readFileSync(envPath, { encoding: 'utf8', flag: 'r' });
  console.log(`[Server] .env file content (first 100 chars): ${envContent.substring(0,100)}`);
} catch (err: any) {
  console.error(`[Server] Error reading .env file directly: ${err.message}`);
}

dotenv.config({ path: envPath });

// 포트 설정
const PORT = process.env.PORT || 3500;
const app = express();
const server = http.createServer(app);

// CORS 설정
app.use(cors({
  origin: '*', // 실제 환경에서는 Vue 앱의 출처로 제한하는 것이 좋습니다 (e.g., 'http://localhost:8080')
  methods: ['GET', 'POST']
}));

// JSON 미들웨어
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public'))); // Serve static files from public directory

// Socket.io 설정
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

let browserControllerInstance: BrowserController | null = null;
let llmServiceInstance: LLMService | null = null;

// HTML 페이지 라우트 설정
app.get('/agent-view', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/agent-view.html'));
});

// API 엔드포인트 - 에이전트 작업 시작
app.post('/api/tasks', async (req, res) => {
  try {
    const { instructions, aiModel, taskId } = req.body;
    console.log('[Server] Task received: ' + instructions + ', Model: ' + aiModel + ', TaskID: ' + taskId);

    if (!instructions) {
      return res.status(400).json({ error: 'Task instructions are required' });
    }

    if (browserControllerInstance) {
      console.log('[Server] Another task is already running. Closing previous agent.');
      await browserControllerInstance.close(); // 이전 인스턴스 정리
      browserControllerInstance = null;
      io.emit('agent-stopped', { reason: 'New task started' });
    }

    console.log('[Server] Initializing new BrowserController and LLMService...');
    browserControllerInstance = new BrowserController(true); // 디버그 모드 활성화
    llmServiceInstance = new LLMService(aiModel || 'gpt-5-mini');

    // BrowserController 이벤트 핸들러
    browserControllerInstance.on('screenshot', (data) => {
      io.emit('screenshot', { image: data.image, action: data.action, timestamp: data.timestamp, url: data.url });
    });

    browserControllerInstance.on('log', (log) => {
      io.emit('agent-log', log); // type: 'thought', 'observation', or 'system', data: { ... }
    });

    io.emit('agent-started', { task: instructions });
    console.log('[Server] Emitted agent-started. Starting agent logic asynchronously.');

    // 에이전트 로직을 비동기로 실행 (서버 응답 지연 방지)
    (async () => {
      try {
        await browserControllerInstance!.launch();
        console.log('[Server] Browser launched by agent.');

        const result = await llmServiceInstance!.planAndExecute(instructions, browserControllerInstance!, (log) => {
            io.emit('agent-log', log);
        });

        console.log('[Server] Agent finished task. Result:', JSON.stringify(result, null, 2));
        io.emit('agent-stopped', {
          reason: result.success ? 'Task Completed' : 'Task Failed',
          success: result.success,
          report: result.message // 최종 보고서 포함
        });
      } catch (error: any) {
        console.error('[Server] Error during agent execution:', error);
        io.emit('agent-stopped', { reason: 'Error: ' + error.message });
      } finally {
        if (browserControllerInstance) {
          console.log('[Server] Cleaning up browser controller after agent execution.');
          await browserControllerInstance.close();
          browserControllerInstance = null;
        }
      }
    })();

    res.status(202).json({ message: 'Task started successfully. Agent is running.' });
    console.log('[Server] Responded to task request.');

  } catch (error: any) {
    console.error('[Server] Error in /api/tasks endpoint:', error);
    res.status(500).json({ error: 'Failed to start task: ' + error.message });
  }
});

// 서버 시작
server.listen(PORT, () => {
  console.log('Agent server running on http://localhost:' + PORT);
  console.log('Agent view available at http://localhost:' + PORT + '/agent-view');
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[Server] WARNING: OPENAI_API_KEY is not set in .env file. LLMService may not work.');
  }
});

// .env 파일 로드 확인
console.log("[Server] Loaded OPENAI_API_KEY:", process.env.OPENAI_API_KEY ? "Set" : "Not Set");