/**
 * Rate Limiter
 * Enforces limits on trade frequency per session/user
 */
class RateLimiter {
    constructor(limits = {}) {
        this.limits = {
            tradesPerMinute: limits.tradesPerMinute || 30,
            tradesPerHour: limits.tradesPerHour || 500
        };
        this.counters = new Map(); // sessionId -> { minuteCount, minuteStart, hourCount, hourStart }
    }

    /**
     * Check if action is allowed
     * @param {string} sessionId
     * @throws {Error} if limit exceeded
     */
    checkLimit(sessionId) {
        const now = Date.now();
        let counter = this.counters.get(sessionId);

        if (!counter) {
            counter = {
                minuteCount: 0,
                minuteStart: now,
                hourCount: 0,
                hourStart: now
            };
            this.counters.set(sessionId, counter);
        }

        // Reset minute counter
        if (now - counter.minuteStart > 60000) {
            counter.minuteCount = 0;
            counter.minuteStart = now;
        }

        // Reset hour counter
        if (now - counter.hourStart > 3600000) {
            counter.hourCount = 0;
            counter.hourStart = now;
        }

        if (counter.minuteCount >= this.limits.tradesPerMinute) {
            throw new Error(`Rate limit exceeded: ${this.limits.tradesPerMinute} trades/min`);
        }

        if (counter.hourCount >= this.limits.tradesPerHour) {
            throw new Error(`Rate limit exceeded: ${this.limits.tradesPerHour} trades/hour`);
        }

        // Increment
        counter.minuteCount++;
        counter.hourCount++;
    }
}

module.exports = RateLimiter;
