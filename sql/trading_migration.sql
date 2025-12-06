-- =============================================
-- TRADING SYSTEM MIGRATION
-- Multi-Account Automated Trading + Strategy Engine + Session System
-- =============================================

-- Enable UUID extension if not exists
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- TRADING ACCOUNTS TABLE
-- Stores connected Deriv trading accounts
-- =============================================
CREATE TABLE IF NOT EXISTS trading_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  deriv_account_id VARCHAR(50) NOT NULL,
  deriv_token TEXT NOT NULL,
  account_type VARCHAR(20) DEFAULT 'real',
  currency VARCHAR(10) DEFAULT 'USD',
  balance DECIMAL(20, 8) DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  is_virtual BOOLEAN DEFAULT FALSE,
  last_balance_update TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, deriv_account_id)
);

CREATE INDEX IF NOT EXISTS idx_trading_accounts_user_id ON trading_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_trading_accounts_deriv_id ON trading_accounts(deriv_account_id);
CREATE INDEX IF NOT EXISTS idx_trading_accounts_active ON trading_accounts(is_active) WHERE is_active = TRUE;

-- =============================================
-- TRADING SESSIONS TABLE
-- Admin-created trading sessions with strategies
-- =============================================
CREATE TABLE IF NOT EXISTS trading_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  session_name VARCHAR(100) NOT NULL,
  session_type VARCHAR(20) NOT NULL DEFAULT 'day',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  
  -- Trading Configuration
  strategy_name VARCHAR(50) NOT NULL,
  volatility_index VARCHAR(20) NOT NULL DEFAULT 'R_100',
  contract_type VARCHAR(30) NOT NULL DEFAULT 'DIGITEVEN',
  
  -- Staking Configuration
  staking_mode VARCHAR(20) NOT NULL DEFAULT 'fixed',
  initial_stake DECIMAL(20, 8) NOT NULL,
  current_stake DECIMAL(20, 8),
  max_stake DECIMAL(20, 8),
  martingale_multiplier DECIMAL(5, 2) DEFAULT 2.0,
  
  -- Session Limits
  profit_threshold DECIMAL(20, 8),
  loss_threshold DECIMAL(20, 8),
  max_trades INTEGER,
  duration_minutes INTEGER,
  
  -- Session Stats
  total_trades INTEGER DEFAULT 0,
  winning_trades INTEGER DEFAULT 0,
  losing_trades INTEGER DEFAULT 0,
  total_profit DECIMAL(20, 8) DEFAULT 0,
  total_loss DECIMAL(20, 8) DEFAULT 0,
  net_pnl DECIMAL(20, 8) DEFAULT 0,
  
  -- Timestamps
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT check_session_type CHECK (session_type IN ('day', 'one_time', 'recovery')),
  CONSTRAINT check_session_status CHECK (status IN ('pending', 'active', 'paused', 'completed', 'cancelled', 'failed')),
  CONSTRAINT check_staking_mode CHECK (staking_mode IN ('fixed', 'martingale', 'compounding'))
);

CREATE INDEX IF NOT EXISTS idx_trading_sessions_admin_id ON trading_sessions(admin_id);
CREATE INDEX IF NOT EXISTS idx_trading_sessions_status ON trading_sessions(status);
CREATE INDEX IF NOT EXISTS idx_trading_sessions_type ON trading_sessions(session_type);
CREATE INDEX IF NOT EXISTS idx_trading_sessions_created ON trading_sessions(created_at DESC);

