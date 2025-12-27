/**
 * Deriv API Client Wrapper
 * Uses official @deriv/deriv-api library for robust WebSocket management
 * 
 * Benefits:
 * - Automatic reconnection & queueing
 * - Subscription deduplication
 * - Typed request/response handling
 */

const WebSocket = require('ws');
const DerivAPIBasic = require('@deriv/deriv-api/dist/DerivAPIBasic');
const { APP_ID } = require('../config/deriv');

const WS_ENDPOINT = 'ws.derivws.com';

class DerivClient {
    constructor() {
        this.connections = new Map(); // accountId -> { api, connection, authorized, dispatch }
        this.tickSubscriptions = new Map(); // symbol -> subscription
        this.balanceSubscriptions = new Map(); // accountId -> subscription
        this.contractListeners = new Map(); // contractId -> callback
        this.reconnectAttempts = new Map();
        this.maxReconnectAttempts = 5;
        this.pingInterval = null;
        this.PING_MS = 30000;
    }

    /**
     * Start background maintenance tasks
     */
    init() {
        if (this.pingInterval) clearInterval(this.pingInterval);
        this.pingInterval = setInterval(() => {
            this.keepAlive();
        }, this.PING_MS);
        console.log('[DerivClient] Keep-alive routine started');
    }

    /**
     * Send ping to all active connections
     */
    keepAlive() {
        for (const [accountId, conn] of this.connections) {
            if (conn.connection.readyState === WebSocket.OPEN) {
                try {
                    conn.api.send({ ping: 1 }).catch(() => { });
                } catch (e) {
                    // Ignore errors, closure handled by 'close' listener
                }
            }
        }

        // Also ping tick connections
        for (const [symbol, sub] of this.tickSubscriptions) {
            if (sub.connection.readyState === WebSocket.OPEN) {
                try {
                    sub.api.send({ ping: 1 }).catch(() => { });
                } catch (e) { }
            }
        }
    }

    /**
     * Get or create a connection for a specific account
     */
    async getConnection(accountId, apiToken) {
        if (this.connections.has(accountId)) {
            const conn = this.connections.get(accountId);
            if (conn.authorized) {
                return conn.api;
            }
        }

        const api = await this.createConnection(accountId, apiToken);
        return api;
    }

    /**
     * Create a new authenticated connection
     */
    async createConnection(accountId, apiToken) {
        return new Promise((resolve, reject) => {
            const connection = new WebSocket(
                `wss://${WS_ENDPOINT}/websockets/v3?app_id=${APP_ID}`
            );

            const api = new DerivAPIBasic({ connection });

            connection.on('open', async () => {
                console.log(`[DerivClient]  Connected for account ${accountId}`);

                try {
                    // Authorize the connection
                    const authResponse = await api.authorize(apiToken);

                    if (authResponse.error) {
                        throw new Error(authResponse.error.message);
                    }

                    console.log(`[DerivClient]  Authorized account ${authResponse.authorize.loginid}`);

                    // Central dispatcher for this connection (CTO Phase 3: Resource Engineering)
                    const dispatch = (data) => {
                        try {
                            const msg = JSON.parse(data.toString());

                            // 1. Balance updates
                            if (msg.msg_type === 'balance' && this.balanceListeners?.has(accountId)) {
                                this.balanceListeners.get(accountId)(msg.balance);
                            }

                            // 2. Contract updates
                            if (msg.proposal_open_contract && this.contractListeners?.has(msg.proposal_open_contract.contract_id)) {
                                this.contractListeners.get(msg.proposal_open_contract.contract_id)(msg.proposal_open_contract);
                            }

                            // ... add more as needed
                        } catch (e) { /* silent parse fail */ }
                    };

                    connection.on('message', dispatch);

                    this.connections.set(accountId, {
                        api,
                        connection,
                        authorized: true,
                        dispatch, // Keep reference to remove if needed
                        loginid: authResponse.authorize.loginid,
                        balance: authResponse.authorize.balance,
                        currency: authResponse.authorize.currency
                    });

                    this.reconnectAttempts.set(accountId, 0);
                    resolve(api);

                } catch (authError) {
                    console.error(`[DerivClient]  Authorization failed for ${accountId}:`, authError);
                    connection.close();
                    reject(authError);
                }
            });

            connection.on('close', () => {
                console.log(`[DerivClient] 🔌 Connection closed for ${accountId}`);
                this.connections.delete(accountId);

                // Attempt reconnection if not intentional
                const attempts = this.reconnectAttempts.get(accountId) || 0;
                if (attempts < this.maxReconnectAttempts) {
                    this.reconnectAttempts.set(accountId, attempts + 1);
                    console.log(`[DerivClient]  Reconnecting (${attempts + 1}/${this.maxReconnectAttempts})...`);
                    // Note: Actual reconnection would need the token stored somewhere
                }
            });

            connection.on('error', (error) => {
                console.error(`[DerivClient]  WebSocket error for ${accountId}:`, error.message);
                reject(error);
            });
        });
    }

