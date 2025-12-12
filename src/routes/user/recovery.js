const express = require('express');
const router = express.Router();
const { supabase } = require('../../db/supabase');

// Join a recovery session if eligible
router.post('/join', async (req, res) => {
  const { sessionId } = req.body;
  const userId = req.user.id;

  // Must have eligible recovery state
  const { data: state, error: stateErr } = await supabase
    .from('recovery_states')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'eligible')
    .maybeSingle();

  if (stateErr) return res.status(500).json({ error: stateErr.message });
  if (!state) return res.status(403).json({ error: 'Not eligible for recovery' });

  // Ensure session is recovery and pending/running
  const { data: session, error: sessErr } = await supabase
    .from('trading_sessions_v2')
    .select('*')
    .eq('id', sessionId)
    .eq('type', 'recovery')
    .in('status', ['pending', 'active'])
    .single();

  if (sessErr || !session) return res.status(404).json({ error: 'Recovery session not found' });

  // Insert participant record
  const participant = {
    session_id: sessionId,
    user_id: userId,
    tp: session.default_tp,
    sl: session.default_sl,
    status: 'active'
  };

  const { error: partErr } = await supabase
    .from('session_participants')
    .insert(participant)
    .select()
    .maybeSingle();

  if (partErr && partErr.code !== '23505') { // ignore unique violation
    return res.status(500).json({ error: partErr.message });
  }

  // Mark recovery state as joined
  await supabase
    .from('recovery_states')
    .update({ status: 'joined' })
    .eq('user_id', userId)
    .eq('status', 'eligible');

  res.json({ success: true });
});

module.exports = router;