/**
 * Mentor Service - Mentorship mode between friends
 * Handles mentor relationships, feedback, and analytics
 */

const { supabase } = require('../db/supabase');

const MentorService = {
  /**
   * Set a friend as mentor
   */
  async setMentor(userId, mentorId, chatId) {
    // Update friendship
    await supabase
      .from('friendships')
      .update({ is_mentor: true })
      .eq('user_id', userId)
      .eq('friend_id', mentorId);
    
    // Award mentor achievement
    await supabase
      .from('achievements')
      .upsert({
        user_id: mentorId,
        achievement_type: 'mentor',
        achievement_name: 'Mentor',
        achievement_icon: '🎓',
        description: 'Became a mentor to a friend'
      }, { onConflict: 'user_id,achievement_type' });
    
    // Notify mentor
    await supabase
      .from('notifications')
      .insert({
        user_id: mentorId,
        type: 'mentorship',
        title: '🎓 You\'re Now a Mentor!',
        message: 'A friend has selected you as their mentor. Guide them well!',
        related_user_id: userId,
        related_chat_id: chatId
      });
    
    return { success: true };
  },

  /**
   * Remove mentor status
   */
  async removeMentor(userId, mentorId) {
    await supabase
      .from('friendships')
      .update({ is_mentor: false })
      .eq('user_id', userId)
      .eq('friend_id', mentorId);
    
    return { success: true };
  },

  /**
   * Get mentees for a mentor
   */
  async getMentees(mentorId) {
    const { data, error } = await supabase
      .from('friendships')
      .select(`
        *,
        mentee:user_profiles!friendships_user_id_fkey(
          id, username, fullname, profile_photo, 
          win_rate, total_trades, discipline_score, performance_tier
        )
      `)
      .eq('friend_id', mentorId)
      .eq('is_mentor', true)
      .eq('status', 'accepted');
    
    if (error) throw error;
    return data || [];
  },

  /**
   * Get mentor for a user
   */
  async getMentor(userId) {
    const { data, error } = await supabase
      .from('friendships')
      .select(`
        *,
        mentor:user_profiles!friendships_friend_id_fkey(
          id, username, fullname, profile_photo, 
          win_rate, total_trades, discipline_score, performance_tier
        )
      `)
      .eq('user_id', userId)
      .eq('is_mentor', true)
      .eq('status', 'accepted')
      .limit(1)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  /**
   * Submit weekly feedback
   */
  async submitFeedback(mentorId, menteeId, chatId, feedbackData) {
    const {
      feedback_text,
      rating,
      areas_of_improvement = [],
      goals_for_next_week = []
    } = feedbackData;
    
    // Calculate week number
    const weekNumber = this.getWeekNumber(new Date());
    
    const { data, error } = await supabase
      .from('mentor_feedback')
      .insert({
        mentor_id: mentorId,
        mentee_id: menteeId,
        chat_id: chatId,
        week_number: weekNumber,
        feedback_text,
        rating,
        areas_of_improvement,
        goals_for_next_week
      })
      .select()
      .single();
    
    if (error) throw error;
    
    // Notify mentee
    await supabase
      .from('notifications')
      .insert({
        user_id: menteeId,
        type: 'mentor_feedback',
        title: '📝 Mentor Feedback',
        message: 'Your mentor has submitted weekly feedback!',
        related_user_id: mentorId,
        related_chat_id: chatId,
        payload: { feedback_id: data.id }
      });
    
    return data;
  },

  /**
   * Get feedback history
   */
  async getFeedbackHistory(menteeId, mentorId = null) {
    let query = supabase
      .from('mentor_feedback')
      .select(`
        *,
        mentor:user_profiles!mentor_feedback_mentor_id_fkey(
          id, username, fullname, profile_photo
        )
      `)
      .eq('mentee_id', menteeId)
      .order('created_at', { ascending: false });
    
    if (mentorId) {
      query = query.eq('mentor_id', mentorId);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  /**
   * Get mentee analytics (for mentor view)
   */
  async getMenteeAnalytics(menteeId, weeks = 4) {
    const mentee = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', menteeId)
      .single();
    
    const feedback = await this.getFeedbackHistory(menteeId);
    
    // Calculate progress
    const recentFeedback = feedback.slice(0, weeks);
    const avgRating = recentFeedback.length > 0 
      ? recentFeedback.reduce((sum, f) => sum + (f.rating || 0), 0) / recentFeedback.length
      : 0;
    
    return {
      profile: mentee.data,
      feedback_count: feedback.length,
      avg_rating: avgRating,
      recent_feedback: recentFeedback,
      areas_focus: this.aggregateAreas(recentFeedback),
      goals: this.aggregateGoals(recentFeedback)
    };
  },

  /**
   * Helper: Get week number of the year
   */
  getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  },

  /**
   * Helper: Aggregate improvement areas
   */
  aggregateAreas(feedback) {
    const areas = {};
    for (const f of feedback) {
      for (const area of (f.areas_of_improvement || [])) {
        areas[area] = (areas[area] || 0) + 1;
      }
    }
    return Object.entries(areas)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([area, count]) => ({ area, count }));
  },

  /**
   * Helper: Aggregate goals
   */
  aggregateGoals(feedback) {
    const goals = [];
    for (const f of feedback) {
      for (const goal of (f.goals_for_next_week || [])) {
        goals.push({
          goal,
          week: f.week_number,
          from: f.mentor?.username
        });
      }
    }
    return goals.slice(0, 10);
  }
};

module.exports = MentorService;
