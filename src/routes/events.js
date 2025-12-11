/**
 * SSE Events Route - Server-Sent Events for real-time dashboard
 * Replaces direct WebSocket polling with efficient server push
 */
const express = require('express');
const router = express.Router();
const { messageQueue, TOPICS } = require('../queue');
const { authMiddleware } = require('../middleware/auth');

// Track connected SSE clients
const clients = new Map(); // userId -> response object
let eventBuffer = []; // Buffer recent events for replay on reconnect
const MAX_BUFFER_SIZE = 100;

/**
 * SSE endpoint - Stream events to connected clients
 * GET /api/events/stream?topics=trades,sessions,notifications
 */
router.get('/stream', authMiddleware, (req, res) => {
    const userId = req.userId;
    const requestedTopics = (req.query.topics || 'all').split(',');

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ userId, topics: requestedTopics })}\n\n`);

    // Store client connection
    const clientInfo = { res, topics: requestedTopics, userId, connectedAt: Date.now() };
    clients.set(userId, clientInfo);

    console.log(`[SSE] Client connected: ${userId}, topics: ${requestedTopics}`);

    // Send buffered recent events on reconnect
    const lastEventId = req.headers['last-event-id'];
    if (lastEventId) {
        const replayEvents = eventBuffer.filter(e => e.id > lastEventId);
        replayEvents.forEach(event => sendEventToClient(clientInfo, event));
    }

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
        res.write(`:heartbeat\n\n`);
    }, 30000);

    // Cleanup on disconnect
    req.on('close', () => {
        clients.delete(userId);
        clearInterval(heartbeat);
        console.log(`[SSE] Client disconnected: ${userId}`);
    });
});

/**
 * Admin SSE endpoint - All events for admin dashboard
 * GET /api/events/admin-stream
 */
router.get('/admin-stream', authMiddleware, (req, res) => {
    // Check admin role
    if (req.userRole !== 'admin' && req.userRole !== 'staff') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const userId = `admin-${req.userId}`;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    res.write(`event: connected\ndata: ${JSON.stringify({ userId, admin: true })}\n\n`);

    const clientInfo = { res, topics: ['all'], userId, isAdmin: true, connectedAt: Date.now() };
    clients.set(userId, clientInfo);

    const heartbeat = setInterval(() => {
        res.write(`:heartbeat\n\n`);
    }, 30000);

    req.on('close', () => {
        clients.delete(userId);
        clearInterval(heartbeat);
    });
});

/**
 * Send event to specific client
 */
function sendEventToClient(client, event) {
    try {
        const eventType = event.type.split('.')[0]; // 'trade.executed' -> 'trade'

        // Check if client is subscribed to this topic
        if (!client.topics.includes('all') && !client.topics.includes(eventType)) {
            return;
        }

        // For non-admin clients, only send their own events
        if (!client.isAdmin && event.userId && event.userId !== client.userId) {
            return;
        }

        client.res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    } catch (error) {
        console.error('[SSE] Error sending event:', error.message);
    }
}

/**
 * Broadcast event to all connected clients
 */
function broadcastEvent(event) {
    // Add to buffer for replay
    eventBuffer.push(event);
    if (eventBuffer.length > MAX_BUFFER_SIZE) {
        eventBuffer = eventBuffer.slice(-MAX_BUFFER_SIZE);
    }

    for (const [userId, client] of clients) {
        sendEventToClient(client, event);
    }
}

/**
 * Get connected clients count
 */
router.get('/status', authMiddleware, (req, res) => {
    res.json({
        connectedClients: clients.size,
        bufferSize: eventBuffer.length,
        queueConnected: messageQueue.isReady()
    });
});

/**
 * Initialize SSE bridge - Subscribe to message queue and broadcast
 */
async function initSSEBridge() {
    if (!messageQueue.isReady()) {
        console.log('[SSE] Message queue not ready, SSE bridge not initialized');
        return;
    }

    // Subscribe to all topics and broadcast to SSE clients
    const topicsToWatch = [
        TOPICS.TRADE_EXECUTED,
        TOPICS.TRADE_CLOSED,
        TOPICS.NOTIFICATIONS,
        TOPICS.SESSION_EVENTS
    ];

    for (const topic of topicsToWatch) {
        await messageQueue.subscribe(topic, async (event) => {
            broadcastEvent(event);
        });
    }

    console.log('[SSE] Bridge initialized, watching:', topicsToWatch);
}

// Export for direct broadcasting (before queue is ready)
function directBroadcast(event) {
    broadcastEvent(event);
}

module.exports = router;
module.exports.initSSEBridge = initSSEBridge;
module.exports.directBroadcast = directBroadcast;
module.exports.getConnectedClients = () => clients.size;
