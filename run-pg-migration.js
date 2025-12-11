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

    const sqlPath = path.join(__dirname, 'sql/add_session_mode.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('Executing session mode migration...\n');

    // Execute the entire SQL file
    await client.query(sql);

    console.log('✅ Migration completed successfully!\n');

    // Verify column exists
    const result = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='trading_sessions' AND column_name='mode'
    `);

    if (result.rows.length > 0) {
      console.log('✅ Mode column confirmed in trading_sessions');
    } else {
      console.error('❌ Mode column NOT found');
    }

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
