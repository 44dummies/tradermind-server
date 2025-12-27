/**
 * User Dashboard Routes
 * Get user's balance, session status, and basic info
 */

const express = require('express');
const router = express.Router();
const { supabase } = require('../../db/supabase');

/**
 * GET /user/dashboard
 * Get user's dashboard data (balance, status, active session)
 */
router.get('/', async (req, res) => {
    try {
        const userId = req.user.id;

        // Get user profile
        const { data: profile } = await supabase
            .from('user_profiles')
            .select('id, deriv_id, username, fullname, email, is_admin')
            .eq('id', userId)
            .single();

        // Get user trading settings
        const { data: settings } = await supabase
            .from('user_trading_settings')
            .select('*')
            .eq('user_id', userId)
            .single();

        // Get current active session participation
        const { data: participation } = await supabase
            .from('session_participants')
            .select('*, trading_sessions_v2(*)')
            .eq('user_id', userId)
            .eq('status', 'active')
            .order('accepted_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        console.log('[Dashboard] Participation query result:', JSON.stringify(participation, null, 2));

        // Get available sessions to join
        const { data: availableSessions } = await supabase
            .from('trading_sessions_v2')
            .select('id, name, type, min_balance, default_tp, default_sl, status, staking_mode')
            .in('status', ['pending', 'running', 'active']) // Support both V1 and V2 statuses
            .order('created_at', { ascending: false });

        // Get unread notification count
        const { count: unreadCount } = await supabase
            .from('system_notifications')
            .select('*', { count: 'exact', head: true })
            .or(`user_id.eq.${userId},user_id.is.null`)
            .eq('read', false);

        // Helper to get session details if join failed or implies V1
        let sessionDetails = participation?.trading_sessions_v2;
        let sessionTableName = 'trading_sessions_v2';

        if (participation && !sessionDetails) {
            console.log('[Dashboard] Join failed, fetching session explicitly...');

            // Try V2 first
            let { data: v2Session } = await supabase
                .from('trading_sessions_v2')
                .select('*')
                .eq('id', participation.session_id)
                .single();

            if (v2Session) {
                sessionDetails = v2Session;
            } else {
                // Try V1
                console.log('[Dashboard] Fetching from V1 table...');
                const { data: v1Session } = await supabase
                    .from('trading_sessions')
                    .select('*')
                    .eq('id', participation.session_id)
                    .single();
                if (v1Session) {
                    sessionDetails = v1Session;
                    sessionTableName = 'trading_sessions';
                }
            }
        }

        res.json({
            user: profile,
            settings: settings || {
                default_tp: 10.00,
                default_sl: 5.00,
                can_join_recovery: false
            },
            currentSession: participation && sessionDetails ? {
                participantId: participation.id,
                sessionId: participation.session_id,
                sessionName: sessionDetails.name,
                sessionType: sessionDetails.type || sessionDetails.mode || 'standard',
                sessionStatus: sessionDetails.status,
                userStatus: participation.status,
                tp: participation.tp,
                sl: participation.sl,
                currentPnl: participation.current_pnl,
                acceptedAt: participation.accepted_at,
                // Add debug info
                _sourceTable: sessionTableName
            } : null,
            availableSessions: availableSessions || [],
            unreadNotifications: unreadCount || 0
        });
    } catch (error) {
        console.error('Get dashboard error:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard data' });
    }
});

module.exports = router;
