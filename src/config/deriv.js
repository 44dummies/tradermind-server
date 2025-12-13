/**
 * Deriv API Configuration
 * Central source of truth for backend Deriv connections
 */
const APP_ID = process.env.DERIV_APP_ID;

if (!APP_ID) {
    throw new Error('DERIV_APP_ID environment variable is required');
}

const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

module.exports = {
    APP_ID,
    WS_URL
};
