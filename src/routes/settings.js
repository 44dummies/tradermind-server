

const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { supabase } = require('../db/supabase');
const { getProfileByDerivId, upsertUserProfile } = require('../services/profile');

const router = express.Router();

async function ensureUserProfile(derivId) {
  let user = await getProfileByDerivId(derivId);
  
  if (!user) {
    user = await upsertUserProfile(derivId, {
      username: `trader_${derivId.toLowerCase().slice(0, 8)}`,
      fullname: null,
      email: null,
      country: null
    });
  }
  
  return user;
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const user = await ensureUserProfile(req.user.derivId);
    
    
    const { data: settings } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .single();

    
    res.json({
      
      online_visibility: settings?.online_visibility ?? true,
      profile_visibility: settings?.profile_visibility || 'public',
      allow_messages_from: settings?.allow_messages_from || 'everyone',
      allow_tags_from: settings?.allow_tags_from || 'everyone',
      show_trading_stats: settings?.show_trading_stats ?? true,
      show_on_leaderboard: settings?.show_on_leaderboard ?? true,
      searchable: settings?.searchable ?? true,
      
      
      notify_trade_alerts: settings?.notify_trade_alerts ?? true,
      notify_community_mentions: settings?.notify_community_mentions ?? true,
      notify_post_replies: settings?.notify_post_replies ?? true,
      notify_new_followers: settings?.notify_new_followers ?? true,
      notify_admin_announcements: settings?.notify_admin_announcements ?? true,
      push_notifications: settings?.push_notifications ?? true,
      
      
      chat: {
        enterToSend: settings?.chat?.enterToSend ?? true,
        showTypingIndicator: settings?.chat?.showTypingIndicator ?? true,
        showReadReceipts: settings?.chat?.showReadReceipts ?? true
      }
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

router.put('/', authMiddleware, async (req, res) => {
  try {
    const user = await ensureUserProfile(req.user.derivId);
    
    const settingsData = {
      user_id: user.id,
      ...req.body,
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from('user_settings')
      .upsert(settingsData, { onConflict: 'user_id' });

    if (error) throw error;

    res.json({ success: true, message: 'Settings updated' });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

router.put('/privacy', authMiddleware, async (req, res) => {
  try {
    const user = await ensureUserProfile(req.user.derivId);
    
    const {
      online_visibility,
      profile_visibility,
      allow_messages_from,
      allow_tags_from,
      show_trading_stats,
      show_on_leaderboard,
      searchable
    } = req.body;

    
    const { data: existing } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .single();

    const settingsData = {
      user_id: user.id,
      online_visibility: online_visibility ?? existing?.online_visibility ?? true,
      profile_visibility: profile_visibility || existing?.profile_visibility || 'public',
      allow_messages_from: allow_messages_from || existing?.allow_messages_from || 'everyone',
      allow_tags_from: allow_tags_from || existing?.allow_tags_from || 'everyone',
      show_trading_stats: show_trading_stats ?? existing?.show_trading_stats ?? true,
      show_on_leaderboard: show_on_leaderboard ?? existing?.show_on_leaderboard ?? true,
      searchable: searchable ?? existing?.searchable ?? true,
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from('user_settings')
      .upsert(settingsData, { onConflict: 'user_id' });

    if (error) throw error;

    res.json({ success: true, message: 'Privacy settings updated' });
  } catch (error) {
    console.error('Update privacy settings error:', error);
    res.status(500).json({ error: 'Failed to update privacy settings' });
  }
});

router.put('/notifications', authMiddleware, async (req, res) => {
  try {
    const user = await ensureUserProfile(req.user.derivId);
    
    const {
      notify_trade_alerts,
      notify_community_mentions,
      notify_post_replies,
      notify_new_followers,
      notify_admin_announcements,
      push_notifications
    } = req.body;

    
    const { data: existing } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .single();

    const settingsData = {
      user_id: user.id,
      notify_trade_alerts: notify_trade_alerts ?? existing?.notify_trade_alerts ?? true,
      notify_community_mentions: notify_community_mentions ?? existing?.notify_community_mentions ?? true,
      notify_post_replies: notify_post_replies ?? existing?.notify_post_replies ?? true,
      notify_new_followers: notify_new_followers ?? existing?.notify_new_followers ?? true,
      notify_admin_announcements: notify_admin_announcements ?? existing?.notify_admin_announcements ?? true,
      push_notifications: push_notifications ?? existing?.push_notifications ?? true,
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from('user_settings')
      .upsert(settingsData, { onConflict: 'user_id' });

    if (error) throw error;

    res.json({ success: true, message: 'Notification settings updated' });
  } catch (error) {
    console.error('Update notification settings error:', error);
    res.status(500).json({ error: 'Failed to update notification settings' });
  }
});

router.get('/trading', authMiddleware, async (req, res) => {
  try {
    const user = await ensureUserProfile(req.user.derivId);
    
    
    let trading = null;
    
    
    const { data: tradingData } = await supabase
      .from('trading_preferences')
      .select('*')
      .eq('user_id', user.id)
      .single();
    
    if (tradingData) {
      trading = tradingData;
    } else {
      
      const { data: settings } = await supabase
        .from('user_settings')
        .select('trading')
        .eq('user_id', user.id)
        .single();
      
      if (settings?.trading) {
        trading = settings.trading;
      }
    }

    
    res.json({
      default_market: trading?.default_market || 'boom_crash',
      favorite_markets: trading?.favorite_markets || ['boom_crash'],
      default_stake_amount: trading?.default_stake_amount || 10,
      max_stake_amount: trading?.max_stake_amount || 1000,
      risk_level: trading?.risk_level || 'medium',
      stop_loss_enabled: trading?.stop_loss_enabled ?? true,
      default_stop_loss_percent: trading?.default_stop_loss_percent || 5,
      take_profit_enabled: trading?.take_profit_enabled ?? true,
      default_take_profit_percent: trading?.default_take_profit_percent || 10,
      sound_enabled: trading?.sound_enabled ?? true,
      sound_trade_open: trading?.sound_trade_open ?? true,
      sound_trade_win: trading?.sound_trade_win ?? true,
      sound_trade_loss: trading?.sound_trade_loss ?? true,
      sound_volume: trading?.sound_volume || 70
    });
  } catch (error) {
    console.error('Get trading preferences error:', error);
    res.status(500).json({ error: 'Failed to get trading preferences' });
  }
});

router.put('/trading', authMiddleware, async (req, res) => {
  try {
    const user = await ensureUserProfile(req.user.derivId);
    
    const {
      default_market,
      favorite_markets,
      default_stake_amount,
      max_stake_amount,
      risk_level,
      stop_loss_enabled,
      default_stop_loss_percent,
      take_profit_enabled,
      default_take_profit_percent,
      sound_enabled,
      sound_trade_open,
      sound_trade_win,
      sound_trade_loss,
      sound_volume
    } = req.body;

    
    const stake = parseInt(default_stake_amount) || 10;
    const maxStake = parseInt(max_stake_amount) || 1000;
    
    if (stake < 1 || stake > maxStake) {
      return res.status(400).json({ error: 'Invalid stake amount' });
    }

    
    const tradingData = {
      user_id: user.id,
      deriv_account_id: req.user.derivId,
      default_market: default_market || 'boom_crash',
      favorite_markets: favorite_markets || ['boom_crash'],
      default_stake_amount: stake,
      max_stake_amount: maxStake,
      risk_level: risk_level || 'medium',
      stop_loss_enabled: stop_loss_enabled ?? true,
      default_stop_loss_percent: Math.min(Math.max(default_stop_loss_percent || 5, 1), 100),
      take_profit_enabled: take_profit_enabled ?? true,
      default_take_profit_percent: Math.min(Math.max(default_take_profit_percent || 10, 1), 1000),
      sound_enabled: sound_enabled ?? true,
      sound_trade_open: sound_trade_open ?? true,
      sound_trade_win: sound_trade_win ?? true,
      sound_trade_loss: sound_trade_loss ?? true,
      sound_volume: Math.min(Math.max(sound_volume || 70, 0), 100),
      updated_at: new Date().toISOString()
    };

    
    const { error: tradingError } = await supabase
      .from('trading_preferences')
      .upsert(tradingData, { onConflict: 'user_id' });

    
    if (tradingError) {
      console.log('trading_preferences table not found, using user_settings');
      
      const { error } = await supabase
        .from('user_settings')
        .upsert({
          user_id: user.id,
          trading: tradingData,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });

      if (error) throw error;
    }

    res.json({ success: true, message: 'Trading preferences updated' });
  } catch (error) {
    console.error('Update trading preferences error:', error);
    res.status(500).json({ error: 'Failed to update trading preferences' });
  }
});

router.get('/sessions', authMiddleware, async (req, res) => {
  try {
    const user = await ensureUserProfile(req.user.derivId);
    
    
    let sessions = [];
    
    const { data: sessionsData, error } = await supabase
      .from('active_sessions')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('last_activity', { ascending: false });

    if (!error && sessionsData) {
      sessions = sessionsData.map(s => ({
        id: s.id,
        socket_id: s.socket_id,
        device_type: s.device_type || 'unknown',
        device_name: s.device_name || 'Unknown Device',
        browser: s.browser || 'Unknown Browser',
        os: s.os || 'Unknown OS',
        ip_address: s.ip_address,
        location: s.location || 'Unknown',
        is_current: s.socket_id === req.headers['x-socket-id'],
        last_activity: s.last_activity,
        created_at: s.created_at
      }));
    }

    res.json(sessions);
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({ error: 'Failed to get sessions' });
  }
});

router.delete('/sessions', authMiddleware, async (req, res) => {
  try {
    const user = await ensureUserProfile(req.user.derivId);
    const currentSocketId = req.headers['x-socket-id'];

    
    const { error } = await supabase
      .from('active_sessions')
      .update({ 
        is_active: false, 
        terminated_at: new Date().toISOString(),
        termination_reason: 'user_logout_all'
      })
      .eq('user_id', user.id)
      .neq('socket_id', currentSocketId || '');

    if (error) {
      console.error('Session termination error:', error);
      
    }

    res.json({ success: true, message: 'All other sessions terminated' });
  } catch (error) {
    console.error('Terminate sessions error:', error);
    res.status(500).json({ error: 'Failed to terminate sessions' });
  }
});

router.delete('/sessions/:sessionId', authMiddleware, async (req, res) => {
  try {
    const user = await ensureUserProfile(req.user.derivId);
    const { sessionId } = req.params;

    
    const { error } = await supabase
      .from('active_sessions')
      .update({ 
        is_active: false,
        terminated_at: new Date().toISOString(),
        termination_reason: 'user_logout'
      })
      .eq('user_id', user.id)
      .or(`id.eq.${sessionId},socket_id.eq.${sessionId}`);

    if (error) {
      console.error('Session termination error:', error);
    }

    res.json({ success: true, message: 'Session terminated' });
  } catch (error) {
    console.error('Terminate session error:', error);
    res.status(500).json({ error: 'Failed to terminate session' });
  }
});

module.exports = router;
