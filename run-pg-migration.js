/**
 * Run Friends System Migration via pg
 * Execute: node run-pg-migration.js
 */
require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  console.log('🚀 Running Friends System Migration via PostgreSQL...\n');

  // Parse the URL and use explicit connection params
  const url = new URL(process.env.DATABASE_URL);
  
  console.log('Connecting to database via pooler...');
  console.log('Host:', url.hostname);
  
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port),
    user: url.username,
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    const sqlPath = path.join(__dirname, 'src/db/migrations/friends_system.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('Executing migration...\n');
    
    // Execute the entire SQL file
    await client.query(sql);
    
    console.log('✅ Migration completed successfully!\n');
    
    // Verify tables were created
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('users_extended', 'friends', 'friend_chats', 'friend_messages', 
                         'portfolios', 'shared_notes', 'shared_watchlists', 'notifications',
                         'mentorships', 'achievements', 'user_achievements', 'streaks')
      ORDER BY table_name
    `);
    
    console.log('📊 Friends Center Tables Created:');
    result.rows.forEach(row => {
      console.log(`   ✅ ${row.table_name}`);
    });
    
  } catch (err) {
    console.error('❌ Migration Error:', err.message);
    
    if (err.message.includes('already exists')) {
      console.log('\n💡 Tables already exist. Migration may have been run before.');
    }
  } finally {
    await client.end();
    console.log('\n🔌 Disconnected from database');
  }
}

runMigration();
