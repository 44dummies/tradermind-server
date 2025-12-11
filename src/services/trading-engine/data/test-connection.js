const client = require('./DerivClient');

async function test() {
    console.log('Testing DerivClient...');

    client.on('tick', (tick) => {
        console.log(`[TICK] ${tick.symbol}: ${tick.price} @ ${tick.time.toISOString()}`);
    });

    client.on('connected', () => {
        console.log('Client connected event received.');
        client.subscribeTicks('R_100');
        client.subscribeTicks('1HZ100V');
    });

    try {
        await client.connect();

        // Run for 10 seconds
        setTimeout(() => {
            console.log('Test finished.');
            process.exit(0);
        }, 10000);
    } catch (err) {
        console.error('Test failed:', err);
        process.exit(1);
    }
}

test();