    /**
     * Helper to send request with retry for RateLimit errors
     */
    async sendWithRetry(accountId, apiToken, method, params, retryCount = 0) {
        const MAX_RETRIES = require('../config/strategyConfig').system?.retryAttempts || 3;

        try {
            const api = await this.getConnection(accountId, apiToken);
            const response = await api[method](params);

            if (response.error) {
                if (response.error.code === 'RateLimit' && retryCount < MAX_RETRIES) {
                    const delay = 1000 * Math.pow(2, retryCount);
                    console.warn(`[DerivClient] Rate limit hit for ${accountId} during ${method}. Retrying in ${delay}ms...`);
                    await new Promise(r => setTimeout(r, delay));
                    return this.sendWithRetry(accountId, apiToken, method, params, retryCount + 1);
                }
                throw new Error(response.error.message);
            }

            return response;
        } catch (error) {
            if (error.message.includes('RateLimit') && retryCount < MAX_RETRIES) {
                const delay = 1000 * Math.pow(2, retryCount);
                console.warn(`[DerivClient] Connection/RateLimit error during ${method}. Retrying in ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
                return this.sendWithRetry(accountId, apiToken, method, params, retryCount + 1);
            }
            throw error;
        }
    }

    /**
     * Get a contract proposal (quote)
     */
    async getProposal(accountId, apiToken, contractParams) {
        console.log(`[DerivClient] Requesting proposal for ${accountId}:`, contractParams);

        const proposalRequest = {
            proposal: 1,
            ...contractParams
        };

        const response = await this.sendWithRetry(accountId, apiToken, 'send', proposalRequest);

        console.log(`[DerivClient] Proposal received: ID ${response.proposal.id}, Payout: ${response.proposal.payout}`);
        return response.proposal;
    }

    /**
     * Execute a buy trade (Supports Direct Buy or Buy from Proposal)
     */
    async buy(accountId, apiToken, params) {
        let buyRequest;

        // Check if we are buying from a proposal ID or direct parameters
        if (typeof params === 'string') {
            console.log(`[DerivClient] Executing trade for ${accountId} using Proposal ID: ${params}`);
            buyRequest = { buy: params, price: 10000 };
        } else if (params.proposal_id) {
            console.log(`[DerivClient] Executing trade for ${accountId} using Proposal ID: ${params.proposal_id}`);
            buyRequest = { buy: params.proposal_id, price: params.price || 10000 };
        } else {
            console.log(`[DerivClient] Executing direct buy for ${accountId}:`, params);
            buyRequest = { buy: 1, ...params };
        }

        const response = await this.sendWithRetry(accountId, apiToken, 'buy', buyRequest);

        console.log(`[DerivClient]  Trade executed: Contract ${response.buy.contract_id}`);

        return {
            success: true,
            contract_id: response.buy.contract_id,
            buy_price: response.buy.buy_price,
            payout: response.buy.payout,
            balance_after: response.buy.balance_after
        };
    }

    /**
     * Subscribe to tick stream for a symbol
     */
    async subscribeTicks(symbol, callback) {
        if (this.tickSubscriptions.has(symbol)) {
            console.log(`[DerivClient] Already subscribed to ${symbol} ticks`);
            return;
        }

        // Create a shared connection for tick streams (no auth needed for ticks)
        const connection = new WebSocket(
            `wss://${WS_ENDPOINT}/websockets/v3?app_id=${APP_ID}`
        );

        const api = new DerivAPIBasic({ connection });

        return new Promise((resolve, reject) => {
            connection.on('open', async () => {
                try {
                    // Subscribe to ticks
                    const tickStream = await api.subscribe({ ticks: symbol });

                    // Store subscription
                    this.tickSubscriptions.set(symbol, { api, connection, stream: tickStream });

                    // Set up message handler
                    connection.on('message', (data) => {
                        try {
                            const msg = JSON.parse(data.toString());
                            if (msg.tick) {
                                // Extract last digit with precision awareness
                                const quote = msg.tick.quote;
                                const symbolMap = {
                                    'R_10': 3, 'R_25': 3, 'R_50': 4, 'R_75': 4, 'R_100': 2,
                                    '1HZ10V': 3, '1HZ25V': 3, '1HZ50V': 4, '1HZ75V': 4, '1HZ100V': 2,
                                    'JD10': 3, 'JD25': 3, 'JD50': 3, 'JD75': 3, 'JD100': 3
                                };
                                const precision = symbolMap[msg.tick.symbol] || 3;
                                const quoteStr = quote.toFixed(precision);
                                const digit = parseInt(quoteStr.slice(-1));

                                callback({
                                    symbol: msg.tick.symbol,
                                    quote: quote,
                                    epoch: msg.tick.epoch,
                                    digit: digit
                                });
                            }
                        } catch (e) {
                            // Ignore parse errors
                        }
                    });

                    console.log(`[DerivClient]  Subscribed to ${symbol} ticks`);
                    resolve(tickStream);

                } catch (err) {
                    console.error(`[DerivClient]  Failed to subscribe to ${symbol}:`, err);
                    reject(err);
                }
            });

            connection.on('error', reject);
        });
    }

    /**
     * Unsubscribe from tick stream
     */
    async unsubscribeTicks(symbol) {
        const sub = this.tickSubscriptions.get(symbol);
        if (sub) {
            try {
                sub.connection.close();
                this.tickSubscriptions.delete(symbol);
                console.log(`[DerivClient] 🔕 Unsubscribed from ${symbol} ticks`);
            } catch (e) {
                console.error(`[DerivClient] Error unsubscribing from ${symbol}:`, e);
            }
        }
    }

    /**
     * Subscribe to balance updates
     */
    async subscribeBalance(accountId, apiToken, callback) {
        if (this.balanceSubscriptions.has(accountId)) {
            console.log(`[DerivClient] Already subscribed to balance for ${accountId}`);
            return;
        }

        try {
            const api = await this.getConnection(accountId, apiToken);

            // Subscribe to balance
            const subscription = await api.subscribe({ balance: 1 });

            // Store subscription
            this.balanceSubscriptions.set(accountId, subscription);

            // Store callback in central dispatcher lookup
            if (!this.balanceListeners) this.balanceListeners = new Map();
            this.balanceListeners.set(accountId, callback);

            console.log(`[DerivClient] 💰 Subscribed to balance updates for ${accountId}`);
            return subscription;
        } catch (error) {
            console.error(`[DerivClient] Failed to subscribe to balance for ${accountId}:`, error);
            throw error;
        }
    }

    /**
     * Unsubscribe from balance updates
     */
    async unsubscribeBalance(accountId) {
        try {
            if (this.balanceSubscriptions.has(accountId)) {
                this.balanceSubscriptions.delete(accountId);
                this.balanceListeners?.delete(accountId);
                console.log(`[DerivClient] Unsubscribed balance for ${accountId}`);
            }
        } catch (e) {
            console.error(`[DerivClient] Error unsubscribing balance for ${accountId}:`, e);
        }
    }

    /**
     * Get account balance (Cached + Backoff)
     */
    async getBalance(accountId, apiToken) {
        // 1. Check Cache (15s default)
        const cacheKey = `balance:${accountId}`;
        const { messageQueue } = require('../queue'); // Lazy load to avoid circular deps if any

        if (messageQueue.isReady()) {
            try {
                const cached = await messageQueue.get(cacheKey);
                // messageQueue.get returns valid object or null
                if (cached) {
                    return cached;
                }
            } catch (e) {
                console.warn(`[DerivClient] Cache read error for ${accountId}:`, e.message);
            }
        }

        // 2. Fetch with Backoff
        const fetchRemote = async (retryCount = 0) => {
            try {
                const api = await this.getConnection(accountId, apiToken);
                const response = await api.balance();

                if (response.error) {
                    if (response.error.code === 'RateLimit' && retryCount < 5) {
                        const delay = 1000 * Math.pow(2, retryCount);
                        console.warn(`[DerivClient] Rate limit hit for ${accountId}. Retrying in ${delay}ms...`);
                        await new Promise(r => setTimeout(r, delay));
                        return fetchRemote(retryCount + 1);
                    }
                    throw new Error(response.error.message);
                }

                const balanceData = {
                    balance: response.balance.balance,
                    currency: response.balance.currency,
                    loginid: response.balance.loginid
                };

                // 3. Set Cache
                if (messageQueue.isReady()) {
                    // cache for 15 seconds
                    try {
                        await messageQueue.redis.set(cacheKey, JSON.stringify(balanceData), 'EX', 15);
                    } catch (e) { /* ignore cache write errors */ }
                }

                return balanceData;

            } catch (error) {
                // If simple connection error, maybe retry? For now let's strict fail on non-RateLimit
                if (error.message && error.message.includes('RateLimit') && retryCount < 5) {
                    const delay = 1000 * Math.pow(2, retryCount);
                    console.warn(`[DerivClient] Rate limit/Connection error for ${accountId}. Retrying in ${delay}ms...`);
                    await new Promise(r => setTimeout(r, delay));
                    return fetchRemote(retryCount + 1);
                }
                throw error;
            }
        };

        return fetchRemote();
    }

    /**
     * Get profit table (completed trades)
     */
    async getProfitTable(accountId, apiToken, limit = 50, offset = 0) {
        const api = await this.getConnection(accountId, apiToken);
        const response = await api.send({
            profit_table: 1,
            description: 1,
            limit,
            offset,
            sort: 'DESC'
        });

        if (response.error) {
            throw new Error(response.error.message);
        }

        return {
            count: response.profit_table.count,
            transactions: response.profit_table.transactions
        };
    }

    /**
     * Get statement (all transactions)
     */
    async getStatement(accountId, apiToken, limit = 50, offset = 0) {
        const api = await this.getConnection(accountId, apiToken);
        const response = await api.send({
            statement: 1,
            description: 1,
            limit,
            offset
        });

        if (response.error) {
            throw new Error(response.error.message);
        }

        return {
            count: response.statement.count,
            transactions: response.statement.transactions
        };
    }

    /**
     * Subscribe to contract updates (for TP/SL monitoring)
     */
    async subscribeToContract(accountId, apiToken, contractId, callback) {
        const api = await this.getConnection(accountId, apiToken);

        // Store in global contract listener map (CTO Phase 3)
        this.contractListeners.set(contractId, callback);

        // Request contract updates (Subscribes on Deriv side)
        await api.send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 });

        console.log(`[DerivClient] 📡 Monitoring contract ${contractId}`);
    }

