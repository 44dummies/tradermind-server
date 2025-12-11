/**
 * Redis Message Queue - Event-driven message broker using Redis Streams
 * Provides publish/subscribe with consumer groups for scalable event processing
 */
const Redis = require('ioredis');

// Queue topic definitions
const TOPICS = {
    TRADE_SIGNALS: 'trade:signals',
    TRADE_EXECUTED: 'trade:executed',
    TRADE_CLOSED: 'trade:closed',
    NOTIFICATIONS: 'notifications',
    SESSION_EVENTS: 'session:events'
};

class MessageQueue {
    constructor() {
        this.redis = null;
        this.subscribers = new Map(); // topic -> subscriber Redis client
        this.handlers = new Map(); // topic -> handler function
        this.isConnected = false;
        this.consumerGroup = 'tradermind-workers';
        this.consumerId = `worker-${process.pid}-${Date.now()}`;
    }

    /**
     * Initialize Redis connection
     * @param {string} redisUrl - Redis connection URL (from Railway)
     */
    async connect(redisUrl = process.env.REDIS_URL) {
        if (this.isConnected) return;

        try {
            // Main publisher connection
            this.redis = new Redis(redisUrl || 'redis://localhost:6379', {
                maxRetriesPerRequest: 3,
                retryDelayOnFailover: 100,
                lazyConnect: true
            });

            await this.redis.connect();
            this.isConnected = true;
            console.log('[MessageQueue] Connected to Redis');

            // Initialize streams and consumer groups
            await this.initializeStreams();

        } catch (error) {
            console.error('[MessageQueue] Connection failed:', error.message);
            // Fallback: run without Redis (direct calls)
            this.isConnected = false;
        }
    }

    /**
     * Initialize Redis streams and consumer groups
     */
    async initializeStreams() {
        for (const topic of Object.values(TOPICS)) {
            try {
                // Create consumer group (will fail if already exists, which is fine)
                await this.redis.xgroup('CREATE', topic, this.consumerGroup, '0', 'MKSTREAM');
                console.log(`[MessageQueue] Created consumer group for ${topic}`);
            } catch (err) {
                // Group already exists - this is expected
                if (!err.message.includes('BUSYGROUP')) {
                    console.warn(`[MessageQueue] Stream ${topic}:`, err.message);
                }
            }
        }
    }

    /**
     * Publish event to a stream
     * @param {string} topic - Topic name from TOPICS
     * @param {object} event - Event data (should follow eventContract format)
     */
    async publish(topic, event) {
        if (!this.isConnected) {
            console.warn('[MessageQueue] Not connected, event not queued:', topic);
            return null;
        }

        try {
            const messageId = await this.redis.xadd(
                topic,
                '*', // Auto-generate ID
                'data', JSON.stringify(event)
            );

            console.log(`[MessageQueue] Published to ${topic}:`, messageId);
            return messageId;
        } catch (error) {
            console.error(`[MessageQueue] Publish error on ${topic}:`, error.message);
            return null;
        }
    }

    /**
     * Subscribe to a stream with consumer group
     * Provides automatic acknowledgment and retry
     * @param {string} topic - Topic to subscribe to
     * @param {function} handler - Async handler function (event) => Promise<void>
     */
    async subscribe(topic, handler) {
        if (!this.isConnected) {
            console.warn('[MessageQueue] Not connected, skipping subscription:', topic);
            return;
        }

        // Create separate connection for blocking reads
        const subscriber = this.redis.duplicate();
        await subscriber.connect();
        this.subscribers.set(topic, subscriber);
        this.handlers.set(topic, handler);

        console.log(`[MessageQueue] Subscribed to ${topic}`);

        // Start consuming in background
        this.consumeLoop(topic, subscriber, handler);
    }

    /**
     * Consume loop for a topic
     */
    async consumeLoop(topic, subscriber, handler) {
        while (this.subscribers.has(topic)) {
            try {
                // First, claim any pending messages (for retry)
                const pending = await subscriber.xreadgroup(
                    'GROUP', this.consumerGroup, this.consumerId,
                    'COUNT', 10,
                    'BLOCK', 5000,
                    'STREAMS', topic, '>'
                );

                if (pending) {
                    for (const [stream, messages] of pending) {
                        for (const [messageId, fields] of messages) {
                            try {
                                const event = JSON.parse(fields[1]); // fields = ['data', jsonString]
                                await handler(event);

                                // Acknowledge successful processing
                                await subscriber.xack(topic, this.consumerGroup, messageId);
                            } catch (handlerError) {
                                console.error(`[MessageQueue] Handler error for ${messageId}:`, handlerError.message);
                                // Message will be retried on next pending claim
                            }
                        }
                    }
                }
            } catch (error) {
                if (!error.message.includes('Connection is closed')) {
                    console.error(`[MessageQueue] Consume error on ${topic}:`, error.message);
                }
                await this.sleep(1000); // Brief pause on error
            }
        }
    }

    /**
     * Unsubscribe from a topic
     */
    async unsubscribe(topic) {
        const subscriber = this.subscribers.get(topic);
        if (subscriber) {
            this.subscribers.delete(topic);
            this.handlers.delete(topic);
            await subscriber.quit();
            console.log(`[MessageQueue] Unsubscribed from ${topic}`);
        }
    }

    /**
     * Get stream info for monitoring
     */
    async getStreamInfo(topic) {
        if (!this.isConnected) return null;

        try {
            return await this.redis.xinfo('STREAM', topic);
        } catch (error) {
            return null;
        }
    }

    /**
     * Disconnect all connections
     */
    async disconnect() {
        for (const [topic, subscriber] of this.subscribers) {
            await subscriber.quit();
        }
        this.subscribers.clear();
        this.handlers.clear();

        if (this.redis) {
            await this.redis.quit();
            this.redis = null;
        }
        this.isConnected = false;
        console.log('[MessageQueue] Disconnected');
    }

    /**
     * Check if connected
     */
    isReady() {
        return this.isConnected;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Singleton instance
const messageQueue = new MessageQueue();

module.exports = {
    messageQueue,
    TOPICS
};
