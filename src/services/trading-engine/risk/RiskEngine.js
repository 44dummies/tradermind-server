const { Engine } = require('json-rules-engine');
const indicators = require('./Indicators');
const config = require('../config');

// Defensive defaults in case config.risk is undefined
const riskConfig = config.risk || {
    maxDailyLoss: 50,
    maxDrawdown: 0.15,
    maxExposure: 1000,
    maxConsecutiveLosses: 5
};

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
                    value: riskConfig.maxDailyLoss
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
                    value: riskConfig.maxDailyLoss
                }]
            },
            event: {
                type: 'BLOCK_TRADE',
                params: {
                    reason: 'Max Daily Loss Exceeded'
                }
            }
        });

        // Rule: Block if Max Consecutive Losses Exceeded
        this.engine.addRule({
            conditions: {
                all: [{
                    fact: 'consecutiveLosses',
                    operator: 'greaterThanInclusive',
                    value: {
                        fact: 'maxConsecutiveLossesLimit' // Dynamic value from context
                    }
                }]
            },
            event: {
                type: 'BLOCK_TRADE',
                params: {
                    reason: 'Max Consecutive Losses Reached'
                }
            }
        });

        // Rule: Check RSI Overbought (Example logic)
        // If RSI > 70 and attempting BUY -> Block (maybe)
    }

    async evaluateRisk(tradeContext) {
        // tradeContext = { dailyLoss, currentExposure, consecutiveLosses, signal: { type: 'BUY', symbol: '...' } }

        // Merge with defaults/globals if not provided in context
        const context = {
            ...tradeContext,
            maxConsecutiveLossesLimit: tradeContext.maxConsecutiveLossesLimit || riskConfig.maxConsecutiveLosses || 5
        };

        try {
            const results = await this.engine.run(context);

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
