const WebSocket = require('ws');
// Fix import based on existing working code
const DerivAPIBasic = require('@deriv/deriv-api/dist/DerivAPIBasic');
const EventEmitter = require('events');
const config = require('../config');

// Fallback app_id if not in env
const APP_ID = config.deriv.appId || '1089';
const WS_URL = config.deriv.wsUrl || 'wss://ws.binaryws.com/websockets/v3';

class DerivClient extends EventEmitter {
    constructor() {
        super();
        this.connection = null;
        this.api = null;
        this.activeSubscriptions = new Set();
        this.reconnectInterval = 5000;
        this.keepAliveInterval = 30000;
        this.pingTimer = null;
        this.pingTimer = null;
        this.wsUrl = `${WS_URL}?app_id=${APP_ID}`;
        this.isConnected = false;
    }

    async connect() {
        return new Promise((resolve, reject) => {
            try {
                console.log(`[DerivData] Connecting to ${this.wsUrl}...`);
                this.connection = new WebSocket(this.wsUrl);
                this.api = new DerivAPIBasic({ connection: this.connection });

                this.connection.on('open', async () => {
                    console.log('[DerivData] ✅ Connected to Deriv WS');
                    this.isConnected = true;
                    this.startKeepAlive();
                    await this.resubscribeAll();
                    this.emit('connected');
                    resolve();
                });

                this.connection.on('message', (data) => {
                    this.handleMessage(data);
                });

                this.connection.on('close', () => {
                    console.log('[DerivData] 🔌 Disconnected. Reconnecting in 5s...');
                    this.isConnected = false;
                    this.stopKeepAlive();
                    this.emit('disconnected');
                    setTimeout(() => this.connect(), this.reconnectInterval);
                });

                this.connection.on('error', (err) => {
                    console.error('[DerivData] ❌ WebSocket Error:', err.message);
                    this.connection.close(); // Will trigger close event -> reconnect
                });

            } catch (err) {
                reject(err);
            }
        });
    }

    handleMessage(data) {
        try {
            const msg = JSON.parse(data.toString());

            if (msg.tick) {
                this.emit('tick', {
                    symbol: msg.tick.symbol,
                    price: msg.tick.quote,
                    time: new Date(msg.tick.epoch * 1000),
                    raw: msg.tick
                });
            } else if (msg.error) {
                console.error('[DerivData] ⚠️ API Error:', msg.error.message);
            }
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    }

    async subscribeTicks(symbol) {
        if (this.activeSubscriptions.has(symbol)) return;

        this.activeSubscriptions.add(symbol);
        if (this.isConnected) {
            this.sendSubscription(symbol);
        }
    }

    async sendSubscription(symbol) {
        console.log(`[DerivData] Subscribing to ${symbol}`);
        try {
            // We rely on raw sending or api.subscribe if we want to manage it manually
            // But DerivAPIBasic is a bit higher level. 
            // To strictly follow "one connection", we just send the request.
            this.connection.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
        } catch (err) {
            console.error(`[DerivData] Failed to subscribe ${symbol}:`, err);
        }
    }

    async buy(contractParams) {
        if (!this.isConnected) throw new Error('Not connected');
        // Use basic API buy
        return this.api.buy(contractParams);
    }

    async resubscribeAll() {
        for (const symbol of this.activeSubscriptions) {
            await this.sendSubscription(symbol);
        }
    }

    startKeepAlive() {
        this.stopKeepAlive();
        this.pingTimer = setInterval(() => {
            if (this.isConnected && this.connection.readyState === WebSocket.OPEN) {
                this.connection.send(JSON.stringify({ ping: 1 }));
            }
        }, this.keepAliveInterval);
    }

    stopKeepAlive() {
        if (this.pingTimer) clearInterval(this.pingTimer);
    }
}

module.exports = new DerivClient();
