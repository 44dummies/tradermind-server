/**
 * Correlation Manager (Risk Guard)
 * Manages exposure to specific assets and ensures diversification
 */
const { messageQueue } = require('../queue');
const strategyConfig = require('../config/strategyConfig');

class CorrelationManager {
    constructor(config = {}) {
        this.maxConcurrentPerAsset = config.maxConcurrentPerAsset || strategyConfig.riskGuard?.maxConcurrentPerAsset || 3;
        this.maxGlobalConcurrent = config.maxGlobalConcurrent || strategyConfig.riskGuard?.maxGlobalConcurrent || 10;
        this.redis = messageQueue.redis; // Access underlying redis client
    }

    /**
     * Check if trade is allowed based on current exposure (Redis Persisted)
     * @param {string} asset - e.g. "R_100"
     * @returns {Promise<boolean>}
     */
    async canEnterTrade(asset) {
        // Retry logic for Redis availability
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
            if (messageQueue.isReady() && this.redis) break;
            attempts++;
            if (attempts < maxAttempts) await new Promise(r => setTimeout(r, 100 * attempts));
        }

        if (!messageQueue.isReady() || !this.redis) {
            console.warn('[CorrelationManager] Redis not ready after retries. Blocking trades for safety.');
            return false; // Fail safe (Closed)
        }

        const globalKey = 'risk:global_trades';
        const assetKey = `risk:asset_trades:${asset}`;

        try {
            // Check counts
            const currentGlobal = parseInt(await this.redis.get(globalKey) || '0');
            const currentAsset = await this.redis.scard(assetKey);

            if (currentGlobal >= this.maxGlobalConcurrent) {
                console.warn(`[CorrelationManager] Global trade limit reached (${currentGlobal}/${this.maxGlobalConcurrent})`);
                return false;
            }

            if (currentAsset >= this.maxConcurrentPerAsset) {
                console.warn(`[CorrelationManager] Asset limit reached for ${asset} (${currentAsset}/${this.maxConcurrentPerAsset})`);
                return false;
            }

            return true;
        } catch (e) {
            console.error('[CorrelationManager] Redis check failed:', e);
            return false; // Fail safe
        }
    }

    /**
     * Register a new trade (Redis Persisted)
     */
    async registerTrade(asset, tradeId) {
        if (!messageQueue.isReady() || !this.redis) return;

        const globalKey = 'risk:global_trades';
        const assetKey = `risk:asset_trades:${asset}`;
        const tradeKey = `risk:trade:${tradeId}`; // Metadata

        try {
            const multi = this.redis.multi();
            multi.incr(globalKey);
            multi.sadd(assetKey, tradeId);
            // Auto-expire metadata after 24h to keep DB clean
            multi.set(tradeKey, JSON.stringify({ asset, registeredAt: Date.now() }), 'EX', 86400);
            await multi.exec();

            console.log(`[CorrelationManager] Registered trade ${tradeId} for ${asset}`);
        } catch (e) {
            console.error('[CorrelationManager] Register failed:', e);
        }
    }

    /**
     * Deregister a closed trade (Redis Persisted)
     */
    async deregisterTrade(asset, tradeId) {
        if (!messageQueue.isReady() || !this.redis) return;

        const globalKey = 'risk:global_trades';
        const assetKey = `risk:asset_trades:${asset}`;

        // If asset is unknown (e.g. restart), try to recover from tradeKey? 
        // For now assume passed asset is correct (TradeExecutor tracks it)

        try {
            const multi = this.redis.multi();
            multi.decr(globalKey);
            multi.srem(assetKey, tradeId);
            multi.del(`risk:trade:${tradeId}`);

            // Safety: ensure global counter doesn't go below 0
            // decr handles it, but semantic check is good. Redis handles atomic decr provided we are consistent.

            await multi.exec();
            console.log(`[CorrelationManager] Deregistered trade ${tradeId} for ${asset}`);
        } catch (e) {
            console.error('[CorrelationManager] Deregister failed:', e);
        }
    }
}

module.exports = new CorrelationManager();
