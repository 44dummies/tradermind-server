const rateLimiter = require('./rateLimiter');
const correlationManager = require('./correlationManager');
const strategyConfig = require('../config/strategyConfig');

/* Re-importing cleanly */
const RateLimiter = require('./rateLimiter');
const globalRateLimiter = new RateLimiter(); // Shared limiter for the system

class RiskEngine {
    constructor() {
        this.rateLimiter = globalRateLimiter;
        this.correlationManager = correlationManager;
    }

    /**
     * Comprehensive Risk Check
     */
    checkRisk(sessionId, sessionData, signal) {
        // 1. Rate Limit
        try {
            this.rateLimiter.checkLimit(sessionId);
        } catch (e) {
            return { allowed: false, reason: 'rate_limit', detail: e.message };
        }

        // 2. Correlation / Risk Guard
        if (!this.correlationManager.canEnterTrade(signal.market)) {
            return { allowed: false, reason: 'risk_guard_limit', detail: 'Max concurrent trades reached' };
        }

        // 3. Session Max Loss
        const maxLoss = sessionData.max_loss || sessionData.stop_loss_limit;
        if (maxLoss && sessionData.current_pnl <= -Math.abs(maxLoss)) {
            return { allowed: false, reason: 'session_max_loss', detail: 'Session hit max loss limit' };
        }

        // 4. Drawdown Check
        if (sessionData.max_drawdown_limit) {
            if (sessionData.current_pnl <= -Math.abs(sessionData.max_drawdown_limit)) {
                return { allowed: false, reason: 'session_drawdown', detail: 'Session hit drawdown limit' };
            }
        }

        // 5. Regime/Signal check (if passed)
        if (signal.regime === 'CHAOS') {
            return { allowed: false, reason: 'regime_chaos', detail: 'Market in CHAOS regime' };
        }

        return { allowed: true };
    }

    registerTrade(trade) {
        this.correlationManager.registerTrade(trade.contractId, trade.market);
    }

    deregisterTrade(trade) {
        this.correlationManager.deregisterTrade(trade.contractId, trade.market);
    }
}

module.exports = new RiskEngine();
