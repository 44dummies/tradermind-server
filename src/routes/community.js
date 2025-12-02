/**
 * Community Routes
 */

const express = require('express');
const {
  createPost,
  getFeed,
  getPost,
  votePost,
  addComment,
  deletePost,
  deleteComment,
  getUserPosts,
  getTrendingTags,
  searchPosts
} = require('../services/community');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

/**
 * Get community feed
 * GET /api/community/feed
 */
router.get('/feed', authMiddleware, async (req, res) => {
  try {
    const { page, limit, category, sortBy, timeRange } = req.query;
    const feed = await getFeed({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      category,
      sortBy,
      timeRange,
      userId: req.userId
    });
    res.json(feed);
  } catch (error) {
    console.error('Get feed error:', error);
    res.status(500).json({ error: 'Failed to get feed' });
  }
});

/**
 * Create new post
 * POST /api/community/posts
 */
router.post('/posts', authMiddleware, async (req, res) => {
  try {
    const result = await createPost(req.userId, req.body);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.status(201).json(result.post);
  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

/**
 * Get single post
 * GET /api/community/posts/:id
 */
router.get('/posts/:id', authMiddleware, async (req, res) => {
  try {
    const post = await getPost(req.params.id, req.userId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    res.json(post);
  } catch (error) {
    console.error('Get post error:', error);
    res.status(500).json({ error: 'Failed to get post' });
  }
});

/**
 * Delete post
 * DELETE /api/community/posts/:id
 */
router.delete('/posts/:id', authMiddleware, async (req, res) => {
  try {
    const result = await deletePost(req.userId, req.params.id);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json(result);
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

/**
 * Vote on a post
 * POST /api/community/posts/:id/vote
 */
router.post('/posts/:id/vote', authMiddleware, async (req, res) => {
  try {
    const { value } = req.body; // 1 for upvote, -1 for downvote, 0 to remove
    const result = await votePost(req.userId, req.params.id, value);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json(result);
  } catch (error) {
    console.error('Vote error:', error);
    res.status(500).json({ error: 'Failed to vote' });
  }
});

/**
 * Add comment to post
 * POST /api/community/posts/:id/comments
 */
router.post('/posts/:id/comments', authMiddleware, async (req, res) => {
  try {
    const { content } = req.body;
    const result = await addComment(req.userId, req.params.id, content);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.status(201).json(result.comment);
  } catch (error) {
    console.error('Add comment error:', error);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

/**
 * Delete comment
 * DELETE /api/community/comments/:id
 */
router.delete('/comments/:id', authMiddleware, async (req, res) => {
  try {
    const result = await deleteComment(req.userId, req.params.id);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json(result);
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

/**
 * Get user's posts
 * GET /api/community/users/:username/posts
 */
router.get('/users/:username/posts', authMiddleware, async (req, res) => {
  try {
    const { page, limit } = req.query;
    const result = await getUserPosts(
      req.params.username,
      parseInt(page) || 1,
      parseInt(limit) || 20
    );
    res.json(result);
  } catch (error) {
    console.error('Get user posts error:', error);
    res.status(500).json({ error: 'Failed to get posts' });
  }
});

/**
 * Get trending tags
 * GET /api/community/tags/trending
 */
router.get('/tags/trending', authMiddleware, async (req, res) => {
  try {
    const { limit } = req.query;
    const tags = await getTrendingTags(parseInt(limit) || 10);
    res.json(tags);
  } catch (error) {
    console.error('Get trending tags error:', error);
    res.status(500).json({ error: 'Failed to get tags' });
  }
});

/**
 * Search posts
 * GET /api/community/search
 */
router.get('/search', authMiddleware, async (req, res) => {
  try {
    const { q, page, limit, category } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    const result = await searchPosts(q, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      category
    });
    res.json(result);
  } catch (error) {
    console.error('Search posts error:', error);
    res.status(500).json({ error: 'Failed to search posts' });
  }
});

module.exports = router;
