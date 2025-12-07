/**
 * Deriv API Configuration
 * Central source of truth for backend Deriv connections
 */
const APP_ID = process.env.DERIV_APP_ID || calculateAppId();

function calculateAppId() {
    // If we are in production (based on URL usually, but here we default)
    return '114042';
}

const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

module.exports = {
    APP_ID,
    WS_URL
};
