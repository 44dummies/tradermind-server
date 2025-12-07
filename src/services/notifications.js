

const { supabase } = require('../db/supabase');

const NotificationsService = {
  
  async create(userId, notificationData) {
    const {
      type,
      title,
      message,
      payload = {},
      related_user_id,
      related_chat_id,
      action_url
    } = notificationData;
    
    const { data, error } = await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        type,
        title,
        message,
        payload,
        related_user_id,
        related_chat_id,
        action_url
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  
  async getNotifications(userId, options = {}) {
    const { limit = 50, unreadOnly = false, offset = 0 } = options;
    
    let query = supabase
      .from('notifications')
      .select(`
        *,
        related_user:user_profiles!notifications_related_user_id_fkey(
          id, username, fullname, profile_photo
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    if (unreadOnly) {
      query = query.eq('is_read', false);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  
  async getUnreadCount(userId) {
    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);
    
    if (error) throw error;
    return count || 0;
  },

  
  async markAsRead(notificationId, userId) {
    const { error } = await supabase
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString()
      })
      .eq('id', notificationId)
      .eq('user_id', userId);
    
    if (error) throw error;
    return { success: true };
  },

  
  async markAllAsRead(userId) {
    const { error } = await supabase
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .eq('is_read', false);
    
    if (error) throw error;
    return { success: true };
  },

  
  async delete(notificationId, userId) {
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', notificationId)
      .eq('user_id', userId);
    
    if (error) throw error;
    return { success: true };
  },

  
  async cleanupOld() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);
    
    const { error, count } = await supabase
      .from('notifications')
      .delete()
      .lt('created_at', cutoffDate.toISOString())
      .eq('is_read', true);
    
    if (error) throw error;
    return { deleted: count };
  },

  
  
  

  
  async checkAnniversaries() {
    const milestones = [1, 7, 30, 90, 180, 365];
    const now = new Date();
    
    for (const days of milestones) {
      const targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() - days);
      const dateStr = targetDate.toISOString().split('T')[0];
      
      const { data: friendships } = await supabase
        .from('friendships')
        .select(`
          id, user_id, friend_id, friendship_started_at,
          friend:user_profiles!friendships_friend_id_fkey(username)
        `)
        .eq('status', 'accepted')
        .gte('friendship_started_at', `${dateStr}T00:00:00`)
        .lt('friendship_started_at', `${dateStr}T23:59:59`);
      
      for (const friendship of (friendships || [])) {
        const daysText = days === 1 ? '1 day' : 
                        days < 30 ? `${days} days` :
                        days < 365 ? `${Math.floor(days/30)} month(s)` :
                        '1 year';
        
        await this.create(friendship.user_id, {
          type: 'anniversary',
          title: `🎉 Friend Anniversary!`,
          message: `You've been friends with ${friendship.friend?.username} for ${daysText}!`,
          related_user_id: friendship.friend_id,
          payload: { days, friendship_id: friendship.id }
        });
      }
    }
  },

  
  async notifyTradingStarted(userId) {
    
    const { data: friendships } = await supabase
      .from('friendships')
      .select(`
        friend_id,
        user:user_profiles!friendships_user_id_fkey(username)
      `)
      .eq('user_id', userId)
      .eq('status', 'accepted');
    
    for (const friendship of (friendships || [])) {
      await this.create(friendship.friend_id, {
        type: 'trading_started',
        title: '📊 Friend is Trading',
        message: `${friendship.user?.username} started trading!`,
        related_user_id: userId
      });
    }
  },

  
  async notifyAchievement(userId, achievement) {
    await this.create(userId, {
      type: 'achievement',
      title: '🏆 Achievement Unlocked!',
      message: `You earned "${achievement.name}"`,
      payload: { achievement }
    });
  },

  
  async notifyBadge(userId, badge) {
    await this.create(userId, {
      type: 'badge',
      title: '🎖️ New Badge!',
      message: `You earned the ${badge.name} badge!`,
      payload: { badge }
    });
  }
};

module.exports = NotificationsService;
