const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const {
    computeTrendStrength,
    computeMomentumStability,
    computeDigitEntropy
} = require('../src/services/strategyEngine');
const { detectRegime } = require('../src/services/quantEngine');

// Mock minimal config to avoid dependency issues if env not set
// In real app, this comes from process.env
const quantConfig = {
    entropy: { chaosThreshold: 2.8, window: 20 },
    trend: { strengthThreshold: 0.6 },
    stability: { threshold: 0.4 }
};

console.log('--- STARTING REGIME BACKTEST ---');
console.log('Parameters:', {
    trendThresh: 0.6,
    stabilityThresh: 0.4,
    chaosEntropy: 2.8
});


console.log('--- STARTING REGIME BACKTEST v2 ---');

// 1. UNIT TEST: Verify Threshold Logic explicitly
console.log('\n[1] UNIT TESTING detectRegime (Logic Check)');
const testCases = [
    { e: 2.5, t: 0.8, s: 0.6, exp: 'TREND', desc: 'High Trend, High Stability' },
    { e: 2.5, t: 0.3, s: 0.8, exp: 'RANGE', desc: 'Low Trend, High Stability' },
    { e: 3.0, t: 0.5, s: 0.5, exp: 'CHAOS', desc: 'High Entropy' },
    { e: 2.5, t: 0.5, s: 0.1, exp: 'CHAOS', desc: 'Low Stability' },
    { e: 2.5, t: 0.5, s: 0.3, exp: 'TRANSITION', desc: 'Transition Zone' }
];

testCases.forEach(c => {
    const got = detectRegime(c.e, c.t, c.s);
    const pass = got === c.exp;
    console.log(`Input(E:${c.e}, T:${c.t}, S:${c.s}) -> Got: ${got} | Exp: ${c.exp} [${pass ? '✅' : '❌'}]`);
});

// 2. SIMULATION: Verify Metric sensitivity with scaled data
console.log('\n[2] SIMULATION WITH SCALED PRICE MOVES');

function generateDataDetailed(type, length = 100) {
    const prices = [];
    let price = 1000.00;

    // Use smaller moves to act like Forex/Pips to test sensitivity
    // Or realistic Volatility Index ticks (0.1 - 1.0 range)

    for (let i = 0; i < length; i++) {
        if (type === 'TREND_UP') {
            // Slope approx 0.05
            price += 0.05 + (Math.random() - 0.5) * 0.02;
        } else if (type === 'RANGE') {
            // Sine wave amplitude 0.5
            price = 1000.00 + Math.sin(i * 0.1) * 0.5 + (Math.random() - 0.5) * 0.1;
        } else if (type === 'CHAOS') {
            // Jumps of 0.5
            price += (Math.random() - 0.5) * 0.5;
        }
        prices.push(price);
    }
    return prices;
}

const scenarios = [
    { name: 'Stable Range (Micro)', type: 'RANGE' },
    { name: 'Smooth Trend (Micro)', type: 'TREND_UP' },
    { name: 'High Volatility', type: 'CHAOS' }
];

scenarios.forEach(scenario => {
    console.log(`\nScenario: ${scenario.name}`);
    const prices = generateDataDetailed(scenario.type, 100);
    const recent = prices.slice(-50);

    // Calculate 
    const trend = computeTrendStrength(recent, 20);
    const stability = computeMomentumStability(recent, 20);
    const mockEntropy = scenario.type === 'CHAOS' ? 2.9 : 2.5; // Manually injecting entropy for this part

    const regime = detectRegime(mockEntropy, trend, stability);

    console.log(`> Trend:     ${trend.toFixed(3)}`);
    console.log(`> Stability: ${stability.toFixed(3)}`);
    console.log(`> Regime:    ${regime}`);
});
