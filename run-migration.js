/**
 * Run Friends System Migration
 * Execute: node run-migration.js
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

async function runMigration() {
  console.log('🚀 Running Friends System Migration...\n');

  const sqlPath = path.join(__dirname, 'src/db/migrations/friends_system.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  // Split by semicolons and filter empty statements
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  console.log(`Found ${statements.length} SQL statements to execute\n`);

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i];
    const preview = statement.substring(0, 60).replace(/\n/g, ' ');
    
    try {
      const { error } = await supabase.rpc('exec_sql', { sql: statement + ';' });
      
      if (error) {
        // Try direct query for DDL statements
        const { error: queryError } = await supabase.from('_exec').select('*').limit(0);
        
        // For DDL, we need to use the REST API or pg_execute
        console.log(`⚠️  Statement ${i + 1}: ${preview}...`);
        console.log(`   Note: DDL statements may need to be run in Supabase Dashboard SQL Editor\n`);
        errorCount++;
      } else {
        console.log(`✅ Statement ${i + 1}: ${preview}...`);
        successCount++;
      }
    } catch (err) {
      console.log(`⚠️  Statement ${i + 1}: ${preview}...`);
      console.log(`   Error: ${err.message}\n`);
      errorCount++;
    }
  }

  console.log(`\n📊 Migration Summary:`);
  console.log(`   ✅ Successful: ${successCount}`);
  console.log(`   ⚠️  Need manual execution: ${errorCount}`);
  
  if (errorCount > 0) {
    console.log(`\n💡 To complete migration:`);
    console.log(`   1. Go to: https://supabase.com/dashboard/project/endiwbrphlynhldnkgzf/sql`);
    console.log(`   2. Copy and paste the contents of: src/db/migrations/friends_system.sql`);
    console.log(`   3. Click "Run" to execute`);
  }
}

runMigration().catch(console.error);
