

const express = require('express');
const router = express.Router();
const LeaderboardService = require('../services/leaderboard');
const { getProfileByDerivId, upsertUserProfile } = require('../services/profile');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const currentUser = await getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const { category = 'win_rate' } = req.query;
    const leaderboard = await LeaderboardService.getFriendLeaderboard(currentUser.id, category);
    res.json(leaderboard);
  } catch (error) {
    console.error('Get leaderboard error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/improvement', async (req, res) => {
  try {
    const currentUser = await getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const leaderboard = await LeaderboardService.getImprovementLeaderboard(currentUser.id);
    res.json(leaderboard);
  } catch (error) {
    console.error('Get improvement leaderboard error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/consistency', async (req, res) => {
  try {
    const currentUser = await getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const leaderboard = await LeaderboardService.getConsistencyLeaderboard(currentUser.id);
    res.json(leaderboard);
  } catch (error) {
    console.error('Get consistency leaderboard error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/helpfulness', async (req, res) => {
  try {
    const currentUser = await getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const leaderboard = await LeaderboardService.getHelpfulnessLeaderboard(currentUser.id);
    res.json(leaderboard);
  } catch (error) {
    console.error('Get helpfulness leaderboard error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/streaks', async (req, res) => {
  try {
    const currentUser = await getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const leaderboard = await LeaderboardService.getStreakLeaderboard(currentUser.id);
    res.json(leaderboard);
  } catch (error) {
    console.error('Get streak leaderboard error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
