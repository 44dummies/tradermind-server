const executionController = require('./ExecutionController');

async function test() {
    console.log('Testing Execution Controller...');

    // Mock Signal
    const signal_buy = {
        type: 'BUY',
        symbol: 'R_100',
        params: { duration: '1m', basis: 'stake' }
    };

    console.log('--- Executing Valid Trade ---');
    await executionController.executeTrade(signal_buy);

    // Trigger Circuit Breaker manually
    console.log('--- Tripping Circuit Breaker ---');
    executionController.tripCircuitBreaker();

    console.log('--- Attempting Trade during Halt ---');
    await executionController.executeTrade(signal_buy);

    // Wait for async logs
    setTimeout(() => console.log('Test Finished'), 500);
}

test();
