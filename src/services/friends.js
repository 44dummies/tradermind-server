/**
 * Friends Service - Core friendship operations
 * Handles friend requests, friendships, search, and recommendations
 */

const { supabase } = require('../db/supabase');

const FriendsService = {
  // =============================================
  // USER PROFILE OPERATIONS
  // =============================================

  /**
   * Create or update user profile from Deriv OAuth
   */
  async upsertUserProfile(derivId, profileData) {
    const { fullname, email, country } = profileData;
    
    // Generate username from fullname or email
    let username = profileData.username;
    if (!username) {
      username = fullname 
        ? fullname.toLowerCase().replace(/\s+/g, '_').slice(0, 20)
        : `trader_${derivId.slice(-8)}`;
    }
    
    // Check if username exists
    const { data: existingUsername } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('username', username)
      .single();
    
    if (existingUsername) {
      username = `${username}_${Date.now().toString(36)}`;
    }
    
    const { data, error } = await supabase
      .from('user_profiles')
      .upsert({
        deriv_id: derivId,
        username,
        fullname,
        email,
        country,
        profile_photo: profileData.profile_photo || null,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'deriv_id'
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  /**
   * Get user profile by Deriv ID
   */
  async getProfileByDerivId(derivId) {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('deriv_id', derivId)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  /**
   * Get user profile by ID
   */
  async getProfileById(userId) {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();
    
    if (error) throw error;
    return data;
  },

  /**
   * Get user profile by username
   */
  async getProfileByUsername(username) {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('username', username)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  /**
   * Update user profile
   */
  async updateProfile(userId, updates) {
    const { data, error } = await supabase
      .from('user_profiles')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  /**
   * Update user online status
   */
  async updateOnlineStatus(userId, isOnline, socketId = null) {
    // Update user_profiles
    await supabase
      .from('user_profiles')
      .update({
        is_online: isOnline,
        last_seen: new Date().toISOString()
      })
      .eq('id', userId);
    
    // Update presence table
    if (isOnline) {
      await supabase
        .from('user_presence')
        .upsert({
          user_id: userId,
          is_online: true,
          socket_id: socketId,
          last_seen: new Date().toISOString()
        }, { onConflict: 'user_id' });
    } else {
      await supabase
        .from('user_presence')
        .update({
          is_online: false,
          last_seen: new Date().toISOString(),
          socket_id: null
        })
        .eq('user_id', userId);
    }
  },

  // =============================================
  // FRIEND SEARCH
  // =============================================

  /**
   * Search users by username, display_name, fullname, or deriv_id (fuzzy match)
   * Shows username/display_name to friends, but hides deriv_id unless you're the user
   */
  async searchUsers(searchTerm, currentUserId, limit = 20) {
    // Try stored function first
    const { data, error } = await supabase
      .rpc('search_users_by_username', {
        search_term: searchTerm,
        current_user_id: currentUserId,
        result_limit: limit
      });
    
    if (error) {
      // Fallback to direct query with multiple search fields
      const searchPattern = `%${searchTerm}%`;
      
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('user_profiles')
        .select(`
          id,
          deriv_id,
          username,
          display_name,
          fullname,
          country,
          profile_photo,
          status_message,
          performance_tier,
          is_online
        `)
        .neq('id', currentUserId)
        .or(`username.ilike.${searchPattern},display_name.ilike.${searchPattern},fullname.ilike.${searchPattern},deriv_id.ilike.${searchPattern}`)
        .limit(limit);
      
      if (fallbackError) throw fallbackError;
      
      // Add friendship status and mask deriv_id for privacy
      const results = await Promise.all((fallbackData || []).map(async (user) => {
        const friendship = await this.getFriendshipStatus(currentUserId, user.id);
        return { 
          ...user, 
          friendship_status: friendship?.status || 'none',
          // Only show deriv_id to the user themselves - others see display name
          deriv_id: undefined,
          // Use display_name or username as the visible name
          display_name: user.display_name || user.username || user.fullname
        };
      }));
      
      return results;
    }
    
    return data || [];
  },

  // =============================================
  // FRIEND REQUESTS
  // =============================================

  /**
   * Send friend request
   */
  async sendFriendRequest(senderId, receiverId) {
    // Check if request already exists
    const existing = await this.getFriendshipStatus(senderId, receiverId);
    if (existing) {
      if (existing.status === 'blocked') {
        throw new Error('Cannot send request - user has blocked you');
      }
      if (existing.status === 'pending') {
        throw new Error('Friend request already pending');
      }
      if (existing.status === 'accepted') {
        throw new Error('Already friends');
      }
    }
    
    // Check if there's a pending request from the other user
    const reverseRequest = await this.getFriendshipStatus(receiverId, senderId);
    if (reverseRequest?.status === 'pending') {
      // Auto-accept since both want to be friends
      return this.acceptFriendRequest(senderId, reverseRequest.id);
    }
    
    // Create new request
    const { data, error } = await supabase
      .from('friendships')
      .insert({
        user_id: senderId,
        friend_id: receiverId,
        status: 'pending'
      })
      .select()
      .single();
    
    if (error) throw error;
    
    // Create notification
    await this.createNotification(receiverId, {
      type: 'friend_request',
      title: 'New Friend Request',
      message: 'Someone wants to connect with you!',
      related_user_id: senderId,
      payload: { friendship_id: data.id }
    });
    
    return data;
  },

  /**
   * Accept friend request
   */
  async acceptFriendRequest(userId, friendshipId) {
    const { data: friendship, error: fetchError } = await supabase
      .from('friendships')
      .select('*')
      .eq('id', friendshipId)
      .single();
    
    if (fetchError) throw fetchError;
    
    // Verify the user is the recipient
    if (friendship.friend_id !== userId) {
      throw new Error('Not authorized to accept this request');
    }
    
    // Update friendship status
    const { data, error } = await supabase
      .from('friendships')
      .update({
        status: 'accepted',
        friendship_started_at: new Date().toISOString()
      })
      .eq('id', friendshipId)
      .select()
      .single();
    
    if (error) throw error;
    
    // Create reciprocal friendship record
    await supabase
      .from('friendships')
      .upsert({
        user_id: friendship.friend_id,
        friend_id: friendship.user_id,
        status: 'accepted',
        friendship_started_at: new Date().toISOString()
      }, { onConflict: 'user_id,friend_id' });
    
    // Create chat for the friends
    const chatId = await this.getOrCreateChat(friendship.user_id, friendship.friend_id);
    
    // Create shared notes and watchlist
    await this.createSharedResources(chatId);
    
    // Notify the sender
    await this.createNotification(friendship.user_id, {
      type: 'request_accepted',
      title: 'Friend Request Accepted! 🎉',
      message: 'Your friend request was accepted!',
      related_user_id: userId,
      related_chat_id: chatId,
      payload: { friendship_id: data.id }
    });
    
    // Check for first friend achievement
    await this.checkFirstFriendAchievement(userId);
    await this.checkFirstFriendAchievement(friendship.user_id);
    
    return { friendship: data, chatId };
  },

  /**
   * Decline friend request
   */
  async declineFriendRequest(userId, friendshipId) {
    const { data: friendship, error: fetchError } = await supabase
      .from('friendships')
      .select('*')
      .eq('id', friendshipId)
      .single();
    
    if (fetchError) throw fetchError;
    
    if (friendship.friend_id !== userId) {
      throw new Error('Not authorized to decline this request');
    }
    
    const { error } = await supabase
      .from('friendships')
      .update({ status: 'declined' })
      .eq('id', friendshipId);
    
    if (error) throw error;
    return { success: true };
  },

  /**
   * Block a user
   */
  async blockUser(userId, blockedUserId) {
    // Update or create friendship as blocked
    const { error } = await supabase
      .from('friendships')
      .upsert({
        user_id: userId,
        friend_id: blockedUserId,
        status: 'blocked'
      }, { onConflict: 'user_id,friend_id' });
    
    if (error) throw error;
    return { success: true };
  },

  /**
   * Remove friend
   */
  async removeFriend(userId, friendId) {
    // Delete both friendship records
    await supabase
      .from('friendships')
      .delete()
      .or(`and(user_id.eq.${userId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${userId})`);
    
    return { success: true };
  },

  /**
   * Get friendship status between two users
   */
  async getFriendshipStatus(userId1, userId2) {
    const { data } = await supabase
      .from('friendships')
      .select('*')
      .or(`and(user_id.eq.${userId1},friend_id.eq.${userId2}),and(user_id.eq.${userId2},friend_id.eq.${userId1})`)
      .limit(1)
      .single();
    
    return data;
  },

  /**
   * Get all friends
   */
  async getFriends(userId) {
    const { data, error } = await supabase
      .from('friendships')
      .select(`
        *,
        friend:user_profiles!friendships_friend_id_fkey(
          id, username, fullname, country, profile_photo, 
          status_message, performance_tier, is_online, last_seen
        )
      `)
      .eq('user_id', userId)
      .eq('status', 'accepted');
    
    if (error) throw error;
    return data || [];
  },

  /**
   * Get pending friend requests (received)
   */
  async getPendingRequests(userId) {
    const { data, error } = await supabase
      .from('friendships')
      .select(`
        *,
        sender:user_profiles!friendships_user_id_fkey(
          id, username, fullname, country, profile_photo, 
          status_message, performance_tier
        )
      `)
      .eq('friend_id', userId)
      .eq('status', 'pending');
    
    if (error) throw error;
    return data || [];
  },

  /**
   * Get sent friend requests
   */
  async getSentRequests(userId) {
    const { data, error } = await supabase
      .from('friendships')
      .select(`
        *,
        receiver:user_profiles!friendships_friend_id_fkey(
          id, username, fullname, country, profile_photo
        )
      `)
      .eq('user_id', userId)
      .eq('status', 'pending');
    
    if (error) throw error;
    return data || [];
  },

  // =============================================
  // FRIEND RECOMMENDATIONS
  // =============================================

  /**
   * Get friend recommendations
   */
  async getRecommendations(userId, limit = 10) {
    const currentUser = await this.getProfileById(userId);
    if (!currentUser) return [];
    
    // Get current friends
    const friends = await this.getFriends(userId);
    const friendIds = friends.map(f => f.friend_id);
    friendIds.push(userId); // Exclude self
    
    // Find users with similar attributes
    let query = supabase
      .from('user_profiles')
      .select('id, username, fullname, country, profile_photo, status_message, performance_tier, is_online')
      .not('id', 'in', `(${friendIds.join(',')})`)
      .neq('privacy_mode', 'private')
      .eq('allow_friend_requests', true)
      .limit(limit * 3); // Get more to sort
    
    const { data, error } = await query;
    if (error) throw error;
    
    // Score and sort recommendations
    const scored = (data || []).map(user => {
      let score = 0;
      
      // Same country +3
      if (user.country === currentUser.country) score += 3;
      
      // Same performance tier +2
      if (user.performance_tier === currentUser.performance_tier) score += 2;
      
      // Online bonus +1
      if (user.is_online) score += 1;
      
      return { ...user, score };
    });
    
    // Sort by score and return top matches
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  },

  // =============================================
  // HELPER FUNCTIONS
  // =============================================

  async getOrCreateChat(user1Id, user2Id) {
    // Ensure consistent ordering
    const [smallerId, largerId] = user1Id < user2Id 
      ? [user1Id, user2Id] 
      : [user2Id, user1Id];
    
    // Check for existing chat
    const { data: existing } = await supabase
      .from('friend_chats')
      .select('id')
      .eq('user1_id', smallerId)
      .eq('user2_id', largerId)
      .single();
    
    if (existing) return existing.id;
    
    // Create new chat
    const { data, error } = await supabase
      .from('friend_chats')
      .insert({
        user1_id: smallerId,
        user2_id: largerId
      })
      .select('id')
      .single();
    
    if (error) throw error;
    return data.id;
  },

  async createSharedResources(chatId) {
    // Create shared notes
    await supabase
      .from('shared_notes')
      .insert({
        chat_id: chatId,
        title: 'Our Trading Notes',
        content: '# Welcome! 📝\n\nThis is your shared notes space. Both of you can edit this!\n\n## Ideas\n- \n\n## Strategies\n- '
      });
    
    // Create shared watchlist
    await supabase
      .from('shared_watchlists')
      .insert({
        chat_id: chatId,
        name: 'Our Watchlist',
        symbols: []
      });
  },

  async createNotification(userId, notificationData) {
    const { error } = await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        ...notificationData
      });
    
    if (error) console.error('Failed to create notification:', error);
  },

  async checkFirstFriendAchievement(userId) {
    const friends = await this.getFriends(userId);
    if (friends.length === 1) {
      // First friend!
      await supabase
        .from('achievements')
        .insert({
          user_id: userId,
          achievement_type: 'first_friend',
          achievement_name: 'First Friend',
          achievement_icon: '🤝',
          description: 'Made your first friend on TraderMind'
        })
        .onConflict('user_id,achievement_type')
        .ignore();
      
      await this.createNotification(userId, {
        type: 'achievement',
        title: 'Achievement Unlocked! 🏆',
        message: 'You earned "First Friend" - Made your first friend!',
        payload: { achievement: 'first_friend' }
      });
    }
  },

  /**
   * Set mentor status
   */
  async setMentorStatus(userId, friendId, isMentor) {
    const { error } = await supabase
      .from('friendships')
      .update({ is_mentor: isMentor })
      .eq('user_id', userId)
      .eq('friend_id', friendId);
    
    if (error) throw error;
    
    if (isMentor) {
      // Award mentor achievement
      await supabase
        .from('achievements')
        .insert({
          user_id: friendId,
          achievement_type: 'mentor',
          achievement_name: 'Mentor',
          achievement_icon: '🎓',
          description: 'Became a mentor to a friend'
        })
        .onConflict('user_id,achievement_type')
        .ignore();
    }
    
    return { success: true };
  }
};

module.exports = FriendsService;
