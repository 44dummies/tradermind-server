/**
 * Cron Jobs - Scheduled tasks
 * Auto-delete messages, streak management, anniversary checks
 */

const { supabase } = require('../db/supabase');
const NotificationsService = require('../services/notifications');
const AchievementsService = require('../services/achievements');

// Simple in-memory scheduler (for production, use node-cron or Bull)
class CronScheduler {
  constructor() {
    this.jobs = [];
  }

  schedule(name, intervalMs, handler) {
    const job = {
      name,
      interval: setInterval(async () => {
        try {
          console.log(`[Cron] Running: ${name}`);
          await handler();
          console.log(`[Cron] Completed: ${name}`);
        } catch (error) {
          console.error(`[Cron] Error in ${name}:`, error);
        }
      }, intervalMs),
      handler
    };
    this.jobs.push(job);
    console.log(`[Cron] Scheduled: ${name} (every ${intervalMs / 1000}s)`);
  }

  // Run a job immediately
  async runNow(name) {
    const job = this.jobs.find(j => j.name === name);
    if (job) {
      await job.handler();
    }
  }

  stopAll() {
    this.jobs.forEach(job => clearInterval(job.interval));
    this.jobs = [];
  }
}

const scheduler = new CronScheduler();

// =============================================
// JOB: Auto-delete expired messages
// Runs every hour
// =============================================
async function cleanupExpiredMessages() {
  const { error, count } = await supabase
    .from('friend_messages')
    .delete()
    .lt('expires_at', new Date().toISOString())
    .not('expires_at', 'is', null);
  
  if (error) {
    console.error('[Cron] Message cleanup error:', error);
    return;
  }
  
  if (count > 0) {
    console.log(`[Cron] Deleted ${count} expired messages`);
  }
}

// =============================================
// JOB: Update broken streaks
// Runs at midnight (check every 6 hours)
// =============================================
async function checkBrokenStreaks() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  
  // Find chats with streaks that weren't updated yesterday
  const { data: brokenStreaks, error } = await supabase
    .from('friend_chats')
    .select('id, streak_count, user1_id, user2_id')
    .gt('streak_count', 0)
    .lt('streak_last_date', yesterdayStr);
  
  if (error) {
    console.error('[Cron] Streak check error:', error);
    return;
  }
  
  for (const chat of (brokenStreaks || [])) {
    // Reset streak
    await supabase
      .from('friend_chats')
      .update({
        streak_count: 0,
        streak_badge: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', chat.id);
    
    // Notify both users
    for (const userId of [chat.user1_id, chat.user2_id]) {
      await NotificationsService.create(userId, {
        type: 'streak_broken',
        title: '💔 Streak Broken',
        message: `Your ${chat.streak_count}-day streak was broken. Start a new one!`,
        related_chat_id: chat.id,
        payload: { streak_count: chat.streak_count }
      });
    }
    
    console.log(`[Cron] Reset broken streak for chat ${chat.id} (was ${chat.streak_count} days)`);
  }
}

// =============================================
// JOB: Check friend anniversaries
// Runs daily
// =============================================
async function checkAnniversaries() {
  await NotificationsService.checkAnniversaries();
}

// =============================================
// JOB: Check and award achievements
// Runs every 4 hours
// =============================================
async function checkAchievements() {
  // Get all users
  const { data: users } = await supabase
    .from('user_profiles')
    .select('id');
  
  for (const user of (users || [])) {
    try {
      await AchievementsService.checkSocialAchievements(user.id);
    } catch (error) {
      console.error(`[Cron] Achievement check error for ${user.id}:`, error);
    }
  }
}

// =============================================
// JOB: Cleanup old notifications
// Runs daily
// =============================================
async function cleanupOldNotifications() {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 30);
  
  const { error, count } = await supabase
    .from('notifications')
    .delete()
    .lt('created_at', cutoffDate.toISOString())
    .eq('is_read', true);
  
  if (error) {
    console.error('[Cron] Notification cleanup error:', error);
    return;
  }
  
  if (count > 0) {
    console.log(`[Cron] Deleted ${count} old notifications`);
  }
}

// =============================================
// JOB: Cleanup typing indicators
// Runs every minute
// =============================================
async function cleanupTypingIndicators() {
  const cutoff = new Date(Date.now() - 30000).toISOString(); // 30 seconds
  
  await supabase
    .from('typing_indicators')
    .delete()
    .lt('started_at', cutoff);
}

// =============================================
// Start all cron jobs
// =============================================
function startCronJobs() {
  console.log('[Cron] Starting scheduled jobs...');
  
  // Typing cleanup - every minute
  scheduler.schedule('cleanup-typing', 60 * 1000, cleanupTypingIndicators);
  
  // Message cleanup - every hour
  scheduler.schedule('cleanup-messages', 60 * 60 * 1000, cleanupExpiredMessages);
  
  // Streak check - every 6 hours
  scheduler.schedule('check-streaks', 6 * 60 * 60 * 1000, checkBrokenStreaks);
  
  // Anniversary check - every 24 hours
  scheduler.schedule('check-anniversaries', 24 * 60 * 60 * 1000, checkAnniversaries);
  
  // Achievement check - every 4 hours
  scheduler.schedule('check-achievements', 4 * 60 * 60 * 1000, checkAchievements);
  
  // Notification cleanup - every 24 hours
  scheduler.schedule('cleanup-notifications', 24 * 60 * 60 * 1000, cleanupOldNotifications);
  
  console.log('[Cron] All jobs scheduled');
  
  // Run initial checks after 10 seconds
  setTimeout(async () => {
    console.log('[Cron] Running initial checks...');
    await cleanupTypingIndicators();
    await cleanupExpiredMessages();
  }, 10000);
}

function stopCronJobs() {
  scheduler.stopAll();
  console.log('[Cron] All jobs stopped');
}

module.exports = { startCronJobs, stopCronJobs, scheduler };
