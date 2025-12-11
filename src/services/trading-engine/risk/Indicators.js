const talib = require('talib');
const util = require('util');

// Promisify execution
const execute = util.promisify(talib.execute);

class Indicators {
    // Simple Moving Average
    async sma(data, period) {
        if (data.length < period) return null;
        try {
            const result = await execute({
                name: "SMA",
                startIdx: 0,
                endIdx: data.length - 1,
                inReal: data,
                optInTimePeriod: period
            });
            return result.result.outReal;
        } catch (e) {
            console.error('[Indicators] SMA Error:', e);
            return null;
        }
    }

    // Relative Strength Index
    async rsi(data, period) {
        if (data.length < period + 1) return null; // RSI needs more data
        try {
            const result = await execute({
                name: "RSI",
                startIdx: 0,
                endIdx: data.length - 1,
                inReal: data,
                optInTimePeriod: period
            });
            return result.result.outReal;
        } catch (e) {
            console.error('[Indicators] RSI Error:', e);
            return null;
        }
    }

    // Add more as needed
}

module.exports = new Indicators();
