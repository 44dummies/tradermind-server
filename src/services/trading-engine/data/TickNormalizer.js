const { Point } = require('@influxdata/influxdb-client');
const derivClient = require('./DerivClient');
const influxWriter = require('./InfluxWriter');

class TickNormalizer {
    constructor() {
        this.isProcessing = false;
    }

    start() {
        if (this.isProcessing) return;

        console.log('[TickNormalizer] Starting data pipeline...');
        derivClient.on('tick', (rawTick) => this.processTick(rawTick));
        this.isProcessing = true;
    }

    processTick(tick) {
        // Normalization: Ensure numeric types, valid timestamp
        const price = parseFloat(tick.price);
        const symbol = tick.symbol;
        const time = tick.time; // Date object

        if (isNaN(price)) return;

        // Create Influx Point
        const point = new Point('market_data')
            .tag('symbol', symbol)
            .floatField('price', price)
            .timestamp(time);

        // Add optional fields if available
        if (tick.raw && tick.raw.bid) point.floatField('bid', parseFloat(tick.raw.bid));
        if (tick.raw && tick.raw.ask) point.floatField('ask', parseFloat(tick.raw.ask));

        // Write to DB
        influxWriter.writePoint(point);

        // Log occasionally or debug
        // console.log(`[TickNormalizer] Wrote ${symbol}: ${price}`);
    }
}

module.exports = new TickNormalizer();
