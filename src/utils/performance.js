const { performance } = require('perf_hooks');

/**
 * Performance monitoring utility
 */
class PerformanceMonitor {
    constructor() {
        this.metrics = new Map();
    }

    /**
     * Start a timer
     * @param {string} id - Unique identifier
     */
    start(id) {
        this.metrics.set(id, performance.now());
    }

    /**
     * End a timer and return duration in ms
     * @param {string} id - Unique identifier
     * @returns {number|null} Duration in ms or null if not found
     */
    end(id) {
        if (!this.metrics.has(id)) return null;
        const start = this.metrics.get(id);
        const duration = performance.now() - start;
        this.metrics.delete(id);
        return duration;
    }

    /**
     * Log latency if it exceeds threshold
     * @param {string} context - What we are measuring
     * @param {number} duration - Duration in ms
     * @param {number} threshold - Threshold in ms (default 100)
     */
    logLatency(context, duration, threshold = 100) {
        if (duration > threshold) {
            console.warn(`[Performance] ${context} took ${duration.toFixed(2)}ms (Threshold: ${threshold}ms)`);
        }
    }
}

module.exports = new PerformanceMonitor();
