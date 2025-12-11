const winston = require('winston');
const LokiTransport = require('winston-loki');
const config = require('../config');

const transports = [
    new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    })
];

if (config.logging.lokiUrl) {
    try {
        transports.push(new LokiTransport({
            host: config.logging.lokiUrl,
            labels: { app: 'deriv-trading-engine' },
            json: true,
            onConnectionError: (err) => console.error(err)
        }));
    } catch (e) {
        console.error('Failed to initialize Loki transport', e);
    }
}

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports
});

module.exports = logger;
