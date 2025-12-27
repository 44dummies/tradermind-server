/**
 * Deriv API Configuration
 * Central source of truth for backend Deriv connections
 */
// MUST match the frontend App ID (src/config.ts) to share authentication tokens
const APP_ID = process.env.DERIV_APP_ID || '114042';

if (!process.env.DERIV_APP_ID) {
    console.warn('⚠️ DERIV_APP_ID environment variable is missing - Using default 114042');
}

const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

module.exports = {
    APP_ID,
    WS_URL
};
