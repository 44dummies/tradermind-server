/**
 * Circuit Breaker pattern for API reliability
 */
class CircuitBreaker {
    constructor(options = {}) {
        this.failureThreshold = options.failureThreshold || 5;
        this.resetTimeout = options.resetTimeout || 60000; // 1 minute
        this.failureCount = 0;
        this.lastFailureTime = null;
        this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    }

    /**
     * Execute an async action through the breaker
     * @param {Function} action - Async function to execute
     */
    async execute(action) {
        if (this.state === 'OPEN') {
            if (Date.now() - this.lastFailureTime > this.resetTimeout) {
                this.state = 'HALF_OPEN';
                console.log('[CircuitBreaker] State: HALF_OPEN (Probing...)');
            } else {
                throw new Error('Circuit breaker is OPEN');
            }
        }

        try {
            const result = await action();

            if (this.state === 'HALF_OPEN') {
                this.reset();
                console.log('[CircuitBreaker] State: CLOSED (Recovered)');
            }

            return result;
        } catch (error) {
            this.recordFailure();
            throw error;
        }
    }

    recordFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();

        if (this.state === 'HALF_OPEN' || this.failureCount >= this.failureThreshold) {
            this.state = 'OPEN';
            console.warn(`[CircuitBreaker] State: OPEN (Failures: ${this.failureCount})`);
        }
    }

    reset() {
        this.failureCount = 0;
        this.lastFailureTime = null;
        this.state = 'CLOSED';
    }
}

module.exports = CircuitBreaker;
