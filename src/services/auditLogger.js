const { createClient } = require('@supabase/supabase-js');
const { retryOperation } = require('../utils/dbUtils');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);

/**
 * Audit Logger
 * Logs critical trading events for compliance and debugging
 */
class AuditLogger {

    /**
     * Log an event
     * @param {string} eventType - e.g. 'TRADE_EXECUTED', 'SESSION_START'
     * @param {Object} data - Event data
     * @param {Object} metadata - Context (userId, sessionId, etc)
     */
    async log(eventType, data, metadata = {}) {
        const logEntry = {
            event_type: eventType,
            data: data,
            user_id: metadata.userId,
            session_id: metadata.sessionId,
            ip_address: metadata.ip,
            created_at: new Date().toISOString()
        };

        console.log(`[Audit] ${eventType}:`, JSON.stringify(data).substring(0, 100) + '...');

        try {
            await retryOperation(async () => {
                const { error } = await supabase
                    .from('audit_logs')
                    .insert(logEntry);

                if (error) {
                    // If table doesn't exist, we might fail hard, but assuming schema exists
                    // If schema missing, we'll log error but not crash app
                    throw error;
                }
            });
        } catch (error) {
            console.error('[AuditLogger] Failed to persist log:', error.message);
            // Fallback to file logging if needed, or just console
        }
    }
}

module.exports = new AuditLogger();
