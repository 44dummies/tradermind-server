const alertService = require('./AlertService');
const logger = require('./Logger');

async function test() {
    console.log('Testing Logger...');
    logger.info('Test Info Log from Deriv Engine');

    console.log('Testing AlertService...');
    await alertService.sendAlert('warning', 'Test Warning Alert');

    await alertService.sendAlert('critical', 'Test Critical Alert - Circuit Breaker Tripped', {
        component: 'RiskEngine',
        value: 999
    });

    // Allow logs to flush
    setTimeout(() => {
        console.log('Test finished.');
    }, 1000);
}

test();
