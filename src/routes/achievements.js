

const express = require('express');
const router = express.Router();
const AchievementsService = require('../services/achievements');
const { getProfileByDerivId, upsertUserProfile } = require('../services/profile');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const currentUser = await getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const achievements = await AchievementsService.getUserAchievements(currentUser.id);
    res.json(achievements);
  } catch (error) {
    console.error('Get achievements error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/user/:userId', async (req, res) => {
  try {
    let userId = req.params.userId;
    
    
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      const user = await getProfileByDerivId(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      userId = user.id;
    }
    
    const achievements = await AchievementsService.getUserAchievements(userId);
    res.json(achievements);
  } catch (error) {
    console.error('Get user achievements error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/definitions', async (req, res) => {
  try {
    const definitions = await AchievementsService.getAchievementDefinitions();
    res.json(definitions);
  } catch (error) {
    console.error('Get achievement definitions error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/progress', async (req, res) => {
  try {
    const currentUser = await getProfileByDerivId(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const progress = await AchievementsService.getProgress(currentUser.id);
    res.json(progress);
  } catch (error) {
    console.error('Get achievement progress error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
