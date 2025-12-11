/**
 * Session Worker - Manages session lifecycle events
 * Handles auto-stop timers, status updates, and session tracking
 */
const { messageQueue, TOPICS } = require('../queue');
const { supabase } = require('../db/supabase');
const { createSessionEvent, EVENT_TYPES } = require('../trading-engine/eventContract');

class SessionWorker {
    constructor() {
        this.isRunning = false;
        this.activeTimers = new Map(); // sessionId -> timeoutId
    }

    /**
     * Start the worker
     */
    async start() {
        if (this.isRunning) return;
        this.isRunning = true;

        console.log('[SessionWorker] Starting...');

        await messageQueue.subscribe(TOPICS.SESSION_EVENTS, async (event) => {
            await this.handleSessionEvent(event);
        });

        console.log('[SessionWorker] Started');
    }

    /**
     * Handle session events
     */
    async handleSessionEvent(event) {
        const { type, payload } = event;

        switch (type) {
            case EVENT_TYPES.SESSION_STARTED:
                await this.onSessionStarted(payload);
                break;
            case EVENT_TYPES.SESSION_STOPPED:
                await this.onSessionStopped(payload);
                break;
            case EVENT_TYPES.SESSION_PAUSED:
                await this.onSessionPaused(payload);
                break;
            case EVENT_TYPES.SESSION_RESUMED:
                await this.onSessionResumed(payload);
                break;
            case EVENT_TYPES.SESSION_AUTO_STOPPED:
                await this.onSessionAutoStopped(payload);
                break;
        }
    }

    /**
     * Handle session started
     */
    async onSessionStarted(payload) {
        const { sessionId, name, durationMinutes } = payload;

        console.log(`[SessionWorker] Session started: ${name}`);

        // Log activity
        await supabase.from('trading_activity_logs').insert({
            session_id: sessionId,
            action: 'session_started',
            details: { name, durationMinutes }
        });

        // Set auto-stop timer if duration is specified
        if (durationMinutes && durationMinutes > 0) {
            this.setAutoStopTimer(sessionId, durationMinutes);
        }
    }

    /**
     * Handle session stopped
     */
    async onSessionStopped(payload) {
        const { sessionId, name } = payload;

        console.log(`[SessionWorker] Session stopped: ${name}`);

        // Clear any pending timer
        this.clearAutoStopTimer(sessionId);

        // Log activity
        await supabase.from('trading_activity_logs').insert({
            session_id: sessionId,
            action: 'session_stopped',
            details: { name }
        });

        // Update all active participants to stopped
        await supabase
            .from('session_participants')
            .update({ status: 'stopped' })
            .eq('session_id', sessionId)
            .eq('status', 'active');
    }

    /**
     * Handle session paused
     */
    async onSessionPaused(payload) {
        const { sessionId } = payload;
        console.log(`[SessionWorker] Session paused: ${sessionId}`);

        // Pause the auto-stop timer (we would need to track remaining time)
        // For simplicity, we just clear it - timer restarts on resume
        this.clearAutoStopTimer(sessionId);
    }

    /**
     * Handle session resumed
     */
    async onSessionResumed(payload) {
        const { sessionId, remainingMinutes } = payload;
        console.log(`[SessionWorker] Session resumed: ${sessionId}`);

        if (remainingMinutes && remainingMinutes > 0) {
            this.setAutoStopTimer(sessionId, remainingMinutes);
        }
    }

    /**
     * Handle session auto-stopped (timer expired)
     */
    async onSessionAutoStopped(payload) {
        const { sessionId, name } = payload;

        console.log(`[SessionWorker] Session auto-stopped: ${name}`);

        // Update session status in DB
        await supabase
            .from('trading_sessions_v2')
            .update({ status: 'completed' })
            .eq('id', sessionId);

        // Log activity
        await supabase.from('trading_activity_logs').insert({
            session_id: sessionId,
            action: 'session_auto_stopped',
            details: { name, reason: 'Duration expired' }
        });
    }

    /**
     * Set auto-stop timer for a session
     */
    setAutoStopTimer(sessionId, durationMinutes) {
        // Clear existing timer if any
        this.clearAutoStopTimer(sessionId);

        const timeoutMs = durationMinutes * 60 * 1000;
        const timerId = setTimeout(async () => {
            console.log(`[SessionWorker] Auto-stop timer fired for session ${sessionId}`);

            // Publish auto-stop event
            const event = createSessionEvent(EVENT_TYPES.SESSION_AUTO_STOPPED, {
                id: sessionId,
                name: 'Session'
            });
            await messageQueue.publish(TOPICS.SESSION_EVENTS, event);

            this.activeTimers.delete(sessionId);
        }, timeoutMs);

        this.activeTimers.set(sessionId, timerId);
        console.log(`[SessionWorker] Auto-stop timer set: ${durationMinutes} minutes for session ${sessionId}`);
    }

    /**
     * Clear auto-stop timer
     */
    clearAutoStopTimer(sessionId) {
        const timerId = this.activeTimers.get(sessionId);
        if (timerId) {
            clearTimeout(timerId);
            this.activeTimers.delete(sessionId);
        }
    }

    /**
     * Stop the worker
     */
    async stop() {
        this.isRunning = false;

        // Clear all timers
        for (const [sessionId, timerId] of this.activeTimers) {
            clearTimeout(timerId);
        }
        this.activeTimers.clear();

        await messageQueue.unsubscribe(TOPICS.SESSION_EVENTS);
        console.log('[SessionWorker] Stopped');
    }

    /**
     * Get stats
     */
    getStats() {
        return {
            isRunning: this.isRunning,
            activeTimers: this.activeTimers.size
        };
    }
}

module.exports = new SessionWorker();
