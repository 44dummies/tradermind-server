/**
 * Environment Variable Validation
 * Run at startup to warn about missing vars
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
        console.error('⚠️ Missing required environment variables:');
        missing.forEach(v => console.error(`   - ${v}`));
        console.error('⚠️ Some features may not work correctly!');
        // Don't throw - let server start and fail gracefully on missing vars
    } else {
        console.log('✅ All required environment variables present');
    }

    // Warn about optional
    const missingOptional = optional.filter(v => !process.env[v]);
    if (missingOptional.length > 0) {
        console.info('ℹ️ Optional env vars not set:', missingOptional.join(', '));
    }
}

module.exports = { validateEnv };
