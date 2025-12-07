/**
 * User TP/SL Routes
 * Manage Take Profit and Stop Loss settings
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../../db/supabase');

/**
 * GET /user/tpsl
 * Get current TP/SL settings
 */
router.get('/', async (req, res) => {
    try {
        const userId = req.user.id;

        const { data, error } = await supabase
            .from('user_trading_settings')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (error && error.code !== 'PGRST116') {
            throw error;
        }

        res.json({
            settings: data || {
                user_id: userId,
                default_tp: 10.00,
                default_sl: 5.00,
                can_join_recovery: false
            }
        });
    } catch (error) {
        console.error('Get TP/SL error:', error);
        res.status(500).json({ error: 'Failed to fetch TP/SL settings' });
    }
});

/**
 * PUT /user/tpsl
 * Update TP/SL settings
 */
router.put('/', async (req, res) => {
    try {
        const userId = req.user.id;
        const { tp, sl } = req.body;

        // Validate inputs
        if (tp !== undefined && (typeof tp !== 'number' || tp < 0)) {
            return res.status(400).json({ error: 'Invalid TP value' });
        }
        if (sl !== undefined && (typeof sl !== 'number' || sl < 0)) {
            return res.status(400).json({ error: 'Invalid SL value' });
        }

        // Get current settings
        const { data: existing } = await supabase
            .from('user_trading_settings')
            .select('*')
            .eq('user_id', userId)
            .single();

        const updates = {
            default_tp: tp !== undefined ? tp : existing?.default_tp || 10.00,
            default_sl: sl !== undefined ? sl : existing?.default_sl || 5.00,
            updated_at: new Date().toISOString()
        };

        let data, error;

        if (existing) {
            // Update existing
            const result = await supabase
                .from('user_trading_settings')
                .update(updates)
                .eq('user_id', userId)
                .select()
                .single();
            data = result.data;
            error = result.error;
        } else {
            // Create new
            const result = await supabase
                .from('user_trading_settings')
                .insert({
                    user_id: userId,
                    ...updates,
                    can_join_recovery: false
                })
                .select()
                .single();
            data = result.data;
            error = result.error;
        }

        if (error) throw error;

        // Also update any active session participation
        await supabase
            .from('session_participants')
            .update({
                tp: updates.default_tp,
                sl: updates.default_sl
            })
            .eq('user_id', userId)
            .eq('status', 'active');

        res.json({
            success: true,
            settings: data
        });
    } catch (error) {
        console.error('Update TP/SL error:', error);
        res.status(500).json({ error: 'Failed to update TP/SL settings' });
    }
});

module.exports = router;
