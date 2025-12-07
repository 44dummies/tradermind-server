

const { supabase } = require('../db/supabase');

const AchievementsService = {
  
  async getUserAchievements(userId) {
    const { data, error } = await supabase
      .from('achievements')
      .select('*')
      .eq('user_id', userId)
      .order('unlocked_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  },

  
  async getAchievementDefinitions() {
    const { data, error } = await supabase
      .from('achievement_definitions')
      .select('*')
      .order('category', { ascending: true });
    
    if (error) throw error;
    return data || [];
  },

  
  async awardAchievement(userId, achievementType) {
    
    const { data: definition } = await supabase
      .from('achievement_definitions')
      .select('*')
      .eq('type', achievementType)
      .single();
    
    if (!definition) {
      throw new Error(`Unknown achievement type: ${achievementType}`);
    }
    
    
    const { data: existing } = await supabase
      .from('achievements')
      .select('id')
      .eq('user_id', userId)
      .eq('achievement_type', achievementType)
      .single();
    
    if (existing) {
      return { alreadyHas: true };
    }
    
    
    const { data, error } = await supabase
      .from('achievements')
      .insert({
        user_id: userId,
        achievement_type: achievementType,
        achievement_name: definition.name,
        achievement_icon: definition.icon,
        description: definition.description
      })
      .select()
      .single();
    
    if (error) throw error;
    
    
    await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        type: 'achievement',
        title: '🏆 Achievement Unlocked!',
        message: `You earned "${definition.name}" - ${definition.description}`,
        payload: { achievement: data }
      });
    
    return data;
  },

  
  async checkStreakAchievements(userId, streakCount) {
    const streakAchievements = {
      3: 'streak_starter',
      7: 'streak_bronze',
      14: 'streak_silver',
      30: 'streak_gold',
      90: 'streak_diamond',
      180: 'streak_aurora'
    };
    
    for (const [days, type] of Object.entries(streakAchievements)) {
      if (streakCount >= parseInt(days)) {
        await this.awardAchievement(userId, type);
      }
    }
  },

  
  async checkSocialAchievements(userId) {
    
    const { count: friendCount } = await supabase
      .from('friendships')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'accepted');
    
    if (friendCount >= 1) {
      await this.awardAchievement(userId, 'first_friend');
    }
    
    if (friendCount >= 10) {
      await this.awardAchievement(userId, 'social_butterfly');
    }
    
    
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('helpfulness_score')
      .eq('id', userId)
      .single();
    
    if (profile?.helpfulness_score >= 50) {
      await this.awardAchievement(userId, 'helpful_trader');
    }
  },

  
  async checkAnniversaryAchievements(userId, friendId, daysSinceFriendship) {
    if (daysSinceFriendship >= 30) {
      await this.awardAchievement(userId, 'one_month_friends');
      await this.awardAchievement(friendId, 'one_month_friends');
    }
    
    if (daysSinceFriendship >= 365) {
      await this.awardAchievement(userId, 'one_year_friends');
      await this.awardAchievement(friendId, 'one_year_friends');
    }
  },

  
  async getProgress(userId) {
    const definitions = await this.getAchievementDefinitions();
    const userAchievements = await this.getUserAchievements(userId);
    const unlockedTypes = new Set(userAchievements.map(a => a.achievement_type));
    
    return definitions.map(def => ({
      ...def,
      unlocked: unlockedTypes.has(def.type),
      unlocked_at: userAchievements.find(a => a.achievement_type === def.type)?.unlocked_at
    }));
  }
};

module.exports = AchievementsService;
