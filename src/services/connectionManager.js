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
        this.pingInterval = null;
        this.cleanupInterval = null;
        this.CLEANUP_MS = 60000; // 1 minute
        this.PING_MS = 30000;    // 30 seconds (Deriv recommends < 2 mins)
        this.MAX_IDLE_MS = 120000; // 2 minutes (Compliant with Deriv's typical timeout)
    }

    /**
     * Initialize management routines
     */
    init() {
        if (this.cleanupInterval) clearInterval(this.cleanupInterval);
        if (this.pingInterval) clearInterval(this.pingInterval);

        this.cleanupInterval = setInterval(() => {
            this.cleanupIdleConnections();
        }, this.CLEANUP_MS);

        this.pingInterval = setInterval(() => {
            this.keepAlive();
        }, this.PING_MS);

        console.log('[ConnectionManager] Initialized with ping and cleanup routines');
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
                connection.lastUsed = now; // Mark as used
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

                    // Update activity timestamp on any valid message receipt
                    const conn = this.pool.get(token);
                    if (conn) conn.lastUsed = Date.now();

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

            ws.on('close', () => {
                // Remove from pool immediately on close
                this.pool.delete(token);
            });

            // Timeout
            setTimeout(() => {
                if (!isAuthorized) {
                    ws.terminate();
                    reject(new Error('Connection timeout authorizing'));
                }
            }, strategyConfig.connectionTimeout || 15000);
        });
    }

    /**
     * Send ping to all active connections to prevent server-side closure
     */
    keepAlive() {
        for (const [token, conn] of this.pool.entries()) {
            if (conn.ws.readyState === WebSocket.OPEN) {
                try {
                    conn.ws.send(JSON.stringify({ ping: 1 }));
                } catch (e) {
                    console.error('[ConnectionManager] Ping failed:', e.message);
                }
            }
        }
    }

    /**
     * Cleanup idle connections
     */
    cleanupIdleConnections() {
        const now = Date.now();
        let closedCount = 0;

        for (const [token, conn] of this.pool.entries()) {
            // Only cleanup if truly idle (no requests AND no messages received)
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
        if (this.pingInterval) clearInterval(this.pingInterval);
        for (const conn of this.pool.values()) {
            conn.ws.terminate();
        }
        this.pool.clear();
        console.log('[ConnectionManager] Shutdown complete');
    }
}

module.exports = new ConnectionManager();
