/**
 * Environment Variable Validation
 * Run at startup to ensure all required vars exist
 */

const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_KEY',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'DERIV_APP_ID',
    'ENCRYPTION_KEY'
];

const optional = [
    'DERIV_API_TOKEN',
    'REDIS_URL',
    'SENTRY_DSN'
];

function validateEnv() {
    const missing = required.filter(v => !process.env[v]);

    if (missing.length > 0) {
        console.error('❌ Missing required environment variables:');
        missing.forEach(v => console.error(`   - ${v}`));
        throw new Error(`Missing required env vars: ${missing.join(', ')}`);
    }

    console.log('✅ All required environment variables present');

    // Warn about optional
    const missingOptional = optional.filter(v => !process.env[v]);
    if (missingOptional.length > 0) {
        console.warn('⚠️ Optional env vars not set:', missingOptional.join(', '));
    }
}

module.exports = { validateEnv };
