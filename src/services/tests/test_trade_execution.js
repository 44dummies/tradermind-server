
const assert = require('assert');

// 1. Mock Environment Variables BEFORE imports
process.env.SUPABASE_URL = 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'mock_key';
process.env.SUPABASE_ANON_KEY = 'mock_key';
process.env.REDIS_URL = 'redis://mock:6379';

// 2. Mock Internal Dependencies using require cache
// We need to mock 'supabase' client creation and 'messageQueue'
const mockSupabase = {
    from: () => ({
        select: () => ({ eq: () => ({ single: () => ({ data: {} }), maybeSingle: () => ({ data: {} }) }) }),
        insert: () => ({ select: () => ({ single: () => ({ data: { id: 1 } }) }) }),
        update: () => ({ eq: () => ({}) })
    })
};

// Mock the supabase module itself
require.cache[require.resolve('../../db/supabase')] = {
    exports: { supabase: mockSupabase }
};

// Mock messageQueue
const mockQueue = {
    isReady: () => true,
    publish: async () => { },
    redis: { set: async () => { } }
};
require.cache[require.resolve('../../queue')] = {
    exports: { messageQueue: mockQueue, TOPICS: {} }
};

// Mock other dependencies that trigger side effects
require.cache[require.resolve('../../utils/performance')] = {
    exports: { start: () => { }, end: () => 100, logLatency: () => { } }
};

require.cache[require.resolve('../auditLogger')] = {
    exports: { log: () => { } }
};

// Now import the module under test
const tradeExecutor = require('../tradeExecutor');
const derivClient = require('../derivClient');

// Mock Data
const mockProposal = {
    id: 'prop_12345',
    ask_price: 10,
    payout: 19.5,
    contract_type: 'DIGITOVER'
};

const mockBuyResult = {
    contract_id: 'contr_67890',
    buy_price: 10,
    payout: 19.5,
    balance_after: 990
};

// Mock DerivClient
derivClient.getProposal = async (accountId, token, params) => {
    console.log('[Mock] getProposal called with:', params);
    if (params.amount < 0.35) throw new Error('Stake too low');
    return mockProposal;
};

derivClient.buy = async (accountId, token, params) => {
    console.log('[Mock] buy called with:', params);
    if (params.proposal_id !== mockProposal.id) throw new Error('Invalid Proposal ID');
    return {
        success: true,
        ...mockBuyResult
    };
};

// Mock ConnectionManager (used inside tradeExecutor)
const connectionManager = require('../connectionManager');
connectionManager.getConnection = async () => ({
    send: () => { },
    on: () => { },
    removeListener: () => { }
});

// Test Function
async function runTest() {
    console.log('--- Starting Trade Executor Unit Test ---');

    const participant = {
        id: 'part_1',
        user_id: 'user_1',
        deriv_account_id: 'CR123456',
        stake: 10,
        balance: 1000
    };

    const profile = {
        deriv_id: 'CR123456',
        currency: 'USD'
    };

    const signal = {
        side: 'OVER',
        market: 'R_100',
        digit: 2,
        confidence: 0.8
    };

    const sessionData = {
        id: 'session_1',
        markets: ['R_100']
    };

    try {
        const result = await tradeExecutor.executeSingleTrade(
            participant,
            profile,
            'mock_token',
            signal,
            sessionData
        );

        console.log('Trade Result:', result);

        assert.strictEqual(result.success, true, 'Trade should be successful');
        assert.strictEqual(result.contractId, mockBuyResult.contract_id, 'Contract ID matches');
        assert.strictEqual(result.buyPrice, mockBuyResult.buy_price, 'Buy Price matches');

        console.log('✅ TEST PASSED: 2-Step Execution Flow verified');
    } catch (error) {
        console.error('❌ TEST FAILED:', error);
        process.exit(1);
    }
}

runTest();
