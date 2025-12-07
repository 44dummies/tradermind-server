const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../../db/supabase');

// List eligible users for recovery
router.get('/eligible', async (req, res) => {
  const { data, error } = await supabase
    .from('recovery_states')
    .select('*')
    .eq('status', 'eligible');

  if (error) return res.status(500).json({ error: error.message });
  res.json({ eligible: data || [] });
});

// Create a recovery session (pending)
router.post('/sessions', async (req, res) => {
  const { name = 'Recovery Session', min_balance = 5, default_tp = 5, default_sl = 3 } = req.body;
  const session = {
    id: uuidv4(),
    admin_id: req.user.id,
    name,
    type: 'recovery',
    status: 'pending',
    min_balance,
    default_tp,
    default_sl,
    markets: ['R_100'],
    strategy: 'DFPM',
    staking_mode: 'fixed',
    base_stake: 1,
    created_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('trading_sessions_v2')
    .insert(session)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ session: data });
});

// Start recovery session
router.post('/sessions/:id/start', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase
    .from('trading_sessions_v2')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', id)
    .eq('type', 'recovery');

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// Stop recovery session
router.post('/sessions/:id/stop', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase
    .from('trading_sessions_v2')
    .update({ status: 'completed', ended_at: new Date().toISOString() })
    .eq('id', id)
    .eq('type', 'recovery');

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;