/**
 * Admin Users Routes
 * Manage user accounts and roles
 */

const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

/**
 * GET /admin/users
 * Get all users with optional filters
 */
router.get('/', async (req, res) => {
    try {
        const { limit = 100, offset = 0, role, search } = req.query;

        let query = supabase
            .from('user_profiles')
            .select('id, deriv_id, username, fullname, email, is_admin, is_online, created_at, last_seen, performance_tier, role')
            .order('created_at', { ascending: false })
            .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

        if (role === 'admin') {
            query = query.eq('is_admin', true);
        } else if (role === 'user') {
            query = query.eq('is_admin', false);
        }

        if (search) {
            query = query.or(`deriv_id.ilike.%${search}%,username.ilike.%${search}%,fullname.ilike.%${search}%,email.ilike.%${search}%`);
        }

        const { data: users, error } = await query;

        if (error) {
            console.error('Error fetching users:', error);
            return res.status(500).json({ error: 'Failed to fetch users' });
        }

        res.json({ users: users || [] });
    } catch (error) {
        console.error('Error in GET /admin/users:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /admin/users/:userId
 * Get single user by ID
 */
router.get('/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const { data: user, error } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('id', userId)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({ error: 'User not found' });
            }
            console.error('Error fetching user:', error);
            return res.status(500).json({ error: 'Failed to fetch user' });
        }

        // Get user's trading stats
        const { data: stats } = await supabase
            .from('user_session_results')
            .select('total_trades, wins, losses, pnl')
            .eq('user_id', userId);

        const tradingStats = {
            totalTrades: 0,
            winRate: 0,
            totalProfit: 0,
            sessionsJoined: 0
        };

        if (stats && stats.length > 0) {
            tradingStats.sessionsJoined = stats.length;
            stats.forEach(s => {
                tradingStats.totalTrades += s.total_trades || 0;
                tradingStats.totalProfit += s.pnl || 0;
            });
            const totalWins = stats.reduce((sum, s) => sum + (s.wins || 0), 0);
            if (tradingStats.totalTrades > 0) {
                tradingStats.winRate = (totalWins / tradingStats.totalTrades) * 100;
            }
        }

        // Get recent activity
        const { data: activity } = await supabase
            .from('trading_activity_logs')
            .select('action, metadata, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(10);

        res.json({
            ...user,
            stats: tradingStats,
            recentActivity: (activity || []).map(a => ({
                type: a.action_type,
                description: a.action_details?.message || a.action_type,
                timestamp: a.created_at
            }))
        });
    } catch (error) {
        console.error('Error in GET /admin/users/:userId:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * PUT /admin/users/:userId/role
 * Update user admin role
 */
router.put('/:userId/role', async (req, res) => {
    try {
        const { userId } = req.params;
        const { is_admin } = req.body;

        if (typeof is_admin !== 'boolean') {
            return res.status(400).json({ error: 'is_admin must be a boolean' });
        }

        const { data, error } = await supabase
            .from('user_profiles')
            .update({
                is_admin,
                updated_at: new Date().toISOString()
            })
            .eq('id', userId)
            .select()
            .single();

        if (error) {
            console.error('Error updating user role:', error);
            return res.status(500).json({ error: 'Failed to update user role' });
        }

        res.json({
            success: true,
            user: data,
            message: `User ${is_admin ? 'promoted to' : 'removed from'} admin`
        });
    } catch (error) {
        console.error('Error in PUT /admin/users/:userId/role:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * DELETE /admin/users/:userId
 * Delete a user (soft delete by deactivating)
 */
router.delete('/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        // Soft delete - just mark as inactive
        const { error } = await supabase
            .from('user_profiles')
            .update({
                is_online: false,
                updated_at: new Date().toISOString()
            })
            .eq('id', userId);

        if (error) {
            console.error('Error deleting user:', error);
            return res.status(500).json({ error: 'Failed to delete user' });
        }

        res.json({ success: true, message: 'User deactivated' });
    } catch (error) {
        console.error('Error in DELETE /admin/users/:userId:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
