
const {
    computeTrendStrength,
    computeMomentumStability,
    computeDigitEntropy
} = require('../src/services/strategyEngine');
const { detectRegime } = require('../src/services/quantEngine');

// Mock config if needed, or rely on default require
const quantConfig = require('../src/config/quantConfig');

console.log('--- STARTING REGIME BACKTEST ---');
console.log('Thresholds:', {
    trend: 0.6,
    stability: 0.4,
    chaos_entropy: quantConfig.entropy.chaosThreshold
});

// 1. GENERATE DATA
function generateData(type, length = 50) {
    const data = [];
    let price = 1000;

    for (let i = 0; i < length; i++) {
        if (type === 'TREND_UP') {
            price += 1 + (Math.random() * 0.5); // Strong upward drift
        } else if (type === 'RANGE') {
            price = 1000 + Math.sin(i * 0.5) * 10 + (Math.random() * 2);
        } else if (type === 'CHAOS') {
            price += (Math.random() - 0.5) * 50; // Huge jumps
        }
        data.push(price);
    }
    return data;
}

// 2. RUN TESTS
const scenarios = [
    { name: 'Strong Trend Up', type: 'TREND_UP' },
    { name: 'Stable Range', type: 'RANGE' },
    { name: 'Volatile Chaos', type: 'CHAOS' }
];

scenarios.forEach(scenario => {
    console.log(`\nTesting Scenario: ${scenario.name}`);
    const prices = generateData(scenario.type, 100);
    // Last 20 digits for entropy (mocking digits from prices)
    const digits = prices.map(p => Math.floor((p * 100) % 10));

    // Compute Metrics
    const trendParam = { prices: prices, period: 20 }; // strategyEngine usually takes simple array or object? Checking signature next.
    // Assuming computeTrendStrength(prices) based on likely signature, will verify.

    // We need to verify signature of computeTrendStrength and computeMomentumStability
    // For now I will assume they take an array of prices. 
    // If not, I will fix after viewing strategyEngine.js
});
