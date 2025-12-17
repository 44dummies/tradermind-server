const rateLimiter = require('./rateLimiter');
const correlationManager = require('./correlationManager');
const strategyConfig = require('../config/strategyConfig');

/**
 * Risk Engine
 * Centralized service to evaluate trade risk policies
 * Aggregates: Rate Limits, Correlation Checks, Session Risk (Max Loss, Drawdown), and Time/Market restraints.
 */
class RiskEngine {
    constructor() {
        this.rateLimiter = rateLimiter; // use singleton or instance?
        // Using singletons imported from modules assumes they are singletons.
        // In previous steps:
        // rateLimiter exported Class, but TradeExecutor instantiated it.
        // correlationManager exported 'new CorrelationManager()' (Singleton).
    }

    /**
     * Evaluate if a session is allowed to trade based on risk rules
     * @param {string} sessionId
     * @param {Object} sessionData
     * @param {Object} signal
     * @returns {Object} { allowed: boolean, reason: string }
     */
    evaluateTradeRisk(sessionId, sessionData, signal) {
        // 1. Session Status Check
        if (sessionData.status !== 'active') {
            return { allowed: false, reason: `session_${sessionData.status}` };
        }

        // 2. Rate Limit Check
        try {
            // We need a rate limiter instance. If TradeExecutor managed it per instance, 
            // we might need to change how we access it. 
            // For now, we'll assume we can pass the limiter or use a shared one.
            // Let's rely on the passed-in limiter or manage one here if we move it entirely.
            // RateLimiter in TradeExecutor was `this.rateLimiter`.
            // Let's keep RateLimiter logic here if we can source the instance.
            // Actually, simplest refactor: RiskEngine should be a Class that TradeExecutor has an instance of.
        } catch (e) {
            // ...
        }
    }
}

// Rewriting strategy:
// RiskEngine will be instantiated BY TradeExecutor, or be a Singleton.
// Since RateLimiter is stateful per session (conceptually) but currently implemented as strict in-memory map in the class,
// A Singleton RiskEngine holding the RateLimiter is fine.

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
