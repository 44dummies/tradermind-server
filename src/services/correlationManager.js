/**
 * Correlation Manager (Risk Guard)
 * Manages exposure to specific assets and ensures diversification
 */
const { messageQueue } = require('../queue');

class CorrelationManager {
    constructor(config = {}) {
        this.maxConcurrentPerAsset = config.maxConcurrentPerAsset || 3;
        this.maxGlobalConcurrent = config.maxGlobalConcurrent || 10;

        // In-memory tracking (could be Redis backed for scaling)
        this.activeTrades = new Map(); // asset -> Set(tradeIds)
        this.totalTrades = 0;
    }

    /**
     * Check if trade is allowed based on current exposure
     * @param {string} asset - e.g. "R_100"
     * @returns {boolean}
     */
    canEnterTrade(asset) {
        // 1. Check Global Limit
        if (this.totalTrades >= this.maxGlobalConcurrent) {
            console.warn(`[CorrelationManager] Global trade limit reached (${this.totalTrades})`);
            return false;
        }

        // 2. Check Asset Limit
        const assetTrades = this.activeTrades.get(asset) || new Set();
        if (assetTrades.size >= this.maxConcurrentPerAsset) {
            console.warn(`[CorrelationManager] Asset limit reached for ${asset} (${assetTrades.size})`);
            return false;
        }

        return true;
    }

    /**
     * Register a new trade
     */
    registerTrade(asset, tradeId) {
        if (!this.activeTrades.has(asset)) {
            this.activeTrades.set(asset, new Set());
        }
        this.activeTrades.get(asset).add(tradeId);
        this.totalTrades++;
        console.log(`[CorrelationManager] Registered trade ${tradeId} for ${asset}. Total: ${this.totalTrades}`);
    }

    /**
     * Deregister a closed trade
     */
    deregisterTrade(asset, tradeId) {
        if (this.activeTrades.has(asset)) {
            const set = this.activeTrades.get(asset);
            if (set.delete(tradeId)) {
                this.totalTrades--;
                console.log(`[CorrelationManager] Deregistered trade ${tradeId} for ${asset}. Total: ${this.totalTrades}`);
            }
        }
    }
}

module.exports = new CorrelationManager();
