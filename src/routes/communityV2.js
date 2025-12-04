

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

let io = null;
router.setIo = (socketIo) => {
  io = socketIo;
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, 
  fileFilter: (req, file, cb) => {
    if (file.mimetype.match(/^image\/(jpeg|png|webp)$/)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG, and WebP images allowed'));
    }
  }
});

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

router.post('/posts', authMiddleware, async (req, res) => {
  try {
    const result = await createPost(req.userId, req.body);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    
    if (io) {
      io.emit('community:post:new', result.post);
    }

    res.status(201).json(result.post);
  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

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

router.delete('/posts/:id', authMiddleware, async (req, res) => {
  try {
    const result = await deletePost(req.userId, req.params.id);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    
    if (io) {
      io.emit('community:post:delete', { postId: req.params.id });
    }

    res.json(result);
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

router.post('/posts/:id/like', authMiddleware, async (req, res) => {
  try {
    const { liked } = req.body;
    const result = await likePost(req.userId, req.params.id, liked !== false);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    
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

router.post('/posts/:id/comments', authMiddleware, async (req, res) => {
  try {
    const { content } = req.body;
    const result = await addComment(req.userId, req.params.id, content);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    
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
