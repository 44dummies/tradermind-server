/**
 * User Sessions Routes
 * Accept/view sessions
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../../db/supabase');

/**
 * GET /user/sessions/available
 * Get available sessions to join
 */
router.get('/available', async (req, res) => {
    try {
        const userId = req.user.id;

        // Get user's recovery eligibility
        const { data: settings } = await supabase
            .from('user_trading_settings')
            .select('can_join_recovery')
            .eq('user_id', userId)
            .single();

        const canJoinRecovery = settings?.can_join_recovery || false;

        // Get available sessions
        let query = supabase
            .from('trading_sessions_v2')
            .select('id, name, type, min_balance, default_tp, default_sl, status, created_at')
            .in('status', ['pending', 'running'])
            .order('created_at', { ascending: false });

        // Filter recovery sessions for eligible users only
        if (!canJoinRecovery) {
            query = query.neq('type', 'recovery');
        }

        const { data: sessions, error } = await query;

        if (error) throw error;

        // Check which sessions user has already joined
        const { data: participations } = await supabase
            .from('session_participants')
            .select('session_id')
            .eq('user_id', userId)
            .in('status', ['active', 'pending']);

        const joinedSessionIds = (participations || []).map(p => p.session_id);

        const availableSessions = (sessions || []).map(s => ({
            ...s,
            hasJoined: joinedSessionIds.includes(s.id)
        }));

        res.json({ sessions: availableSessions });
    } catch (error) {
        console.error('Get available sessions error:', error);
        res.status(500).json({ error: 'Failed to fetch available sessions' });
    }
});

/**
 * GET /user/sessions/status
 * Get current session status
 */
router.get('/status', async (req, res) => {
    try {
        const userId = req.user.id;

        const { data: participation, error } = await supabase
            .from('session_participants')
            .select('*, trading_sessions_v2(*)')
            .eq('user_id', userId)
            .order('accepted_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) throw error;

        if (!participation) {
            return res.json({
                status: 'none',
                message: 'Not participating in any session'
            });
        }

        res.json({
            status: participation.status,
            session: {
                id: participation.session_id,
                name: participation.trading_sessions_v2?.name,
                type: participation.trading_sessions_v2?.type,
                sessionStatus: participation.trading_sessions_v2?.status
            },
            tp: participation.tp,
            sl: participation.sl,
            currentPnl: participation.current_pnl,
            initialBalance: participation.initial_balance,
            acceptedAt: participation.accepted_at,
            removedAt: participation.removed_at,
            removalReason: participation.removal_reason
        });
    } catch (error) {
        console.error('Get session status error:', error);
        res.status(500).json({ error: 'Failed to fetch session status' });
    }
});

/**
 * POST /user/sessions/accept
 * Accept/join a trading session
 */
router.post('/accept', async (req, res) => {
    try {
        const userId = req.user.id;
        const { sessionId, tp, sl } = req.body;

        if (!sessionId) {
            return res.status(400).json({ error: 'Session ID is required' });
        }

        // Get session details
        const { data: session, error: sessionError } = await supabase
            .from('trading_sessions_v2')
            .select('*')
            .eq('id', sessionId)
            .single();

        if (sessionError || !session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        if (!['pending', 'running'].includes(session.status)) {
            return res.status(400).json({ error: 'Session is not accepting participants' });
        }

        // Check if user is already in this session
        const { data: existingParticipation } = await supabase
            .from('session_participants')
            .select('id, status')
            .eq('user_id', userId)
            .eq('session_id', sessionId)
            .single();

        if (existingParticipation) {
            if (existingParticipation.status === 'active') {
                return res.status(400).json({ error: 'Already participating in this session' });
            }
            // If previously removed, don't allow re-joining
            return res.status(400).json({ error: 'Cannot rejoin this session' });
        }

        // Check recovery eligibility
        if (session.type === 'recovery') {
            const { data: settings } = await supabase
                .from('user_trading_settings')
                .select('can_join_recovery')
                .eq('user_id', userId)
                .single();

            if (!settings?.can_join_recovery) {
                return res.status(403).json({ error: 'Not eligible for recovery session' });
            }
        }

        // Get user's TP/SL settings
        const { data: userSettings } = await supabase
            .from('user_trading_settings')
            .select('default_tp, default_sl')
            .eq('user_id', userId)
            .single();

        const finalTp = tp !== undefined ? tp : (userSettings?.default_tp || session.default_tp);
        const finalSl = sl !== undefined ? sl : (userSettings?.default_sl || session.default_sl);

        // Validate TP/SL against session minimums
        if (finalTp < session.default_tp) {
            return res.status(400).json({
                error: `TP must be at least ${session.default_tp}`
            });
        }
        if (finalSl < session.default_sl) {
            return res.status(400).json({
                error: `SL must be at least ${session.default_sl}`
            });
        }

        // Create participation
        const participation = {
            id: uuidv4(),
            session_id: sessionId,
            user_id: userId,
            tp: finalTp,
            sl: finalSl,
            status: 'active',
            current_pnl: 0,
            accepted_at: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('session_participants')
            .insert(participation)
            .select()
            .single();

        if (error) throw error;

        // If this was a recovery session, clear the recovery flag
        if (session.type === 'recovery') {
            await supabase
                .from('user_trading_settings')
                .update({ can_join_recovery: false })
                .eq('user_id', userId);
        }

        res.status(201).json({
            success: true,
            message: 'Successfully joined session',
            participation: data
        });
    } catch (error) {
        console.error('Accept session error:', error);
        res.status(500).json({ error: 'Failed to join session' });
    }
});

/**
 * POST /user/sessions/leave
 * Leave current session
 */
router.post('/leave', async (req, res) => {
    try {
        const userId = req.user.id;
        const { sessionId } = req.body;

        const { data, error } = await supabase
            .from('session_participants')
            .update({
                status: 'left',
                removed_at: new Date().toISOString(),
                removal_reason: 'user_left'
            })
            .eq('user_id', userId)
            .eq('session_id', sessionId)
            .eq('status', 'active')
            .select()
            .single();

        if (error) throw error;

        res.json({
            success: true,
            message: 'Left session successfully'
        });
    } catch (error) {
        console.error('Leave session error:', error);
        res.status(500).json({ error: 'Failed to leave session' });
    }
});

module.exports = router;
