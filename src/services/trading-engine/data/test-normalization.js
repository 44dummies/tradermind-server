const normalizer = require('./TickNormalizer');
const influxWriter = require('./InfluxWriter');
const derivClient = require('./DerivClient');

// Mock InfluxWriter
influxWriter.writePoint = (point) => {
    console.log('[TEST] WritePoint called with:');
    console.log(`  - Measurement: ${point.measurement_name}`);
    // Point object structure is complex, we just check toString or fields
    console.log(`  - ToLineProtocol: ${point.toLineProtocol()}`);
};

async function test() {
    console.log('Testing TickNormalizer...');
    normalizer.start();

    // Simulate a tick
    const mockTick = {
        symbol: 'R_100',
        price: 123.456,
        time: new Date(),
        raw: { bid: 123.45, ask: 123.46 }
    };

    console.log('Emitting mock tick...');
    derivClient.emit('tick', mockTick);

    // Wait a bit
    setTimeout(() => {
        console.log('Test finished.');
    }, 100);
}

test();
