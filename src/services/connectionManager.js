const WebSocket = require('ws');
const { WS_URL } = require('../config/deriv');
const strategyConfig = require('../config/strategyConfig');

/**
 * Connection Manager
 * Handles WebSocket connection pooling and lifecycle management
 */
class ConnectionManager {
    constructor() {
        this.pool = new Map(); // token -> { ws, accountIds: Set, lastUsed: timestamp }
        this.cleanupInterval = null;
        this.CLEANUP_MS = 60000; // 1 minute
        this.MAX_IDLE_MS = 60000; // Disconnect if idle for 1 minute
    }

    /**
     * Initialize cleanup routine
     */
    init() {
        if (this.cleanupInterval) clearInterval(this.cleanupInterval);

        this.cleanupInterval = setInterval(() => {
            this.cleanupIdleConnections();
        }, this.CLEANUP_MS);

        console.log('[ConnectionManager] Initialized with cleanup routine');
    }

    /**
     * Get or create a connection for a specific token
     * @param {string} token - Deriv API Token
     * @param {string} accountId - Deriv Account ID (for tracking usage)
     * @returns {Promise<WebSocket>}
     */
    async getConnection(token, accountId) {
        if (!token) throw new Error('Token required for connection');

        let connection = this.pool.get(token);
        const now = Date.now();

        // Check if existing connection is alive
        if (connection) {
            if (connection.ws.readyState === WebSocket.OPEN) {
                connection.accountIds.add(accountId);
                return connection.ws;
            }

            // If not OPEN, treat as dead/connecting-forever and replace
            console.warn(`[ConnectionManager] Found connection in state ${connection.ws.readyState}, creating new one.`);
            try { connection.ws.terminate(); } catch (e) { }

            // Clean up old pool entry
            this.pool.delete(token);
        }

        // Create new connection
        console.log(`[ConnectionManager] Creating new connection for account ${accountId}`);
        const ws = await this._createConnection(token);

        this.pool.set(token, {
            ws,
            accountIds: new Set([accountId]),
            lastUsed: now
        });

        return ws;
    }

    /**
     * Internal method to create and authorize a connection
     */
    async _createConnection(token) {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(WS_URL);
            let isAuthorized = false;

            ws.on('open', () => {
                ws.send(JSON.stringify({ authorize: token }));
            });

            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    if (message.msg_type === 'authorize') {
                        isAuthorized = true;
                        resolve(ws);
                    } else if (message.msg_type === 'error' && !isAuthorized) {
                        reject(new Error(message.error.message));
                    }
                } catch (e) {
                    // ignore parse errors here
                }
            });

            ws.on('error', (err) => {
                console.error(`[ConnectionManager] WebSocket error (authorized: ${isAuthorized}):`, err.message);
                if (!isAuthorized) reject(err);
            });

            // Cleanup on close is handled by the pool management logic usually,
            // but we can add listener to remove self from pool if closed unexpectedly
            ws.on('close', () => {
                // We defer cleanup to the pool manager or next access
            });

            // Timeout
            setTimeout(() => {
                if (!isAuthorized) {
                    ws.terminate();
                    reject(new Error('Connection timeout authorizing'));
                }
            }, strategyConfig.connectionTimeout || 10000);
        });
    }

    /**
     * Cleanup idle connections
     */
    cleanupIdleConnections() {
        const now = Date.now();
        let closedCount = 0;

        for (const [token, conn] of this.pool.entries()) {
            if (now - conn.lastUsed > this.MAX_IDLE_MS) {
                console.log(`[ConnectionManager] Closing idle connection for accounts: ${[...conn.accountIds].join(', ')}`);
                conn.ws.terminate(); // Force close
                this.pool.delete(token);
                closedCount++;
            }
        }

        if (closedCount > 0) {
            console.log(`[ConnectionManager] Cleaned up ${closedCount} idle connections. Pool size: ${this.pool.size}`);
        }
    }

    /**
     * Shutdown all connections
     */
    shutdown() {
        if (this.cleanupInterval) clearInterval(this.cleanupInterval);
        for (const conn of this.pool.values()) {
            conn.ws.terminate();
        }
        this.pool.clear();
        console.log('[ConnectionManager] Shutdown complete');
    }
}

module.exports = new ConnectionManager();
