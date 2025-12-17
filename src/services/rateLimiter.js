/**
 * Rate Limiter
 * Enforces limits on trade frequency per session/user
 */
const { messageQueue } = require('../queue');
const strategyConfig = require('../config/strategyConfig');

class RateLimiter {
    constructor(limits = {}) {
        const defaults = strategyConfig.rateLimits || {};
        this.limits = {
            tradesPerMinute: limits.tradesPerMinute || defaults.tradesPerMinute || 30,
            tradesPerHour: limits.tradesPerHour || defaults.tradesPerHour || 500
        };
    }

    /**
     * Check if action is allowed (Redis Persisted)
     * @param {string} sessionId
     * @throws {Error} if limit exceeded
     */
    async checkLimit(sessionId) {
        const redis = messageQueue.redis;
        if (!messageQueue.isReady() || !redis) {
            // If Redis down, fail open or strict? Strict is safer for spam.
            // But for MVP if Redis is down likely everything is broken.
            return;
        }

        const now = Date.now();
        const minuteKey = `ratelimit:${sessionId}:min:${Math.floor(now / 60000)}`;
        const hourKey = `ratelimit:${sessionId}:hour:${Math.floor(now / 3600000)}`;

        // We use Lua script or simple MULTI to check/incr
        // Or simpler: INCR and expire if new

        // 1. Check Minute Limit
        let minCount = await redis.get(minuteKey);
        if (minCount && parseInt(minCount) >= this.limits.tradesPerMinute) {
            throw new Error(`Rate limit exceeded: ${this.limits.tradesPerMinute} trades/min`);
        }

        // 2. Check Hour Limit
        let hourCount = await redis.get(hourKey);
        if (hourCount && parseInt(hourCount) >= this.limits.tradesPerHour) {
            throw new Error(`Rate limit exceeded: ${this.limits.tradesPerHour} trades/hour`);
        }

        // 3. Increment (Atomic)
        const multi = redis.multi();

        // Minute increment + expire 60s
        multi.incr(minuteKey);
        multi.expire(minuteKey, 60);

        // Hour increment + expire 3600s
        multi.incr(hourKey);
        multi.expire(hourKey, 3600);

        await multi.exec();
    }
}

module.exports = RateLimiter;
