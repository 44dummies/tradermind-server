

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;

const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

console.log('Supabase URL configured:', supabaseUrl ? `${supabaseUrl.substring(0, 30)}...` : 'MISSING');
console.log('Supabase Key type:', process.env.SUPABASE_SERVICE_KEY ? 'SERVICE_ROLE' : 'ANON');

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ CRITICAL: Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. The server cannot function.');
  throw new Error('Missing Supabase configuration');
}

if (!process.env.SUPABASE_SERVICE_KEY) {
  console.warn('⚠️ WARNING: Running with SUPABASE_ANON_KEY. Admin privileges and RLS bypass will NOT work. Expect 403 errors on admin routes.');
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

module.exports = { supabase };
