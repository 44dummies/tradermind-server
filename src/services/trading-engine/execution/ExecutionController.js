const riskEngine = require('../risk/RiskEngine');
const derivClient = require('../data/DerivClient');
const alertService = require('../utils/AlertService');
const config = require('../config');

class ExecutionController {
    constructor() {
        this.activeTrades = new Map();
        this.circuitBreakerTripped = false;
        this.totalExposure = 0;
    }

    async executeTrade(signal) {
        if (this.circuitBreakerTripped) {
            console.warn('[Execution] Circuit breaker tripped. Trade blocked.');
            return;
        }

        // 1. Prepare trade context
        const context = {
            signal,
            dailyLoss: 0, // Mock: fetch from DB/State
            currentExposure: this.totalExposure,
        };

        // 2. Risk Check
        const riskCheck = await riskEngine.evaluateRisk(context);
        if (!riskCheck.allowed) {
            console.warn(`[Execution] Risk Rejected: ${riskCheck.reasons.join(', ')}`);
            await alertService.sendAlert('warning', `Trade Rejected: ${riskCheck.reasons.join(', ')}`);
            return;
        }

        // 3. Size Calculation (Simple fixed logic for now)
        const amount = this.calculatePositionSize();

        // 4. Execute
        try {
            console.log(`[Execution] Buying ${signal.symbol} Amt: ${amount}`);
            // In simulation mode or real mode
            // await derivClient.buy({ ...params });

            this.totalExposure += amount;

            // Mock result
            console.log(`[Execution] Trade Placed: ${signal.symbol}`);

        } catch (e) {
            console.error('[Execution] Trade Failed:', e);
            await alertService.sendAlert('error', 'Trade Execution Failed');
        }
    }

    calculatePositionSize() {
        // Implement sizing logic (Kelly, Fixed %, etc.)
        return 10; // Default $10
    }

    tripCircuitBreaker() {
        this.circuitBreakerTripped = true;
        alertService.sendAlert('critical', 'Circuit Breaker Tripped - Trading Halted');
    }

    resetCircuitBreaker() {
        this.circuitBreakerTripped = false;
    }
}

module.exports = new ExecutionController();
