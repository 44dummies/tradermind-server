/**
 * TraderMind Real-time Server
 * Production-ready WebSocket chat server with Socket.IO
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const chatroomRoutes = require('./routes/chatrooms');
const communityRoutes = require('./routes/community');

// Friends Center routes
const friendsRoutes = require('./routes/friends');
const chatsRoutes = require('./routes/chats');
const portfolioRoutes = require('./routes/portfolio');
const sharedRoutes = require('./routes/shared');
const notificationsRoutes = require('./routes/notifications');
const leaderboardRoutes = require('./routes/leaderboard');
const mentorRoutes = require('./routes/mentor');
const achievementsRoutes = require('./routes/achievements');

// Import socket handlers
const { setupSocketHandlers } = require('./socket');
const { setupFriendsSocketHandlers } = require('./socket/friends');

// Import services
const { initializeDefaultChatrooms } = require('./services/assignment');
const { startCronJobs } = require('./cron');

const app = express();
const server = http.createServer(app);

// CORS origins - always include production domains
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

// Socket.IO setup with CORS
const io = new Server(server, {
  cors: {
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling']
});

// Middleware
app.use(cors({
  origin: corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Handle preflight requests
app.options('*', cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files for uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chatrooms', chatroomRoutes);
app.use('/api/community', communityRoutes);

// Friends Center API Routes
app.use('/api/friends', friendsRoutes);
app.use('/api/chats', chatsRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/shared', sharedRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/mentor', mentorRoutes);
app.use('/api/achievements', achievementsRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root endpoint
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

// Make io accessible to routes
app.set('io', io);

// Setup Socket.IO handlers
setupSocketHandlers(io);
setupFriendsSocketHandlers(io);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal server error',
      code: err.code || 'INTERNAL_ERROR'
    }
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

const PORT = process.env.PORT || 3001;

// Initialize server
async function startServer() {
  try {
    // Initialize default chatrooms
    await initializeDefaultChatrooms();
    
    // Start cron jobs
    startCronJobs();
    
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 TraderMind Real-time Server running on port ${PORT}`);
      console.log(`📡 WebSocket ready for connections`);
      console.log(`👥 Friends Center System active`);
      console.log(`🔗 CORS origins: ${corsOrigins.join(', ')}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();

module.exports = { app, server, io };
