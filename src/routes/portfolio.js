/**
 * Portfolio API Routes
 * Handles user portfolio items
 */

const express = require('express');
const router = express.Router();
const PortfolioService = require('../services/portfolio');
const { getProfileByDerivId, upsertUserProfile } = require('../services/profile');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

/**
 * Helper to get or create user profile
 */
async function getOrCreateUser(derivId) {
  let user = await getProfileByDerivId(derivId);
  if (!user) {
    user = await upsertUserProfile(derivId, {
      username: `trader_${derivId.toLowerCase().slice(0, 8)}`,
      fullname: null,
      email: null,
      country: null
    });
  }
  return user;
}

/**
 * GET /api/portfolio
 * Get current user's portfolio
 */
router.get('/', async (req, res) => {
  try {
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const items = await PortfolioService.getUserPortfolio(currentUser.id, currentUser.id);
    res.json(items);
  } catch (error) {
    console.error('Get portfolio error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/portfolio/user/:userId
 * Get another user's portfolio
 */
router.get('/user/:userId', async (req, res) => {
  try {
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const items = await PortfolioService.getUserPortfolio(req.params.userId, currentUser.id);
    res.json(items);
  } catch (error) {
    console.error('Get user portfolio error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/portfolio
 * Add portfolio item (metadata only)
 */
router.post('/', async (req, res) => {
  try {
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const item = await PortfolioService.addItem(currentUser.id, req.body);
    
    res.json(item);
  } catch (error) {
    console.error('Add portfolio item error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/portfolio/:itemId
 * Update portfolio item
 */
router.put('/:itemId', async (req, res) => {
  try {
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const item = await PortfolioService.updateItem(req.params.itemId, currentUser.id, req.body);
    res.json(item);
  } catch (error) {
    console.error('Update portfolio item error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/portfolio/:itemId
 * Delete portfolio item
 */
router.delete('/:itemId', async (req, res) => {
  try {
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const result = await PortfolioService.deleteItem(req.params.itemId, currentUser.id);
    res.json(result);
  } catch (error) {
    console.error('Delete portfolio item error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/portfolio/:itemId/like
 * Like a portfolio item
 */
router.post('/:itemId/like', async (req, res) => {
  try {
    const result = await PortfolioService.toggleLike(req.params.itemId, req.user.id);
    res.json(result);
  } catch (error) {
    console.error('Like portfolio item error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/portfolio/:itemId/view
 * Increment view count
 */
router.post('/:itemId/view', async (req, res) => {
  try {
    await PortfolioService.incrementViews(req.params.itemId);
    res.json({ success: true });
  } catch (error) {
    console.error('View portfolio item error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
