# TraderMind Server

Real-time backend server for the TraderMind trading community platform.

## Tech Stack

- Node.js with Express
- Socket.IO for real-time communication
- Supabase PostgreSQL database
- JWT authentication

## Features

- User authentication via Deriv OAuth
- Real-time WebSocket messaging
- Tier-based community chatrooms
- Trading analytics and portfolio tracking
- Leaderboard system
- AI mentor integration
- File sharing and storage
- Achievement system

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

### Settings
- GET /api/settings - Get user settings
- PUT /api/settings - Update settings

### Portfolio
- GET /api/portfolio - Get portfolio data
- POST /api/portfolio/sync - Sync with Deriv

### Leaderboard
- GET /api/leaderboard - Get leaderboard

### Achievements
- GET /api/achievements - Get achievements

## Environment Variables

```
PORT=3001
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_service_key
JWT_SECRET=your_jwt_secret
DERIV_APP_ID=your_deriv_app_id
CORS_ORIGIN=https://tradermind.site
```

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

## Production

```bash
npm start
```

## Deployment

Deployed on Railway with automatic deployments from the main branch.

## Database

Uses Supabase PostgreSQL with the following main tables:
- user_profiles
- tier_chatrooms
- chatroom_members
- chatroom_messages
- community_posts
- community_comments
- achievements
- user_achievements

## WebSocket Events

### Client to Server
- message:send - Send a message
- typing:start - Start typing indicator
- typing:stop - Stop typing indicator
- room:join - Join a chatroom
- room:leave - Leave a chatroom

### Server to Client
- message:new - New message received
- message:delete - Message deleted
- message:reaction - Reaction updated
- member:joined - New member joined
- member:left - Member left
- typing - Typing indicator update
# Trading system deployed Sat Dec  6 12:37:48 AM EAT 2025
