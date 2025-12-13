-- Quant Memory Table for Persistent Learning
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS quant_memory (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    market TEXT NOT NULL UNIQUE DEFAULT 'default',
    weights_data JSONB NOT NULL DEFAULT '{}',
    performance_data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups by market
CREATE INDEX IF NOT EXISTS idx_quant_memory_market ON quant_memory(market);

-- Enable RLS (Row Level Security) - allow service role full access
ALTER TABLE quant_memory ENABLE ROW LEVEL SECURITY;

-- Policy: Allow service role to manage
CREATE POLICY "Service role can manage quant_memory" ON quant_memory
    FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE quant_memory IS 'Stores Bayesian learning weights and performance data for the quant trading engine';
