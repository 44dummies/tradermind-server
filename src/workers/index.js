/**
 * Workers Index - Initializes and manages all background workers
 */
const dbWorker = require('./dbWorker');
const notificationWorker = require('./notificationWorker');
const sessionWorker = require('./sessionWorker');
const orderManager = require('../trading-engine/orderManager');

/**
 * Start all workers
 * @param {object} io - Socket.IO instance
 */
async function startAllWorkers(io) {
    console.log('[Workers] Initializing background workers...');

    // Set Socket.IO for notification worker and order manager
    notificationWorker.setSocket(io);
    orderManager.setSocket(io);

    // Start workers
    await Promise.all([
        dbWorker.start(),
        notificationWorker.start(),
        sessionWorker.start(),
        orderManager.start()
    ]);

    console.log('[Workers] All workers started');
}

/**
 * Stop all workers gracefully
 */
async function stopAllWorkers() {
    console.log('[Workers] Stopping all workers...');

    await Promise.all([
        dbWorker.stop(),
        notificationWorker.stop(),
        sessionWorker.stop(),
        orderManager.stop()
    ]);

    console.log('[Workers] All workers stopped');
}

/**
 * Get combined worker stats
 */
function getWorkerStats() {
    return {
        db: dbWorker.getStats(),
        notification: notificationWorker.getStats(),
        session: sessionWorker.getStats(),
        orderManager: orderManager.getStats()
    };
}

module.exports = {
    startAllWorkers,
    stopAllWorkers,
    getWorkerStats,
    dbWorker,
    notificationWorker,
    sessionWorker
};
