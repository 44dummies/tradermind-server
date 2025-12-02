# TraderMind Real-time Server

Backend server for TraderMind trading platform with real-time chat and community features.

## Features

- 🔌 Real-time WebSocket chat with Socket.IO
- 👥 Community forums and discussions
- 🔐 JWT authentication
- 📊 Trade analytics integration
- 🗄️ Supabase PostgreSQL database

## Quick Deploy

### Option 1: Railway (Recommended - Free tier available)

1. Create account at [railway.app](https://railway.app)
2. Click "New Project" → "Deploy from GitHub repo"
3. Connect your GitHub and select this repo
4. Add environment variables (see below)
5. Deploy!

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new)

### Option 2: Render (Free tier available)

1. Create account at [render.com](https://render.com)
2. New → Web Service → Connect repo
3. Settings:
   - Build Command: `npm install`
   - Start Command: `npm start`
4. Add environment variables
5. Deploy!

### Option 3: Fly.io

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Login and deploy
fly auth login
fly launch
fly secrets set SUPABASE_URL=your-url SUPABASE_ANON_KEY=your-key JWT_SECRET=your-secret
fly deploy
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SUPABASE_URL` | Your Supabase project URL | ✅ |
| `SUPABASE_ANON_KEY` | Supabase anonymous key | ✅ |
| `JWT_SECRET` | Secret for JWT tokens (min 32 chars) | ✅ |
| `JWT_REFRESH_SECRET` | Secret for refresh tokens | ✅ |
| `JWT_EXPIRES_IN` | Token expiry (default: 24h) | ❌ |
| `PORT` | Server port (default: 3001) | ❌ |
| `NODE_ENV` | Environment (production/development) | ❌ |
| `CORS_ORIGIN` | Allowed origins (comma-separated) | ❌ |

## Local Development

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env
# Edit .env with your values

# Run in development mode
npm run dev

# Run in production mode
npm start
```

## API Endpoints

- `GET /health` - Health check
- `POST /api/auth/login` - Login with Deriv credentials
- `GET /api/chatrooms` - List chatrooms
- `GET /api/chatrooms/:id/messages` - Get room messages
- `POST /api/community/posts` - Create community post

## WebSocket Events

### Client → Server
- `joinRoom` - Join a chatroom
- `leaveRoom` - Leave a chatroom
- `sendMessage` - Send a message
- `typing` - Typing indicator

### Server → Client
- `newMessage` - New message received
- `userJoined` - User joined room
- `userLeft` - User left room
- `roomPresence` - Room presence update

## Frontend Configuration

After deploying, update your frontend `.env`:

```env
REACT_APP_SERVER_URL=https://your-backend-url.railway.app
REACT_APP_SOCKET_URL=https://your-backend-url.railway.app
REACT_APP_USE_REALTIME_BACKEND=true
```

## License

MIT