-- =============================================
-- SESSION INVITATIONS TABLE
-- Links users/accounts to trading sessions
-- =============================================
CREATE TABLE IF NOT EXISTS session_invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES trading_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  account_id UUID REFERENCES trading_accounts(id) ON DELETE SET NULL,
  
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  invited_by UUID NOT NULL REFERENCES user_profiles(id),
  
  -- User's session stats
  trades_count INTEGER DEFAULT 0,
  profit DECIMAL(20, 8) DEFAULT 0,
  loss DECIMAL(20, 8) DEFAULT 0,
  
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT check_invitation_status CHECK (status IN ('pending', 'accepted', 'declined', 'removed')),
  UNIQUE(session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_session_invitations_session_id ON session_invitations(session_id);
CREATE INDEX IF NOT EXISTS idx_session_invitations_user_id ON session_invitations(user_id);
CREATE INDEX IF NOT EXISTS idx_session_invitations_status ON session_invitations(status);

-- =============================================
-- TRADES TABLE
-- Individual trade records
-- =============================================
CREATE TABLE IF NOT EXISTS trades (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID REFERENCES trading_sessions(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  account_id UUID REFERENCES trading_accounts(id) ON DELETE SET NULL,
  
  -- Contract Details
  contract_id VARCHAR(100),
  deriv_reference_id BIGINT,
  contract_type VARCHAR(30) NOT NULL,
  volatility_index VARCHAR(20) NOT NULL,
  
  -- Trade Details
  stake DECIMAL(20, 8) NOT NULL,
  payout DECIMAL(20, 8),
  profit DECIMAL(20, 8),
  entry_tick DECIMAL(20, 8),
  exit_tick DECIMAL(20, 8),
  entry_digit INTEGER,
  exit_digit INTEGER,
  prediction VARCHAR(50),
  
  -- Strategy Info
  strategy_name VARCHAR(50),
  strategy_signal JSONB,
  
  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  result VARCHAR(10),
  error_message TEXT,
  
  -- Timestamps
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT check_trade_status CHECK (status IN ('pending', 'open', 'won', 'lost', 'cancelled', 'error')),
  CONSTRAINT check_trade_result CHECK (result IS NULL OR result IN ('win', 'loss'))
);

CREATE INDEX IF NOT EXISTS idx_trades_session_id ON trades(session_id);
CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_account_id ON trades(account_id);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_created ON trades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_contract_id ON trades(contract_id);

-- =============================================
-- RECOVERY STATES TABLE
-- Tracks recovery session state
-- =============================================
CREATE TABLE IF NOT EXISTS recovery_states (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES trading_sessions(id) ON DELETE CASCADE,
  
  -- Recovery Progress
  recovery_target DECIMAL(20, 8) NOT NULL,
  recovered_amount DECIMAL(20, 8) DEFAULT 0,
  remaining_amount DECIMAL(20, 8),
  recovery_progress DECIMAL(5, 2) DEFAULT 0,
  
  -- Recovery Strategy
  current_multiplier DECIMAL(5, 2) DEFAULT 1.0,
  consecutive_losses INTEGER DEFAULT 0,
  max_consecutive_losses INTEGER DEFAULT 0,
  
  -- State
  is_active BOOLEAN DEFAULT TRUE,
  completed_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(session_id)
);

CREATE INDEX IF NOT EXISTS idx_recovery_states_session_id ON recovery_states(session_id);
CREATE INDEX IF NOT EXISTS idx_recovery_states_active ON recovery_states(is_active) WHERE is_active = TRUE;

-- =============================================
-- ACTIVITY LOGS TABLE
-- Audit trail for trading activities
-- =============================================
CREATE TABLE IF NOT EXISTS trading_activity_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  session_id UUID REFERENCES trading_sessions(id) ON DELETE SET NULL,
  
  action_type VARCHAR(50) NOT NULL,
  action_details JSONB DEFAULT '{}',
  
  ip_address VARCHAR(45),
  user_agent TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON trading_activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_session_id ON trading_activity_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON trading_activity_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON trading_activity_logs(created_at DESC);

-- =============================================
-- NOTIFICATIONS TABLE
-- Trading notifications for users
-- =============================================
CREATE TABLE IF NOT EXISTS trading_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  session_id UUID REFERENCES trading_sessions(id) ON DELETE SET NULL,
  
  notification_type VARCHAR(50) NOT NULL,
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT check_notification_type CHECK (notification_type IN (
    'session_invite', 'session_started', 'session_ended', 'session_paused',
    'trade_executed', 'trade_won', 'trade_lost', 'profit_target_reached',
    'loss_threshold_reached', 'account_connected', 'account_disconnected',
    'recovery_started', 'recovery_completed', 'system_alert'
  ))
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON trading_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON trading_notifications(user_id, is_read) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_notifications_created ON trading_notifications(created_at DESC);

-- =============================================
-- STRATEGY PERFORMANCE TABLE
-- Track strategy performance over time
-- =============================================
CREATE TABLE IF NOT EXISTS strategy_performance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  strategy_name VARCHAR(50) NOT NULL,
  volatility_index VARCHAR(20) NOT NULL,
  contract_type VARCHAR(30) NOT NULL,
  
  -- Performance Metrics
  total_trades INTEGER DEFAULT 0,
  winning_trades INTEGER DEFAULT 0,
  losing_trades INTEGER DEFAULT 0,
  win_rate DECIMAL(5, 2) DEFAULT 0,
  
  total_profit DECIMAL(20, 8) DEFAULT 0,
  total_loss DECIMAL(20, 8) DEFAULT 0,
  net_pnl DECIMAL(20, 8) DEFAULT 0,
  
  avg_profit_per_trade DECIMAL(20, 8) DEFAULT 0,
  max_consecutive_wins INTEGER DEFAULT 0,
  max_consecutive_losses INTEGER DEFAULT 0,
  
  -- Time Period
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(strategy_name, volatility_index, contract_type, period_start)
);

CREATE INDEX IF NOT EXISTS idx_strategy_perf_name ON strategy_performance(strategy_name);
CREATE INDEX IF NOT EXISTS idx_strategy_perf_index ON strategy_performance(volatility_index);
CREATE INDEX IF NOT EXISTS idx_strategy_perf_period ON strategy_performance(period_start, period_end);

-- =============================================
-- FUNCTIONS AND TRIGGERS
-- =============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers
DROP TRIGGER IF EXISTS update_trading_accounts_updated_at ON trading_accounts;
CREATE TRIGGER update_trading_accounts_updated_at
  BEFORE UPDATE ON trading_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_trading_sessions_updated_at ON trading_sessions;
CREATE TRIGGER update_trading_sessions_updated_at
  BEFORE UPDATE ON trading_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_session_invitations_updated_at ON session_invitations;
CREATE TRIGGER update_session_invitations_updated_at
  BEFORE UPDATE ON session_invitations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_recovery_states_updated_at ON recovery_states;
CREATE TRIGGER update_recovery_states_updated_at
  BEFORE UPDATE ON recovery_states
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_strategy_performance_updated_at ON strategy_performance;
CREATE TRIGGER update_strategy_performance_updated_at
  BEFORE UPDATE ON strategy_performance
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- ROW LEVEL SECURITY POLICIES
-- =============================================

-- Enable RLS on all trading tables
ALTER TABLE trading_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE trading_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE trading_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE trading_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_performance ENABLE ROW LEVEL SECURITY;

-- Service role bypass (for backend operations)
CREATE POLICY "Service role full access on trading_accounts" ON trading_accounts
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on trading_sessions" ON trading_sessions
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on session_invitations" ON session_invitations
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on trades" ON trades
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on recovery_states" ON recovery_states
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on trading_activity_logs" ON trading_activity_logs
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on trading_notifications" ON trading_notifications
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on strategy_performance" ON strategy_performance
  FOR ALL USING (auth.role() = 'service_role');

-- =============================================
-- GRANT PERMISSIONS
-- =============================================
GRANT ALL ON trading_accounts TO service_role;
GRANT ALL ON trading_sessions TO service_role;
GRANT ALL ON session_invitations TO service_role;
GRANT ALL ON trades TO service_role;
GRANT ALL ON recovery_states TO service_role;
GRANT ALL ON trading_activity_logs TO service_role;
GRANT ALL ON trading_notifications TO service_role;
GRANT ALL ON strategy_performance TO service_role;

-- =============================================
-- MIGRATION COMPLETE
-- =============================================
