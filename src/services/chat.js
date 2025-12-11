

const { supabase } = require('../db/supabase');

const ChatService = {
  
  
  

  
  async getChatById(chatId) {
    const { data, error } = await supabase
      .from('friend_chats')
      .select(`
        *,
        user1:user_profiles!friend_chats_user1_id_fkey(
          id, username, fullname, profile_photo, is_online, last_seen
        ),
        user2:user_profiles!friend_chats_user2_id_fkey(
          id, username, fullname, profile_photo, is_online, last_seen
        )
      `)
      .eq('id', chatId)
      .single();
    
    if (error) throw error;
    return data;
  },

  
  async getChatByUsers(user1Id, user2Id) {
    const [smallerId, largerId] = user1Id < user2Id 
      ? [user1Id, user2Id] 
      : [user2Id, user1Id];
    
    const { data } = await supabase
      .from('friend_chats')
      .select(`
        *,
        user1:user_profiles!friend_chats_user1_id_fkey(
          id, username, fullname, profile_photo, is_online, last_seen
        ),
        user2:user_profiles!friend_chats_user2_id_fkey(
          id, username, fullname, profile_photo, is_online, last_seen
        )
      `)
      .eq('user1_id', smallerId)
      .eq('user2_id', largerId)
      .single();
    
    return data;
  },

  
  async getOrCreateDirectChat(user1Id, user2Id) {
    
    const [smallerId, largerId] = user1Id < user2Id 
      ? [user1Id, user2Id] 
      : [user2Id, user1Id];
    
    
    let chat = await this.getChatByUsers(smallerId, largerId);
    
    if (!chat) {
      
      const { data, error } = await supabase
        .from('friend_chats')
        .insert({
          user1_id: smallerId,
          user2_id: largerId
        })
        .select(`
          *,
          user1:user_profiles!friend_chats_user1_id_fkey(
            id, username, fullname, profile_photo, is_online, last_seen
          ),
          user2:user_profiles!friend_chats_user2_id_fkey(
            id, username, fullname, profile_photo, is_online, last_seen
          )
        `)
        .single();
      
      if (error) throw error;
      chat = data;
    }
    
    
    const otherUser = chat.user1_id === user1Id ? chat.user2 : chat.user1;
    return {
      ...chat,
      otherUser
    };
  },

  
  async getUserChats(userId) {
    const { data, error } = await supabase
      .from('friend_chats')
      .select(`
        *,
        user1:user_profiles!friend_chats_user1_id_fkey(
          id, username, fullname, profile_photo, is_online, last_seen
        ),
        user2:user_profiles!friend_chats_user2_id_fkey(
          id, username, fullname, profile_photo, is_online, last_seen
        )
      `)
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .order('last_message_at', { ascending: false, nullsFirst: false });
    
    if (error) throw error;
    
    
    return (data || []).map(chat => {
      const otherUser = chat.user1_id === userId ? chat.user2 : chat.user1;
      const isArchived = chat.user1_id === userId ? chat.is_archived_user1 : chat.is_archived_user2;
      return {
        ...chat,
        otherUser,
        isArchived
      };
    });
  },

  
  async toggleArchiveChat(chatId, userId, archived) {
    const chat = await this.getChatById(chatId);
    if (!chat) throw new Error('Chat not found');
    
    const updateField = chat.user1_id === userId ? 'is_archived_user1' : 'is_archived_user2';
    
    const { error } = await supabase
      .from('friend_chats')
      .update({ [updateField]: archived })
      .eq('id', chatId);
    
    if (error) throw error;
    return { success: true };
  },

  
  
  

  
  async sendMessage(chatId, senderId, messageData) {
    const {
      message_text,
      message_type = 'text',
      media_filename,
      media_type,
      media_size,
      media_duration,
      file_url, 
      reply_to_id,
      persistent = true 
    } = messageData;
    
    
    const { data: message, error } = await supabase
      .from('friend_messages')
      .insert({
        chat_id: chatId,
        sender_id: senderId,
        message_text,
        message_type,
        media_filename,
        media_type,
        media_size,
        media_duration,
        file_url, 
        reply_to_id,
        expires_at: null, 
        stored_locally: false 
      })
      .select(`
        *,
        sender:user_profiles!friend_messages_sender_id_fkey(
          id, username, fullname, profile_photo
        ),
        reply_to:friend_messages!friend_messages_reply_to_id_fkey(
          id, message_text, message_type,
          sender:user_profiles!friend_messages_sender_id_fkey(username)
        )
      `)
      .single();
    
    if (error) throw error;
    
    
    await supabase
      .from('friend_chats')
      .update({
        last_message: message_type === 'text' ? message_text : `[${message_type}]`,
        last_message_at: new Date().toISOString(),
        last_message_by: senderId
      })
      .eq('id', chatId);
    
    
    await this.updateStreak(chatId);
    
    return message;
  },

  
  async getMessages(chatId, options = {}) {
    const { limit = 50, before, after } = options;
    
    let query = supabase
      .from('friend_messages')
      .select(`
        *,
        sender:user_profiles!friend_messages_sender_id_fkey(
          id, username, fullname, profile_photo
        ),
        reply_to:friend_messages!friend_messages_reply_to_id_fkey(
          id, message_text, message_type,
          sender:user_profiles!friend_messages_sender_id_fkey(username)
        )
      `)
      .eq('chat_id', chatId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (before) {
      query = query.lt('created_at', before);
    }
    if (after) {
      query = query.gt('created_at', after);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    
    
    return (data || []).reverse();
  },

  
  async markAsRead(chatId, userId) {
    const { error } = await supabase
      .from('friend_messages')
      .update({
        is_read: true,
        read_at: new Date().toISOString()
      })
      .eq('chat_id', chatId)
      .neq('sender_id', userId)
      .eq('is_read', false);
    
    if (error) throw error;
    return { success: true };
  },

  
  async getUnreadCount(chatId, userId) {
    const { count, error } = await supabase
      .from('friend_messages')
      .select('*', { count: 'exact', head: true })
      .eq('chat_id', chatId)
      .neq('sender_id', userId)
      .eq('is_read', false);
    
    if (error) throw error;
    return count || 0;
  },

  
  async getTotalUnreadCount(userId) {
    
    const chats = await this.getUserChats(userId);
    let total = 0;
    
    for (const chat of chats) {
      const count = await this.getUnreadCount(chat.id, userId);
      total += count;
    }
    
    return total;
  },

  
  async deleteMessage(messageId, userId) {
    const { data: message } = await supabase
      .from('friend_messages')
      .select('sender_id')
      .eq('id', messageId)
      .single();
    
    if (!message || message.sender_id !== userId) {
      throw new Error('Cannot delete this message');
    }
    
    const { error } = await supabase
      .from('friend_messages')
      .update({ is_deleted: true })
      .eq('id', messageId);
    
    if (error) throw error;
    return { success: true };
  },

  
  
  

  
  async addReaction(messageId, userId, reaction) {
    const { data: message } = await supabase
      .from('friend_messages')
      .select('reactions')
      .eq('id', messageId)
      .single();
    
    if (!message) throw new Error('Message not found');
    
    const reactions = message.reactions || {};
    if (!reactions[reaction]) {
      reactions[reaction] = [];
    }
    
    
    const userIndex = reactions[reaction].indexOf(userId);
    if (userIndex > -1) {
      reactions[reaction].splice(userIndex, 1);
      if (reactions[reaction].length === 0) {
        delete reactions[reaction];
      }
    } else {
      reactions[reaction].push(userId);
    }
    
    const { error } = await supabase
      .from('friend_messages')
      .update({ reactions })
      .eq('id', messageId);
    
    if (error) throw error;
    
    
    const { data: msgData } = await supabase
      .from('friend_messages')
      .select('sender_id')
      .eq('id', messageId)
      .single();
    
    if (msgData && userIndex === -1) {
      
      await supabase.rpc('increment_helpfulness', { user_id: msgData.sender_id });
    }
    
    return { success: true, reactions };
  },

  
  
  

  
  async setTyping(chatId, userId, isTyping) {
    if (isTyping) {
      await supabase
        .from('typing_indicators')
        .upsert({
          chat_id: chatId,
          user_id: userId,
          started_at: new Date().toISOString()
        }, { onConflict: 'chat_id,user_id' });
    } else {
      await supabase
        .from('typing_indicators')
        .delete()
        .eq('chat_id', chatId)
        .eq('user_id', userId);
    }
  },

  
  async getTypingUsers(chatId) {
    
    const cutoff = new Date(Date.now() - 10000).toISOString();
    await supabase
      .from('typing_indicators')
      .delete()
      .lt('started_at', cutoff);
    
    const { data } = await supabase
      .from('typing_indicators')
      .select(`
        user_id,
        user:user_profiles!typing_indicators_user_id_fkey(username)
      `)
      .eq('chat_id', chatId);
    
    return data || [];
  },

  
  
  

  
  async updateStreak(chatId) {
    const { data: chat } = await supabase
      .from('friend_chats')
      .select('streak_count, streak_last_date')
      .eq('id', chatId)
      .single();
    
    if (!chat) return;
    
    const today = new Date().toISOString().split('T')[0];
    const lastDate = chat.streak_last_date;
    
    let newStreak = chat.streak_count || 0;
    
    if (!lastDate) {
      newStreak = 1;
    } else {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      
      if (lastDate === today) {
        
        return;
      } else if (lastDate === yesterdayStr) {
        
        newStreak += 1;
      } else {
        
        newStreak = 1;
      }
    }
    
    
    let badge = null;
    if (newStreak >= 180) badge = 'aurora';
    else if (newStreak >= 90) badge = 'diamond';
    else if (newStreak >= 30) badge = 'gold';
    else if (newStreak >= 14) badge = 'silver';
    else if (newStreak >= 7) badge = 'bronze';
    else if (newStreak >= 3) badge = 'starter';
    
    const oldBadge = this.getBadgeFromStreak(chat.streak_count || 0);
    const newBadgeEarned = badge && badge !== oldBadge;
    
    await supabase
      .from('friend_chats')
      .update({
        streak_count: newStreak,
        streak_last_date: today,
        streak_badge: badge
      })
      .eq('id', chatId);
    
    
    if (newBadgeEarned) {
      const chatData = await this.getChatById(chatId);
      const badgeNames = {
        starter: '🔥 Starter Streak (3 days)',
        bronze: '🥉 Bronze Streak (7 days)',
        silver: '🥈 Silver Streak (14 days)',
        gold: '🥇 Gold Streak (30 days)',
        diamond: '💎 Diamond Streak (90 days)',
        aurora: '🌌 Aurora Streak (180 days)'
      };
      
      
      for (const userId of [chatData.user1_id, chatData.user2_id]) {
        await supabase
          .from('notifications')
          .insert({
            user_id: userId,
            type: 'streak_milestone',
            title: 'New Streak Badge! ',
            message: `You earned ${badgeNames[badge]}`,
            related_chat_id: chatId,
            payload: { streak: newStreak, badge }
          });
      }
    }
    
    return { streak: newStreak, badge };
  },

  getBadgeFromStreak(streak) {
    if (streak >= 180) return 'aurora';
    if (streak >= 90) return 'diamond';
    if (streak >= 30) return 'gold';
    if (streak >= 14) return 'silver';
    if (streak >= 7) return 'bronze';
    if (streak >= 3) return 'starter';
    return null;
  },

  
  async nameStreak(chatId, userId, name) {
    const chat = await this.getChatById(chatId);
    if (!chat) throw new Error('Chat not found');
    
    if (chat.user1_id !== userId && chat.user2_id !== userId) {
      throw new Error('Not authorized');
    }
    
    const { error } = await supabase
      .from('friend_chats')
      .update({ streak_name: name })
      .eq('id', chatId);
    
    if (error) throw error;
    return { success: true };
  },

  
  
  

  
  async sendPing(chatId, senderId) {
    return this.sendMessage(chatId, senderId, {
      message_text: '👋 Ping!',
      message_type: 'ping'
    });
  }
};

module.exports = ChatService;
