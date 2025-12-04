/**
 * Community Routes v2
 * Real-time community with WebSocket event emission
 */

const express = require('express');
const multer = require('multer');
const {
  createPost,
  getFeed,
  getPost,
  deletePost,
  likePost,
  getComments,
  addComment,
  deleteComment,
  getOnlineUsers,
  uploadPostImage
} = require('../services/communityV2');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Store io reference for WebSocket emissions
let io = null;
router.setIo = (socketIo) => {
  io = socketIo;
};

// Configure multer for image uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.match(/^image\/(jpeg|png|webp)$/)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG, and WebP images allowed'));
    }
  }
});

/**
 * Get community feed
 * GET /api/community/feed
 */
router.get('/feed', authMiddleware, async (req, res) => {
  try {
    const { page, limit, category, sortBy } = req.query;
    const feed = await getFeed({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      category,
      sortBy,
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

    // Emit WebSocket event
    if (io) {
      io.emit('community:post:new', result.post);
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

    // Emit WebSocket event
    if (io) {
      io.emit('community:post:delete', { postId: req.params.id });
    }

    res.json(result);
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

/**
 * Like/unlike post
 * POST /api/community/posts/:id/like
 */
router.post('/posts/:id/like', authMiddleware, async (req, res) => {
  try {
    const { liked } = req.body;
    const result = await likePost(req.userId, req.params.id, liked !== false);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Emit WebSocket event
    if (io) {
      io.emit('community:post:like', {
        postId: req.params.id,
        likeCount: result.likeCount,
        liked: result.liked,
        userId: req.userId
      });
    }

    res.json(result);
  } catch (error) {
    console.error('Like error:', error);
    res.status(500).json({ error: 'Failed to like post' });
  }
});

/**
 * Get post comments
 * GET /api/community/posts/:id/comments
 */
router.get('/posts/:id/comments', authMiddleware, async (req, res) => {
  try {
    const { page, limit } = req.query;
    const result = await getComments(req.params.id, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50
    });
    res.json(result);
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({ error: 'Failed to get comments' });
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

    // Emit WebSocket event
    if (io) {
      io.emit('community:post:comment', {
        postId: req.params.id,
        comment: result.comment,
        commentCount: result.commentCount
      });
    }

    res.status(201).json(result);
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
 * Get online users
 * GET /api/community/online-users
 */
router.get('/online-users', authMiddleware, async (req, res) => {
  try {
    const { limit } = req.query;
    const users = await getOnlineUsers(parseInt(limit) || 50);
    res.json({ users });
  } catch (error) {
    console.error('Get online users error:', error);
    res.status(500).json({ error: 'Failed to get online users' });
  }
});

/**
 * Upload post image
 * POST /api/community/upload-image
 */
router.post('/upload-image', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const result = await uploadPostImage(req.userId, req.file);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ url: result.url });
  } catch (error) {
    console.error('Upload image error:', error);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

module.exports = router;
