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

// Import socket handlers
const { setupSocketHandlers } = require('./socket');

// Import services
const { initializeDefaultChatrooms } = require('./services/assignment');

const app = express();
const server = http.createServer(app);

// CORS origins - support multiple origins for production
const corsOrigins = process.env.CORS_ORIGIN 
  ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'https://www.tradermind.site', 'https://tradermind.site'];

// Socket.IO setup with CORS
const io = new Server(server, {
  cors: {
    origin: corsOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Middleware
app.use(cors({
  origin: corsOrigins,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files for uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chatrooms', chatroomRoutes);
app.use('/api/community', communityRoutes);

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
    
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 TraderMind Real-time Server running on port ${PORT}`);
      console.log(`📡 WebSocket ready for connections`);
      console.log(`🔗 CORS origins: ${corsOrigins.join(', ')}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();

module.exports = { app, server, io };
