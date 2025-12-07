/**
 * Admin Sessions Routes
 * CRUD operations for trading sessions
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../../db/supabase');

// Session types
const SESSION_TYPE = {
    DAY: 'day',
    ONE_TIME: 'one_time',
    RECOVERY: 'recovery'
};

// Session statuses
const SESSION_STATUS = {
    PENDING: 'pending',
    RUNNING: 'running',
    PAUSED: 'paused',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled'
};

/**
 * GET /admin/sessions
 * List all sessions with optional filters
 */
router.get('/', async (req, res) => {
    try {
        const { status, type, limit = 50 } = req.query;

        let query = supabase
            .from('trading_sessions_v2')
            .select('*, session_participants(count)')
            .order('created_at', { ascending: false })
            .limit(parseInt(limit));

        if (status) {
            query = query.eq('status', status);
        }
        if (type) {
            query = query.eq('type', type);
        }

        const { data, error } = await query;

        if (error) throw error;

        res.json({ sessions: data || [] });
    } catch (error) {
        console.error('Get sessions error:', error);
        res.status(500).json({ error: 'Failed to fetch sessions' });
    }
});

/**
 * GET /admin/sessions/:id
 * Get single session details with participants
 */
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const { data: session, error } = await supabase
            .from('trading_sessions_v2')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // Get participants
        const { data: participants } = await supabase
            .from('session_participants')
            .select('*, user_profiles(id, deriv_id, username, fullname)')
            .eq('session_id', id);

        res.json({
            session,
            participants: participants || []
        });
    } catch (error) {
        console.error('Get session error:', error);
        res.status(500).json({ error: 'Failed to fetch session' });
    }
});

/**
 * POST /admin/sessions
 * Create a new trading session
 */
router.post('/', async (req, res) => {
    try {
        const {
            name,
            type = SESSION_TYPE.DAY,
            minBalance = 10.00,
            defaultTp = 10.00,
            defaultSl = 5.00,
            markets = ['R_100'],
            strategy = 'DFPM',
            stakingMode = 'fixed',
            baseStake = 1.00
        } = req.body;

        // Validate type
        if (!Object.values(SESSION_TYPE).includes(type)) {
            return res.status(400).json({ error: 'Invalid session type' });
        }

        const sessionData = {
            id: uuidv4(),
            admin_id: req.user.id,
            name: name || `${type.charAt(0).toUpperCase() + type.slice(1)} Session - ${new Date().toLocaleDateString()}`,
            type,
            status: SESSION_STATUS.PENDING,
            min_balance: minBalance,
            default_tp: defaultTp,
            default_sl: defaultSl,
            markets,
            strategy,
            staking_mode: stakingMode,
            base_stake: baseStake,
            current_pnl: 0,
            trade_count: 0,
            win_count: 0,
            loss_count: 0,
            created_at: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('trading_sessions_v2')
            .insert(sessionData)
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({ session: data });
    } catch (error) {
        console.error('Create session error:', error);
        res.status(500).json({ error: 'Failed to create session' });
    }
});

/**
 * PUT /admin/sessions/:id
 * Update an existing session
 */
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        // Map camelCase to snake_case
        const dbUpdates = {};
        if (updates.name !== undefined) dbUpdates.name = updates.name;
        if (updates.minBalance !== undefined) dbUpdates.min_balance = updates.minBalance;
        if (updates.defaultTp !== undefined) dbUpdates.default_tp = updates.defaultTp;
        if (updates.defaultSl !== undefined) dbUpdates.default_sl = updates.defaultSl;
        if (updates.markets !== undefined) dbUpdates.markets = updates.markets;
        if (updates.strategy !== undefined) dbUpdates.strategy = updates.strategy;
        if (updates.stakingMode !== undefined) dbUpdates.staking_mode = updates.stakingMode;
        if (updates.baseStake !== undefined) dbUpdates.base_stake = updates.baseStake;
        if (updates.status !== undefined) dbUpdates.status = updates.status;

        dbUpdates.updated_at = new Date().toISOString();

        const { data, error } = await supabase
            .from('trading_sessions_v2')
            .update(dbUpdates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.json({ session: data });
    } catch (error) {
        console.error('Update session error:', error);
        res.status(500).json({ error: 'Failed to update session' });
    }
});

/**
 * DELETE /admin/sessions/:id
 * Delete a session (only if not running)
 */
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Check if session is running
        const { data: session } = await supabase
            .from('trading_sessions_v2')
            .select('status')
            .eq('id', id)
            .single();

        if (session && session.status === SESSION_STATUS.RUNNING) {
            return res.status(400).json({ error: 'Cannot delete a running session. Stop it first.' });
        }

        // Delete participants first
        await supabase
            .from('session_participants')
            .delete()
            .eq('session_id', id);

        // Delete session
        const { error } = await supabase
            .from('trading_sessions_v2')
            .delete()
            .eq('id', id);

        if (error) throw error;

        res.json({ success: true });
    } catch (error) {
        console.error('Delete session error:', error);
        res.status(500).json({ error: 'Failed to delete session' });
    }
});

/**
 * POST /admin/sessions/:id/start
 * Start a session
 */
router.post('/:id/start', async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from('trading_sessions_v2')
            .update({
                status: SESSION_STATUS.RUNNING,
                started_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.json({ session: data });
    } catch (error) {
        console.error('Start session error:', error);
        res.status(500).json({ error: 'Failed to start session' });
    }
});

/**
 * POST /admin/sessions/:id/stop
 * Stop a session
 */
router.post('/:id/stop', async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from('trading_sessions_v2')
            .update({
                status: SESSION_STATUS.COMPLETED,
                ended_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.json({ session: data });
    } catch (error) {
        console.error('Stop session error:', error);
        res.status(500).json({ error: 'Failed to stop session' });
    }
});

module.exports = router;
