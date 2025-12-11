require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const chatroomRoutes = require('./routes/chatrooms');
const communityRoutes = require('./routes/communityV2');
const tierChatroomRoutes = require('./routes/tierChatrooms');
const settingsRoutes = require('./routes/settings');

const chatsRoutes = require('./routes/chats');
const portfolioRoutes = require('./routes/portfolio');
const sharedRoutes = require('./routes/shared');
const leaderboardRoutes = require('./routes/leaderboard');
const mentorRoutes = require('./routes/mentor');
const achievementsRoutes = require('./routes/achievements');

const filesRoutes = require('./routes/files');
const tradingRoutes = require('./routes/trading');

// Role-protected routes
const adminRoutes = require('./routes/admin');
const userTradingRoutes = require('./routes/user');
const adminRecoveryRoutes = require('./routes/admin/recovery');
const userRecoveryRoutes = require('./routes/user/recovery');

// Middleware
const { authMiddleware } = require('./middleware/auth');
const isAdmin = require('./middleware/isAdmin');
const isUser = require('./middleware/isUser');

const { setupSocketHandlers } = require('./socket');

const { initializeDefaultChatrooms } = require('./services/assignment');
const { startCronJobs } = require('./cron');
const schedulerService = require('./services/schedulerService');

const app = express();
const server = http.createServer(app);

const defaultOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://www.tradermind.site',
  'https://tradermind.site',
  'https://deriv-ws.vercel.app'
];

const corsOrigins = process.env.CORS_ORIGIN
  ? [...new Set([...process.env.CORS_ORIGIN.split(',').map(o => o.trim()), ...defaultOrigins])]
  : defaultOrigins;

console.log('CORS origins configured:', corsOrigins);

const io = new Server(server, {
  cors: {
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
  },
  pingTimeout: 300000,
  pingInterval: 25000,
  connectTimeout: 60000,
  transports: ['websocket', 'polling'],
  allowUpgrades: true
});

app.use(cors({
  origin: corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options('*', cors());

// Parse cookies (for HttpOnly refresh tokens)
app.use(cookieParser());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chatrooms', chatroomRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/community', tierChatroomRoutes);
app.use('/api/settings', settingsRoutes);

app.use('/api/chats', chatsRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/shared', sharedRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/mentor', mentorRoutes);
app.use('/api/achievements', achievementsRoutes);

app.use('/api/files', filesRoutes);
app.use('/api/trading', tradingRoutes);

// Role-protected routes (with auth + role middleware)
app.use('/api/admin', authMiddleware, isAdmin, adminRoutes);
app.use('/api/admin/recovery', authMiddleware, isAdmin, adminRecoveryRoutes);
app.use('/api/user', authMiddleware, isUser, userTradingRoutes);
app.use('/api/user/recovery', authMiddleware, isUser, userRecoveryRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/health/db', async (req, res) => {
  try {
    const { supabase } = require('./db/supabase');
    const { data, error } = await supabase.from('Chatroom').select('id').limit(1);
    if (error) {
      console.error('DB health check error:', error);
      return res.status(500).json({ status: 'error', error: error.message });
    }
    res.json({ status: 'ok', connected: true, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('DB health check exception:', err);
    res.status(500).json({ status: 'error', error: err.message });
  }
});

app.get('/', (req, res) => {
  res.json({
    name: 'TraderMind Real-time Server',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      api: '/api'
    }
  });
});

app.set('io', io);

setupSocketHandlers(io);

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal server error',
      code: err.code || 'INTERNAL_ERROR'
    }
  });
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);

});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Promise Rejection:', reason);

});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

const { initializeStorageBuckets } = require('./services/fileStorage');

const PORT = process.env.PORT || 3001;

async function startServer() {
  try {

    await initializeDefaultChatrooms();


    await initializeStorageBuckets();


    startCronJobs();
    schedulerService.start();

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 TraderMind Real-time Server running on port ${PORT}`);
      console.log(`📡 WebSocket ready for connections`);
      console.log(`💬 Community System active`);
      console.log(`📈 Trading System active`);
      console.log(`📁 File storage initialized`);
      console.log(`🔗 CORS origins: ${corsOrigins.join(', ')}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();

module.exports = { app, server, io };
