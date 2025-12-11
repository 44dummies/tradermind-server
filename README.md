# TraderMind Server

Real-time backend server for the TraderMind trading community platform.

## Tech Stack

- Node.js with Express
- Socket.IO for real-time communication
- Supabase PostgreSQL database
- JWT authentication
- PM2 for production process management

## Features

- User authentication via Deriv OAuth
- Real-time WebSocket messaging
- Multi-account automated trading bot
- Tier-based community chatrooms
- Trading analytics and portfolio tracking
- Leaderboard system
- AI mentor integration
- File sharing and storage
- Achievement system

## Core Services

| Service | File | Purpose |
|---------|------|---------|
| Bot Manager | `services/botManager.js` | Orchestrates bot lifecycle, session auto-stop timer |
| Trade Executor | `services/tradeExecutor.js` | Multi-account trade execution, TP/SL monitoring |
| Signal Worker | `services/signalWorker.js` | Market analysis, signal generation, risk checks |
| Session Manager | `services/sessionManager.js` | Session creation, user participation |
| Strategy Engine | `services/strategyEngine.js` | Markov, RSI, Linear Regression signals |
| Tick Collector | `services/tickCollector.js` | WebSocket market data collection |
| Risk Engine | `services/trading-engine/risk/RiskEngine.js` | Daily loss limits, exposure control |

## API Endpoints

### Authentication
- POST /api/auth/login - Deriv OAuth login
- POST /api/auth/refresh - Refresh JWT token

### Users
- GET /api/users/me - Get current user profile
- PUT /api/users/me - Update profile

### Community
- GET /api/community/feed - Get community feed
- POST /api/community/posts - Create post
- GET /api/community/tier-chatrooms - Get tier chatrooms
- POST /api/community/assign-tier - Assign to tier chatroom
- GET /api/community/tier-chatroom/:id/messages - Get chatroom messages
- POST /api/community/tier-chatroom/:id/message - Send message

### Trading
- GET /api/trading-v2/status - Bot status and connection info
- GET /api/trading-v2/metrics - Real-time trading metrics
- GET /api/trading-v2/logs - Activity logs
- GET /api/trading-v2/signals - Latest signal analysis

### Debug
- GET /debug/health - System health check
- GET /debug/signals - Signal buffer history

### Settings
- GET /api/settings - Get user settings
- PUT /api/settings - Update settings

## Environment Variables

```
PORT=3001
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_service_key
JWT_SECRET=your_jwt_secret
DERIV_APP_ID=your_deriv_app_id
DERIV_MASTER_TOKEN=your_master_token
CORS_ORIGIN=https://tradermind.site
SENTRY_DSN=optional_sentry_dsn
```

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

## Production (PM2)

```bash
pm2 start ecosystem.config.js
pm2 logs tradermind-server
```

## Deployment

Deployed on Railway with automatic deployments from the main branch.

## Database Tables

- user_profiles
- trading_sessions_v2
- session_participants
- trades
- trading_activity_logs
- tier_chatrooms
- chatroom_members
- chatroom_messages
- community_posts
- achievements

## WebSocket Events

### Client to Server
- message:send - Send a message
- typing:start - Start typing indicator
- typing:stop - Stop typing indicator
- room:join - Join a chatroom
- room:leave - Leave a chatroom
- subscribe_market - Subscribe to market ticks
- unsubscribe_market - Unsubscribe from market

### Server to Client
- message:new - New message received
- message:delete - Message deleted
- message:reaction - Reaction updated
- member:joined - New member joined
- member:left - Member left
- typing - Typing indicator update
- tick_update - Market tick data
- signal_update - Signal analysis
- trade_update - Trade execution status
- session_ended - Session auto-stopped
