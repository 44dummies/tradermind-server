/**
 * One-time script to set a user as admin
 * Run with: node scripts/set-admin.js CR6550175
 */
require('dotenv').config();
const { supabase } = require('../src/db/supabase');

async function setAdmin(derivId) {
    if (!derivId) {
        console.error('Usage: node scripts/set-admin.js <DERIV_ID>');
        process.exit(1);
    }

    try {
        // First, find the user to see the actual column names
        console.log(`Looking for user with derivId: ${derivId}`);

        const { data: user, error: findError } = await supabase
            .from('User')
            .select('*')
            .eq('derivId', derivId)
            .single();

        if (findError) {
            console.log('Error finding by derivId, trying deriv_id...');
            const { data: user2, error: findError2 } = await supabase
                .from('User')
                .select('*')
                .eq('deriv_id', derivId)
                .single();

            if (findError2) {
                console.error('User not found:', findError2.message);
                return;
            }

            console.log('Found user:', user2);

            // Update with snake_case
            const { data, error } = await supabase
                .from('User')
                .update({ is_admin: true, role: 'admin' })
                .eq('id', user2.id)
                .select()
                .single();

            if (error) throw error;
            console.log(`✅ User ${derivId} is now an admin!`);
            console.log('Updated user:', data);
            return;
        }

        console.log('Found user:', user);

        // Update - try is_admin column
        const { data, error } = await supabase
            .from('User')
            .update({ is_admin: true, role: 'admin' })
            .eq('id', user.id)
            .select()
            .single();

        if (error) throw error;
        console.log(`✅ User ${derivId} is now an admin!`);
        console.log('Updated user:', data);

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

setAdmin(process.argv[2]);
