/**
 * Deriv API Configuration
 * Central source of truth for backend Deriv connections
 */
// MUST match the frontend App ID (src/config.ts) to share authentication tokens
const APP_ID = process.env.DERIV_APP_ID;

if (!APP_ID) {
    console.error('⚠️ DERIV_APP_ID environment variable is missing - Deriv API will fail');
}

const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

module.exports = {
    APP_ID,
    WS_URL
};
