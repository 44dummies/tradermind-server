// MOCK SUPABASE before requiring other modules
const mockSupabase = {
    from: (table) => {
        const chain = {
            select: () => chain,
            eq: () => chain,
            neq: () => chain,
            order: () => chain,
            limit: () => chain,
            single: async () => {
                // Mock Session Return
                if (table === 'trading_sessions') {
                    return {
                        data: {
                            id: 'test-session-id',
                            status: 'running',
                            duration_minutes: 60,
                            markets: ['R_100'],
                            volatility_index: 'R_100',
                            min_balance: 10,
                            default_tp: 10,
                            default_sl: 5,
                            staking_mode: 'percentage',
                            initial_stake: 1.0,
                            stake_percentage: 0.05
                        },
                        error: null
                    };
                }
                // Mock Account Return (single)
                if (table === 'trading_accounts') {
                    return {
                        data: {
                            id: 'mock_account_id',
                            user_id: 'mock_user_id',
                            deriv_account_id: 'CR123456',
                            balance: 1000,
                            currency: 'USD',
                            api_token: 'encrypted_token'
                        },
                        error: null
                    };
                }
                return { data: {}, error: null };
            },
            maybeSingle: async () => {
                if (table === 'trading_accounts') {
                    return {
                        data: {
                            id: 'mock_account_id',
                            user_id: 'mock_user_id',
                            deriv_account_id: 'CR123456',
                            balance: 1000,
                            currency: 'USD',
                            api_token: 'encrypted_token'
                        },
                        error: null
                    };
                }
                return { data: null, error: null };
            },
            then: (resolve) => {
                // Handle awaits on the chain directly (e.g. for .select())
                if (table === 'session_participants') {
                    resolve({
                        data: [{
                            id: 'part_1',
                            session_id: 'test-session-id',
                            account_id: 'mock_account_id',
                            user_id: 'mock_user_id',
                            status: 'active',
                            take_profit: 10,
                            stop_loss: 5
                        }],
                        error: null
                    });
                } else {
                    resolve({ data: [], error: null });
                }
            },
            insert: async (data) => {
                console.log(`[MOCK DB] Insert into ${table}:`, JSON.stringify(data));
                return { data, error: null };
            },
            update: async (data) => {
                console.log(`[MOCK DB] Update ${table}:`, JSON.stringify(data));
                return chain; // Return chain for potential further chaining
            },
            delete: async () => ({ error: null })
        };
        return chain;
    }
};

// Override require for supabase
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (path) {
    if (path.endsWith('db/supabase')) {
        return { supabase: mockSupabase };
    }
    if (path === '@supabase/supabase-js') {
        return {
            createClient: () => mockSupabase
        };
    }
    return originalRequire.apply(this, arguments);
};

require('dotenv').config({ path: '/home/dzaddy/Documents/deriv-auth-app/server/.env' });

// Now require services (they will get the mock supabase)
const botManager = require('../services/botManager');
const tradeExecutor = require('../services/tradeExecutor');
const strategyEngine = require('../services/strategyEngine');
const { v4: uuidv4 } = require('uuid');

const TEST_SESSION_ID = 'test-session-id';

// Override TradeExecutor dependencies
tradeExecutor.getConnection = async (derivAccountId, apiToken) => {
    console.log(`[MOCK] Connecting to WebSocket for ${derivAccountId}`);
    return {
        on: (event, cb) => { },
        send: (msg) => {
            const data = JSON.parse(msg);
            if (data.proposal_open_contract) {
                console.log(`[MOCK] Subscribed to contract ${data.contract_id}`);
            }
        },
        removeListener: () => { }
    };
};

tradeExecutor.sendRequest = async (ws, request) => {
    console.log('[MOCK] Sending request:', JSON.stringify(request.parameters || request));
    if (request.buy) {
        return {
            buy: {
                contract_id: `cnt_${Date.now()}`,
                buy_price: request.price,
                payout: request.price * 1.95,
                shortcode: 'mock_contract',
                transaction_id: `txn_${Date.now()}`,
                balance_after: 999
            }
        };
    }
    if (request.sell) {
        return { sell: { sold_for: request.price } };
    }
    return {};
};

tradeExecutor.decryptToken = (token) => token;

// Override Strategy Engine to force signal
strategyEngine.generateSignal = (data) => {
    console.log('[MOCK] Generating FORCED signal');
    return {
        market: 'R_100',
        direction: 'call',
        side: 'OVER',
        digit: 2,
        confidence: 0.85,
        shouldTrade: true,
        parts: { reason: 'Mock Simulation Signal' }
    };
};

// Refine mock for participants query in Executor
const originalFrom = mockSupabase.from;
mockSupabase.from = (table) => {
    if (table === 'session_participants') {
        return {
            select: () => ({
                eq: (col, val) => ({
                    eq: (col2, val2) => ({
                        // Return mock participant
                        then: (resolve) => resolve({
                            data: [{
                                id: 'part_1',
                                session_id: TEST_SESSION_ID,
                                account_id: 'mock_account_id',
                                user_id: 'mock_user_id',
                                status: 'active',
                                take_profit: 10,
                                stop_loss: 5
                            }],
                            error: null
                        })
                    })
                })
            }),
            update: async (data) => ({ eq: () => ({}) })
        };
    }
    if (table === 'trading_sessions' || table === 'trading_accounts') {
        // Handle specific lookups with more precision if needed
        return originalFrom(table);
    }
    return originalFrom(table);
};


async function runSimulation() {
    console.log('🚀 Starting Trading System Simulation (Mocked DB)');
    console.log('-----------------------------------');

    try {
        // 4. Start Bot
        console.log('1. Starting Bot Manager...');
        // Bot check: checks if running session exists. Mock select returns running session.
        // We'll manually inject state since startBot does DB checks that are hard to mock perfectly in chain
        botManager.state.isRunning = true;
        botManager.state.activeSessionId = TEST_SESSION_ID;
        console.log('✅ Bot started (State injected)');

        // 5. Trigger Tick/Signal Manually
        console.log('2. Triggering manual trade execution...');
        const signal = strategyEngine.generateSignal({});

        console.log('3. Executing Trade...');
        const result = await tradeExecutor.executeMultiAccountTrade(signal, TEST_SESSION_ID);

        console.log('-----------------------------------');
        console.log('📊 Trade Execution Result:', result.success ? 'SUCCESS' : 'FAILED');

        if (result.success) {
            console.log(`Executed: ${result.executed}/${result.total}`);
            console.log('Contract ID:', result.results[0].contractId);
            console.log('✅ Trade logic verified: Signal -> Executor -> DB Insert');
        } else {
            console.error('Err:', result.message);
            if (result.invalidAccounts) console.log('Invalid Accounts:', result.invalidAccounts);
        }

    } catch (error) {
        console.error('❌ Simulation Error:', error);
    } finally {
        console.log('✅ Simulation complete');
        process.exit(0);
    }
}

runSimulation();