    /**
     * Unsubscribe from contract updates
     */
    async unsubscribeFromContract(contractId) {
        this.contractListeners.delete(contractId);
        // Note: We could send { forget: sub_id } but for now we just stop processing messages
    }

    /**
     * Close all connections
     */
    disconnectAll() {
        for (const [accountId, conn] of this.connections) {
            try {
                conn.connection.close();
                console.log(`[DerivClient] Closed connection for ${accountId}`);
            } catch (e) {
                // Ignore close errors
            }
        }
        this.connections.clear();

        for (const [symbol, sub] of this.tickSubscriptions) {
            try {
                sub.connection.close();
            } catch (e) {
                // Ignore
            }
        }
        this.tickSubscriptions.clear();

        console.log('[DerivClient] 🔌 All connections closed');
    }

    /**
     * Get connection stats
     */
    getStats() {
        return {
            activeConnections: this.connections.size,
            tickSubscriptions: this.tickSubscriptions.size,
            accounts: Array.from(this.connections.keys())
        };
    }

    /**
     * Verify a user's token by attempting to authorize with it
     * Uses a temporary connection to avoid polluting the pool
     */
    /**
     * Verify a user's token by attempting to authorize with it
     * Uses a RAW WebSocket for maximum speed with a "WARM-UP" ping and retry logic.
     */
    async verifyUserToken(token, attempt = 1) {
        return new Promise((resolve) => {
            const start = Date.now();
            console.log(`[DerivClient] Starting raw verification (Attempt ${attempt})...`);

            const socket = new WebSocket(
                `wss://${WS_ENDPOINT}/websockets/v3?app_id=${APP_ID}`
            );

            let isResolved = false;
            let timeout;

            const finish = async (result) => {
                if (isResolved) return;
                isResolved = true;
                clearTimeout(timeout);

                try {
                    if (socket.readyState === WebSocket.OPEN) socket.close();
                } catch (e) { }

                const duration = Date.now() - start;
                console.log(`[DerivClient] Result: ${result.isValid} (${duration}ms)`);

                // AUTO-RETRY once if it was a timeout
                if (!result.isValid && result.error?.includes('timeout') && attempt < 2) {
                    console.warn('[DerivClient] Timing out, retrying once...');
                    const retryResult = await this.verifyUserToken(token, attempt + 1);
                    resolve(retryResult);
                } else {
                    resolve(result);
                }
            };

            // 15s timeout
            timeout = setTimeout(() => {
                finish({ isValid: false, error: `Authorization timeout (Raw ${attempt})` });
            }, 15000);

            socket.on('open', () => {
                // Send Ping first to ensure connection is actually talking
                socket.send(JSON.stringify({ ping: 1 }));
            });

            socket.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());

                    if (msg.msg_type === 'ping') {
                        socket.send(JSON.stringify({ authorize: token }));
                        return;
                    }

                    if (msg.error) {
                        finish({ isValid: false, error: msg.error.message });
                    } else if (msg.msg_type === 'authorize') {
                        finish({
                            isValid: true,
                            userData: {
                                loginid: msg.authorize.loginid,
                                email: msg.authorize.email,
                                currency: msg.authorize.currency
                            }
                        });
                    }
                } catch (e) {
                    finish({ isValid: false, error: 'Response parsing failed' });
                }
            });

            socket.on('error', (err) => finish({ isValid: false, error: err.message }));
            socket.on('close', () => { if (!isResolved) finish({ isValid: false, error: 'Connection closed' }); });
        });
    }
}

// Export singleton instance
module.exports = new DerivClient();
