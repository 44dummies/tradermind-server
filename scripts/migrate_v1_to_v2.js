
require('dotenv').config({ path: '../.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

async function migrate() {
    console.log('🚀 Starting V1 -> V2 Migration...');

    // 1. Fetch active V1 sessions
    const { data: v1Sessions, error: v1Error } = await supabase
        .from('trading_sessions')
        .select('*')
        .eq('status', 'active'); // Only migrate active ones

    if (v1Error) {
        console.error('❌ Error fetching V1 sessions:', v1Error);
        return;
    }

    console.log(`Found ${v1Sessions.length} active V1 sessions.`);

    for (const session of v1Sessions) {
        console.log(`\nMoving Session: ${session.name} (${session.id})`);

        // Check if already in V2
        const { data: existing } = await supabase
            .from('trading_sessions_v2')
            .select('id')
            .eq('id', session.id)
            .single();

        if (existing) {
            console.log('  ⚠️ Already in V2, skipping creation.');
        } else {
            // Create V2 Session
            const { error: createError } = await supabase
                .from('trading_sessions_v2')
                .insert({
                    id: session.id, // Keep same ID!
                    name: session.name,
                    admin_id: session.created_by,
                    type: session.session_type,
                    status: 'running', // V2 equivalent of 'active'
                    min_balance: session.minimum_balance,
                    default_tp: session.default_tp,
                    default_sl: session.default_sl,
                    markets: [session.market], // Wrap single market in array
                    staking_mode: 'percentage', // Default
                    stake_value: session.stake_percentage || 1, // Default to 1% if stored as whole number
                    started_at: session.created_at, // Use creation time as start
                    created_at: session.created_at
                });

            if (createError) {
                console.error('  ❌ Failed to create V2 session:', createError);
                continue;
            }
            console.log('  ✅ Created V2 record.');
        }

        // 2. Migrate Participants
        const { data: invitations } = await supabase
            .from('session_invitations')
            .select('*')
            .eq('session_id', session.id)
            .eq('status', 'accepted');

        console.log(`  Found ${invitations?.length || 0} participants.`);

        if (invitations) {
            for (const invite of invitations) {
                // Check exist
                const { data: existingPart } = await supabase
                    .from('session_participants')
                    .select('id')
                    .eq('session_id', session.id)
                    .eq('user_id', invite.user_id)
                    .single();

                if (existingPart) {
                    console.log(`    ⚠️ User ${invite.user_id} already in V2 participants.`);
                    continue;
                }

                // Insert into V2 participants
                // We assume user_trading_settings exists or will be created by lazy load
                // But for bot to work, we need 'deriv_token'. 
                // V2 usually stores local settings here? No, session_participants has specific TP/SL

                const { error: partError } = await supabase
                    .from('session_participants')
                    .insert({
                        session_id: session.id,
                        user_id: invite.user_id,
                        status: 'active',
                        tp: session.default_tp, // Use session defaults
                        sl: session.default_sl,
                        joined_at: invite.responded_at,
                        accepted_at: invite.responded_at
                    });

                if (partError) {
                    console.error(`    ❌ Failed to migrate participant ${invite.user_id}:`, partError);
                } else {
                    console.log(`    ✅ Migrated participant ${invite.user_id}`);
                }
            }
        }

        // 3. Update V1 status to 'migrated' to avoid double processing? 
        // Or keep 'active' for safety until confirmed? Let's keep 'active' but maybe log it.
    }

    console.log('\n🏁 Migration complete.');
}

migrate();
