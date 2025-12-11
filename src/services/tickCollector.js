const WebSocket = require('ws');
const EventEmitter = require('events');

/**
 * Deriv WebSocket Tick Collector
 * Streams live tick data for multiple markets
 * Maintains last 100 ticks per market for analysis
 */
class TickCollector extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.connected = false;
    this.subscriptions = new Map(); // market -> subscription_id
    this.tickHistory = new Map(); // market -> [last 100 ticks]
    this.digitHistory = new Map(); // market -> [last 100 digits]
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 5000;
    this.pingInterval = null;
    this.apiToken = null;
  }

  /**
   * Connect to Deriv WebSocket
   */
  async connect(apiToken = null) {
    return new Promise((resolve, reject) => {
      try {
        console.log('[TickCollector] 🔌 Connecting to Deriv WebSocket...');

        this.apiToken = apiToken;
        const { WS_URL } = require('../config/deriv');
        this.ws = new WebSocket(WS_URL);

        this.ws.on('open', () => {
          console.log('[TickCollector] ✅ Connected to Deriv WebSocket');
          this.connected = true;
          this.reconnectAttempts = 0;

          // Start ping to keep connection alive
          this.startPing();

          // Authorize if token provided
          if (this.apiToken) {
            this.authorize(this.apiToken);
          }

          this.emit('connected');
          resolve();
        });

        this.ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleMessage(message);
          } catch (error) {
            console.error('[TickCollector] Message parse error:', error);
          }
        });

        this.ws.on('close', () => {
          console.log('[TickCollector] ❌ WebSocket closed');
          this.connected = false;
          this.stopPing();
          this.emit('disconnected');

          // Attempt reconnect
          this.reconnect();
        });

        this.ws.on('error', (error) => {
          console.error('[TickCollector] WebSocket error:', error);
          this.emit('error', error);
          reject(error);
        });

      } catch (error) {
        console.error('[TickCollector] Connection error:', error);
        reject(error);
      }
    });
  }

  /**
   * Authorize with Deriv API token
   */
  authorize(token) {
    if (!this.connected) {
      console.error('[TickCollector] Cannot authorize - not connected');
      return;
    }

    this.send({
      authorize: token
    });
  }

  /**
   * Subscribe to tick stream for a market
   */
  subscribeTicks(market) {
    if (!this.connected) {
      console.error('[TickCollector] Cannot subscribe - not connected');
      return false;
    }

    if (this.subscriptions.has(market)) {
      console.log(`[TickCollector] Already subscribed to ${market}`);
      return true;
    }

    console.log(`[TickCollector] 📊 Subscribing to ${market} ticks`);

    this.send({
      ticks: market,
      subscribe: 1
    });

    // Initialize tick history
    this.tickHistory.set(market, []);
    this.digitHistory.set(market, []);

    return true;
  }

  /**
   * Unsubscribe from tick stream
   */
  unsubscribeTicks(market) {
    const subscriptionId = this.subscriptions.get(market);

    if (!subscriptionId) {
      return false;
    }

    this.send({
      forget: subscriptionId
    });

    this.subscriptions.delete(market);
    return true;
  }

  /**
   * Handle incoming WebSocket messages
   */
  handleMessage(message) {
    // Handle tick data
    if (message.msg_type === 'tick') {
      if (message.tick) {
        this.handleTick(message);
      } else {
        console.warn('[TickCollector] ⚠️ Received tick message without tick data:', message);
      }
    }

    // Handle subscription confirmation
    else if (message.msg_type === 'tick' && message.subscription) {
      const market = message.echo_req.ticks;
      this.subscriptions.set(market, message.subscription.id);
      console.log(`[TickCollector] ✅ Subscribed to ${market} (ID: ${message.subscription.id})`);
    }

    // Handle authorization
    else if (message.msg_type === 'authorize') {
      console.log('[TickCollector] ✅ Authorized');
      this.emit('authorized', message.authorize);
    }

    // Handle errors
    else if (message.msg_type === 'error') {
      console.error('[TickCollector] API Error:', message.error);
      this.emit('apiError', message.error);
    }
  }

  /**
   * Process tick data
   */
  handleTick(tickData) {
    const market = tickData.tick.symbol;
    const quote = tickData.tick.quote;
    const epoch = tickData.tick.epoch;

    // Extract last digit
    const lastDigit = this.extractLastDigit(quote);

    // Get history arrays
    let ticks = this.tickHistory.get(market) || [];
    let digits = this.digitHistory.get(market) || [];

    // Add new tick
    ticks.push({
      quote,
      epoch,
      digit: lastDigit,
      timestamp: new Date(epoch * 1000)
    });

    digits.push(lastDigit);

    // Keep only last 100
    if (ticks.length > 100) {
      ticks = ticks.slice(-100);
      digits = digits.slice(-100);
    }

    // Update history
    this.tickHistory.set(market, ticks);
    this.digitHistory.set(market, digits);

    // Emit tick event
    this.emit('tick', {
      market,
      quote,
      epoch,
      digit: lastDigit,
      timestamp: new Date(epoch * 1000),
      tickHistory: ticks,
      digitHistory: digits
    });
  }

  /**
   * Extract last digit from quote
   */
  extractLastDigit(quote) {
    const quoteStr = quote.toString();
    const cleanStr = quoteStr.replace('.', '');
    return parseInt(cleanStr[cleanStr.length - 1]);
  }

  /**
   * Get tick history for a market
   */
  getTickHistory(market) {
    return this.tickHistory.get(market) || [];
  }

  /**
   * Get digit history for a market
   */
  getDigitHistory(market) {
    return this.digitHistory.get(market) || [];
  }

  /**
   * Get all subscribed markets
   */
  getSubscribedMarkets() {
    return Array.from(this.subscriptions.keys());
  }

  /**
   * Send message to WebSocket
   */
  send(data) {
    if (!this.connected || !this.ws) {
      console.error('[TickCollector] Cannot send - not connected');
      return false;
    }

    try {
      this.ws.send(JSON.stringify(data));
      return true;
    } catch (error) {
      console.error('[TickCollector] Send error:', error);
      return false;
    }
  }

  /**
   * Start ping to keep connection alive
   */
  startPing() {
    this.pingInterval = setInterval(() => {
      if (this.connected) {
        this.send({ ping: 1 });
      }
    }, 30000); // Ping every 30 seconds
  }

  /**
   * Stop ping interval
   */
  stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Reconnect to WebSocket
   */
  async reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[TickCollector] ❌ Max reconnect attempts reached');
      this.emit('maxReconnectReached');
      return;
    }

    this.reconnectAttempts++;

    const delay = this.reconnectDelay * this.reconnectAttempts;
    console.log(`[TickCollector] 🔄 Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    setTimeout(async () => {
      try {
        await this.connect(this.apiToken);

        // Resubscribe to all markets
        const markets = Array.from(this.tickHistory.keys());
        for (const market of markets) {
          this.subscribeTicks(market);
        }
      } catch (error) {
        console.error('[TickCollector] Reconnect failed:', error);
      }
    }, delay);
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect() {
    console.log('[TickCollector] 🔌 Disconnecting...');

    this.stopPing();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connected = false;
    this.subscriptions.clear();
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent auto-reconnect
  }

  /**
   * Get connection status
   */
  isConnected() {
    return this.connected;
  }

  /**
   * Get statistics
   */
  getStats() {
    const markets = Array.from(this.tickHistory.keys());
    const stats = {};

    for (const market of markets) {
      const ticks = this.tickHistory.get(market) || [];
      const digits = this.digitHistory.get(market) || [];

      stats[market] = {
        tickCount: ticks.length,
        digitCount: digits.length,
        latestQuote: ticks.length > 0 ? ticks[ticks.length - 1].quote : null,
        latestDigit: digits.length > 0 ? digits[digits.length - 1] : null
      };
    }

    return {
      connected: this.connected,
      subscribedMarkets: markets.length,
      markets: stats
    };
  }
}

// Export singleton instance
module.exports = new TickCollector();
