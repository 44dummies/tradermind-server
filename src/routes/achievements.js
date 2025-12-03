/**
 * Achievements API Routes
 */

const express = require('express');
const router = express.Router();
const AchievementsService = require('../services/achievements');
const FriendsService = require('../services/friends');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

/**
 * GET /api/achievements
 * Get current user's achievements
 */
router.get('/', async (req, res) => {
  try {
    const currentUser = await FriendsService.getProfileByDerivId(req.user.derivId);
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

/**
 * GET /api/achievements/user/:userId
 * Get another user's achievements
 */
router.get('/user/:userId', async (req, res) => {
  try {
    const achievements = await AchievementsService.getUserAchievements(req.params.userId);
    res.json(achievements);
  } catch (error) {
    console.error('Get user achievements error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/achievements/definitions
 * Get all achievement definitions
 */
router.get('/definitions', async (req, res) => {
  try {
    const definitions = await AchievementsService.getAchievementDefinitions();
    res.json(definitions);
  } catch (error) {
    console.error('Get achievement definitions error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/achievements/progress
 * Get achievement progress for current user
 */
router.get('/progress', async (req, res) => {
  try {
    const currentUser = await FriendsService.getProfileByDerivId(req.user.derivId);
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
