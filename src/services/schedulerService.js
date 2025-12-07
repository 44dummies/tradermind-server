const botManager = require('./botManager');

class SchedulerService {
  constructor() {
    this.interval = null;
  }

  start() {
    console.log('[SchedulerService] Starting scheduler...');
    // Run every minute
    this.interval = setInterval(() => this.checkAutoStop(), 60000);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async checkAutoStop() {
    const state = botManager.getState();
    
    if (!state.isRunning || !state.activeSessionId || !state.sessionDuration) {
      return;
    }

    const elapsedMinutes = (Date.now() - state.startTime) / 60000;
    
    if (elapsedMinutes >= state.sessionDuration) {
      console.log(`[SchedulerService] ⏰ Session ${state.activeSessionId} duration exceeded (${state.sessionDuration}m). Stopping bot.`);
      try {
        await botManager.stopBot();
      } catch (error) {
        console.error('[SchedulerService] Failed to auto-stop bot:', error);
      }
    }
  }
}

module.exports = new SchedulerService();
