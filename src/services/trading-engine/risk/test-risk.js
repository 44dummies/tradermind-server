const riskEngine = require('./RiskEngine');
const indicators = require('./Indicators');

async function test() {
    console.log('Testing RiskEngine...');

    // Test 1: Daily Loss Safe
    const contextSafe = { dailyLoss: 10 };
    const resultSafe = await riskEngine.evaluateRisk(contextSafe);
    console.log('Safe Context:', resultSafe.allowed ? 'ALLOWED (Correct)' : 'BLOCKED (Wrong)');

    // Test 2: Daily Loss Exceeded
    const contextRisk = { dailyLoss: 100 };
    const resultRisk = await riskEngine.evaluateRisk(contextRisk);
    console.log('Risk Context:', !resultRisk.allowed ? `BLOCKED (Correct: ${resultRisk.reasons.join(', ')})` : 'ALLOWED (Wrong)');

    // Test 3: Indicators (SMA)
    console.log('Testing TA-Lib SMA...');
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const sma = await indicators.sma(data, 5);
    if (sma) {
        console.log('SMA Result:', sma); // Should be [3, 4, 5, 6, 7, 8] roughly
    } else {
        console.log('SMA Failed (possibly installed incorrectly or data shortage)');
    }
}

test();
