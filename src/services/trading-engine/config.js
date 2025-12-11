require('dotenv').config();

module.exports = {
    deriv: {
        appId: process.env.DERIV_APP_ID,
        token: process.env.DERIV_API_TOKEN,
        wsUrl: process.env.DERIV_WS_URL || 'wss://ws.binaryws.com/websockets/v3',
    },
    influx: {
        url: process.env.INFLUX_URL || 'http://localhost:8086',
        token: process.env.INFLUX_TOKEN,
        org: process.env.INFLUX_ORG || 'deriv_trading',
        bucket: process.env.INFLUX_BUCKET || 'ticks',
    },
    risk: {
        maxDrawdown: 0.1, // 10%
        maxExposure: 1000,
        maxDailyLoss: 50,
    },
    logging: {
        lokiUrl: process.env.LOKI_URL || 'http://localhost:3100',
    },
};
