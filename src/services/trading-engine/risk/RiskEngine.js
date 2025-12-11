const { Engine } = require('json-rules-engine');
const indicators = require('./Indicators');
const config = require('../config');

class RiskEngine {
    constructor() {
        this.engine = new Engine();
        this.setupRules();
    }

    setupRules() {
        // Rule: Max Daily Loss
        this.engine.addRule({
            conditions: {
                all: [{
                    fact: 'dailyLoss',
                    operator: 'lessThan', // Is daily loss less than max allowed? (Wait, usually limit is positive number. If PnL is negative...)
                    // Let's say dailyLoss is positive number representing loss.
                    value: config.risk.maxDailyLoss
                }]
            },
            event: {
                type: 'ALLOW_TRADE',
                params: {
                    message: 'Daily loss within limits'
                }
            },
            // If fails? Rules engine usually fires for success. 
            // We might want positive rules (to ALLOW) or negative rules (to BLOCK).
            // Let's use Blocking rules.
        });

        // Rule: Block if Daily Loss Exceeded
        this.engine.addRule({
            conditions: {
                all: [{
                    fact: 'dailyLoss',
                    operator: 'greaterThanInclusive',
                    value: config.risk.maxDailyLoss
                }]
            },
            event: {
                type: 'BLOCK_TRADE',
                params: {
                    reason: 'Max Daily Loss Exceeded'
                }
            }
        });

        // Rule: Check RSI Overbought (Example logic)
        // If RSI > 70 and attempting BUY -> Block (maybe)
    }

    async evaluateRisk(tradeContext) {
        // tradeContext = { dailyLoss, currentExposure, signal: { type: 'BUY', symbol: '...' }, history: [...] }

        // Calculate indicators if needed
        // const rsi = await indicators.rsi(tradeContext.history, 14);
        // tradeContext.rsi = rsi ? rsi[rsi.length-1] : 50;

        try {
            const results = await this.engine.run(tradeContext);

            const blockingEvents = results.events.filter(e => e.type === 'BLOCK_TRADE');
            if (blockingEvents.length > 0) {
                return {
                    allowed: false,
                    reasons: blockingEvents.map(e => e.params.reason)
                };
            }

            return { allowed: true };
        } catch (err) {
            console.error('[RiskEngine] Evaluation Failed:', err);
            return { allowed: false, reasons: ['System Error'] };
        }
    }
}

module.exports = new RiskEngine();
