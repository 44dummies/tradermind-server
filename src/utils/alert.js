/**
 * Alert Service - Sentry Integration
 * Centralized error tracking and alerting for the trading engine.
 */

const Sentry = require("@sentry/node");

// Initialize Sentry if DSN is configured
if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || 'development',
        tracesSampleRate: 1.0,
    });
    console.log('[Alert] ✅ Sentry initialized');
} else {
    console.log('[Alert] ⚠️ SENTRY_DSN not set, error tracking disabled');
}

/**
 * Capture and report an error to Sentry
 * @param {Error} err - The error to capture
 * @param {Object} context - Additional context (symbol, price, etc.)
 */
function captureError(err, context = {}) {
    console.error('[Alert] ❌ Error:', err.message);

    if (process.env.SENTRY_DSN) {
        Sentry.withScope((scope) => {
            Object.entries(context).forEach(([key, value]) => {
                scope.setExtra(key, value);
            });
            Sentry.captureException(err);
        });
    }
}

/**
 * Capture a warning message
 * @param {string} message - Warning message
 * @param {Object} context - Additional context
 */
function captureWarning(message, context = {}) {
    console.warn('[Alert] ⚠️ Warning:', message);

    if (process.env.SENTRY_DSN) {
        Sentry.captureMessage(message, {
            level: 'warning',
            extra: context
        });
    }
}

/**
 * Track repeated condition failures and alert if threshold exceeded
 * @param {string} conditionName - Name of the failing condition
 * @param {number} failureCount - Current failure count
 * @param {number} threshold - Alert threshold (default: 5)
 */
function checkFailureThreshold(conditionName, failureCount, threshold = 5) {
    if (failureCount >= threshold) {
        const message = `Condition "${conditionName}" has failed ${failureCount} times consecutively`;
        captureWarning(message, { conditionName, failureCount, threshold });
        return true;
    }
    return false;
}

/**
 * Send a custom alert for significant trading events
 * @param {string} eventType - Type of event (SIGNAL_GENERATED, TRADE_EXECUTED, etc.)
 * @param {Object} data - Event data
 */
function trackEvent(eventType, data = {}) {
    console.log(`[Alert] 📊 Event: ${eventType}`, data);

    if (process.env.SENTRY_DSN) {
        Sentry.addBreadcrumb({
            category: 'trading',
            message: eventType,
            data: data,
            level: 'info'
        });
    }
}

module.exports = {
    captureError,
    captureWarning,
    checkFailureThreshold,
    trackEvent
};
