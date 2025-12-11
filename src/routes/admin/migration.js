
const express = require('express');
const router = express.Router();
const { supabase } = require('../../db/supabase');

/**
 * POST /api/admin/migration/v1-to-v2
 * Trigger migration of active V1 sessions to V2
 */
router.post('/v1-to-v2', async (req, res) => {
    try {
        console.log(' Starting V1 -> V2 Migration Triggered by Admin...');
        const results = {
            sessionsMigrated: 0,
            sessionsSkipped: 0,
            participantsMigrated: 0,
            errors: []
        };

        // 1. Fetch active V1 sessions
        const { data: v1Sessions, error: v1Error } = await supabase
            .from('trading_sessions')
            .select('*')
            .eq('status', 'active');

        if (v1Error) throw new Error(`Fetch V1 error: ${v1Error.message}`);

        console.log(`Found ${v1Sessions.length} active V1 sessions.`);

        for (const session of v1Sessions) {
            try {
                // Check if already in V2
                const { data: existing } = await supabase
                    .from('trading_sessions_v2')
                    .select('id')
                    .eq('id', session.id)
                    .single();

                if (existing) {
                    results.sessionsSkipped++;
                    continue;
                }

                // Create V2 Session
                const { error: createError } = await supabase
                    .from('trading_sessions_v2')
                    .insert({
                        id: session.id,
                        name: session.name,
                        admin_id: session.created_by,
                        type: session.session_type,
                        status: 'running',
                        min_balance: session.minimum_balance,
                        default_tp: session.default_tp,
                        default_sl: session.default_sl,
                        markets: [session.market],
                        staking_mode: 'percentage',
                        stake_value: session.stake_percentage || 1,
                        started_at: session.created_at,
                        created_at: session.created_at
                    });

                if (createError) throw new Error(`Create V2 session error: ${createError.message}`);

                results.sessionsMigrated++;

                // 2. Migrate Participants
                const { data: invitations } = await supabase
                    .from('session_invitations')
                    .select('*')
                    .eq('session_id', session.id)
                    .eq('status', 'accepted');

                if (invitations) {
                    for (const invite of invitations) {
                        const { data: existingPart } = await supabase
                            .from('session_participants')
                            .select('id')
                            .eq('session_id', session.id)
                            .eq('user_id', invite.user_id)
                            .single();

                        if (!existingPart) {
                            const { error: partError } = await supabase
                                .from('session_participants')
                                .insert({
                                    session_id: session.id,
                                    user_id: invite.user_id,
                                    status: 'active',
                                    tp: session.default_tp,
                                    sl: session.default_sl,
                                    joined_at: invite.responded_at,
                                    accepted_at: invite.responded_at
                                });

                            if (partError) {
                                results.errors.push(`Participant error ${invite.user_id}: ${partError.message}`);
                            } else {
                                results.participantsMigrated++;
                            }
                        }
                    }
                }

            } catch (err) {
                console.error(`Error migrating session ${session.id}:`, err);
                results.errors.push(`Session ${session.id}: ${err.message}`);
            }
        }

        res.json({
            success: true,
            message: 'Migration completed',
            results
        });

    } catch (error) {
        console.error('Migration failed:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
