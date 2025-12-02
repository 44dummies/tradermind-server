/**
 * Leaderboard Service - Friend-only leaderboards
 * Compares stats only among friends
 */

const { supabase } = require('../db/supabase');

const LeaderboardService = {
  /**
   * Get friend leaderboard
   */
  async getFriendLeaderboard(userId, category = 'win_rate') {
    // Get user's friends
    const { data: friendships } = await supabase
      .from('friendships')
      .select('friend_id')
      .eq('user_id', userId)
      .eq('status', 'accepted');
    
    const friendIds = (friendships || []).map(f => f.friend_id);
    friendIds.push(userId); // Include self
    
    if (friendIds.length === 0) {
      return [];
    }
    
    // Get profiles with stats
    const { data: profiles, error } = await supabase
      .from('user_profiles')
      .select('id, username, fullname, profile_photo, win_rate, total_trades, discipline_score, helpfulness_score')
      .in('id', friendIds);
    
    if (error) throw error;
    
    // Sort by category
    const sortKey = {
      'win_rate': 'win_rate',
      'trades': 'total_trades',
      'discipline': 'discipline_score',
      'helpfulness': 'helpfulness_score'
    }[category] || 'win_rate';
    
    profiles.sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0));
    
    // Add rank
    return profiles.map((profile, index) => ({
      rank: index + 1,
      ...profile,
      isCurrentUser: profile.id === userId
    }));
  },

  /**
   * Get improvement trends leaderboard
   * Compares week-over-week improvement
   */
  async getImprovementLeaderboard(userId) {
    // This would require historical data
    // Simplified version comparing current stats
    const leaderboard = await this.getFriendLeaderboard(userId, 'win_rate');
    
    // Add mock improvement data (in production, calculate from historical)
    return leaderboard.map(entry => ({
      ...entry,
      improvement: Math.random() * 10 - 2 // -2% to +8%
    })).sort((a, b) => b.improvement - a.improvement)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
  },

  /**
   * Get consistency leaderboard
   * Based on discipline score and trading frequency
   */
  async getConsistencyLeaderboard(userId) {
    const { data: friendships } = await supabase
      .from('friendships')
      .select('friend_id')
      .eq('user_id', userId)
      .eq('status', 'accepted');
    
    const friendIds = (friendships || []).map(f => f.friend_id);
    friendIds.push(userId);
    
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('id, username, fullname, profile_photo, discipline_score, total_trades')
      .in('id', friendIds);
    
    // Calculate consistency score
    const scored = (profiles || []).map(profile => ({
      ...profile,
      consistency_score: (profile.discipline_score || 0) * 0.7 + 
                        Math.min((profile.total_trades || 0) / 100, 30)
    }));
    
    scored.sort((a, b) => b.consistency_score - a.consistency_score);
    
    return scored.map((profile, index) => ({
      rank: index + 1,
      ...profile,
      isCurrentUser: profile.id === userId
    }));
  },

  /**
   * Get helpfulness leaderboard
   * Based on reactions received
   */
  async getHelpfulnessLeaderboard(userId) {
    return this.getFriendLeaderboard(userId, 'helpfulness');
  },

  /**
   * Get streak leaderboard
   */
  async getStreakLeaderboard(userId) {
    // Get user's chats
    const { data: chats } = await supabase
      .from('friend_chats')
      .select(`
        id, streak_count, streak_badge, streak_name,
        user1:user_profiles!friend_chats_user1_id_fkey(id, username, profile_photo),
        user2:user_profiles!friend_chats_user2_id_fkey(id, username, profile_photo)
      `)
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .gt('streak_count', 0)
      .order('streak_count', { ascending: false });
    
    return (chats || []).map((chat, index) => {
      const partner = chat.user1.id === userId ? chat.user2 : chat.user1;
      return {
        rank: index + 1,
        chat_id: chat.id,
        partner,
        streak_count: chat.streak_count,
        streak_badge: chat.streak_badge,
        streak_name: chat.streak_name
      };
    });
  }
};

module.exports = LeaderboardService;
