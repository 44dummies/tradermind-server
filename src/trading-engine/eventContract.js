/**
 * Event Contract - Unified event format for all trading events
 * All services publish and consume events using this format
 */
const crypto = require('crypto');

const EVENT_TYPES = {
    // Signal events
    SIGNAL_GENERATED: 'signal.generated',
    SIGNAL_VALIDATED: 'signal.validated',
    SIGNAL_REJECTED: 'signal.rejected',

    // Trade events
    TRADE_PENDING: 'trade.pending',
    TRADE_EXECUTED: 'trade.executed',
    TRADE_CLOSED: 'trade.closed',
    TRADE_FAILED: 'trade.failed',

    // Session events
    SESSION_STARTED: 'session.started',
    SESSION_STOPPED: 'session.stopped',
    SESSION_PAUSED: 'session.paused',
    SESSION_RESUMED: 'session.resumed',
    SESSION_AUTO_STOPPED: 'session.auto_stopped',

    // Notification events
    NOTIFICATION_TRADE: 'notification.trade',
    NOTIFICATION_SESSION: 'notification.session',
    NOTIFICATION_ALERT: 'notification.alert',
};

/**
 * Create a trade event with unified format
 * @param {string} type - Event type from EVENT_TYPES
 * @param {object} payload - Event-specific data
 * @param {object} context - Context info (sessionId, userId, etc.)
 * @returns {object} Formatted trade event
 */
function createTradeEvent(type, payload, context = {}) {
    return {
        id: crypto.randomUUID(),
        type,
        timestamp: Date.now(),
        sessionId: context.sessionId || null,
        userId: context.userId || null,
        correlationId: context.correlationId || crypto.randomUUID(),
        payload
    };
}

/**
 * Signal event payload
 * @typedef {Object} SignalPayload
 * @property {string} symbol - Trading symbol (e.g., 'R_100')
 * @property {string} direction - 'CALL' or 'PUT' or 'OVER' or 'UNDER'
 * @property {number} confidence - Signal confidence 0-1
 * @property {number} [digit] - Digit for digit trades
 * @property {object} [analysis] - Strategy analysis data
 */
function createSignalEvent(signal, sessionId) {
    return createTradeEvent(EVENT_TYPES.SIGNAL_GENERATED, {
        symbol: signal.market || signal.symbol,
        direction: signal.side || signal.direction,
        confidence: signal.confidence,
        digit: signal.digit,
        analysis: signal.analysis || null
    }, { sessionId, correlationId: crypto.randomUUID() });
}

/**
 * Trade executed event payload
 * @typedef {Object} TradePayload
 * @property {string} contractId - Deriv contract ID
 * @property {string} symbol - Trading symbol
 * @property {string} direction - Trade direction
 * @property {number} stake - Trade stake
 * @property {number} entryPrice - Entry spot price
 * @property {number} startTime - Trade start epoch
 */
function createTradeExecutedEvent(trade, context) {
    return createTradeEvent(EVENT_TYPES.TRADE_EXECUTED, {
        contractId: trade.contract_id,
        symbol: trade.symbol,
        direction: trade.direction,
        stake: trade.stake,
        entryPrice: trade.entry_price,
        startTime: trade.start_time,
        participantId: trade.participant_id
    }, context);
}

/**
 * Trade closed event payload
 */
function createTradeClosedEvent(trade, reason, finalPL, context) {
    return createTradeEvent(EVENT_TYPES.TRADE_CLOSED, {
        contractId: trade.contract_id,
        symbol: trade.symbol,
        direction: trade.direction,
        stake: trade.stake,
        profitLoss: finalPL,
        closeReason: reason, // 'TP_REACHED', 'SL_REACHED', 'EXPIRED', 'MANUAL'
        participantId: trade.participant_id
    }, context);
}

/**
 * Session event
 */
function createSessionEvent(type, session, context = {}) {
    return createTradeEvent(type, {
        sessionId: session.id,
        name: session.name,
        mode: session.mode,
        status: session.status
    }, { sessionId: session.id, ...context });
}

/**
 * Notification event
 */
function createNotificationEvent(userId, notification, context = {}) {
    return createTradeEvent(EVENT_TYPES.NOTIFICATION_TRADE, {
        title: notification.title,
        message: notification.message,
        type: notification.type,
        data: notification.data
    }, { userId, ...context });
}

module.exports = {
    EVENT_TYPES,
    createTradeEvent,
    createSignalEvent,
    createTradeExecutedEvent,
    createTradeClosedEvent,
    createSessionEvent,
    createNotificationEvent
};
