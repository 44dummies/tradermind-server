

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
const tierChatroomService = require('../services/tierChatroom');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

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
    res.json(result);
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

router.post('/posts/:id/vote', authMiddleware, async (req, res) => {
  try {
    const { value } = req.body; 
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

router.get('/tier-chatrooms', async (req, res) => {
  try {
    const chatrooms = await tierChatroomService.getTierChatrooms();
    res.json({ success: true, chatrooms });
  } catch (error) {
    console.error('Error fetching chatrooms:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch chatrooms' });
  }
});

router.get('/my-tier-chatroom', authMiddleware, async (req, res) => {
  try {
    const assignment = await tierChatroomService.getUserTierChatroom(req.userId);
    res.json({ success: true, assignment });
  } catch (error) {
    console.error('Error fetching user chatroom:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch chatroom' });
  }
});

router.post('/assign-tier', authMiddleware, async (req, res) => {
  try {
    const { winRate = 0, totalTrades = 0 } = req.body;
    
    const result = await tierChatroomService.assignUserToTierChatroom(
      req.userId,
      req.user?.derivId || req.userId,
      winRate,
      totalTrades
    );
    
    if (!result) {
      return res.status(500).json({ success: false, error: 'Failed to assign chatroom' });
    }
    
    res.json({ 
      success: true, 
      chatroom: result.chatroom,
      tier: result.tier,
      message: `You've been assigned to ${result.chatroom.name}` 
    });
  } catch (error) {
    console.error('Error assigning user:', error);
    res.status(500).json({ success: false, error: 'Failed to assign chatroom' });
  }
});

router.get('/tier-chatroom/:id/members', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 50 } = req.query;
    
    const members = await tierChatroomService.getChatroomMembers(id, parseInt(limit));
    res.json({ success: true, members });
  } catch (error) {
    console.error('Error fetching members:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch members' });
  }
});

router.get('/tier-chatroom/:id/messages', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 50, before } = req.query;
    
    const messages = await tierChatroomService.getChatroomMessages(id, parseInt(limit), before);
    res.json({ success: true, messages });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch messages' });
  }
});

router.post('/tier-chatroom/:id/message', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { text, type, fileName, fileType, fileSize, fileHash, fileUrl, replyToId } = req.body;
    
    if (!text && type === 'text') {
      return res.status(400).json({ success: false, error: 'Message text is required' });
    }
    
    const result = await tierChatroomService.sendMessage(id, req.userId, {
      text,
      type,
      fileName,
      fileType,
      fileSize,
      fileHash,
      fileUrl, 
      replyToId
    });
    
    res.json(result);
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ success: false, error: 'Failed to send message' });
  }
});

router.post('/tier-message/:id/reaction', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { emoji } = req.body;
    
    if (!emoji) {
      return res.status(400).json({ success: false, error: 'Emoji is required' });
    }
    
    const result = await tierChatroomService.addReaction(id, req.userId, emoji);
    res.json(result);
  } catch (error) {
    console.error('Error adding reaction:', error);
    res.status(500).json({ success: false, error: 'Failed to add reaction' });
  }
});

router.delete('/tier-message/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await tierChatroomService.deleteMessage(id, req.userId, req.user?.isAdmin);
    res.json(result);
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ success: false, error: 'Failed to delete message' });
  }
});

router.post('/tier-chatroom/:id/typing', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { isTyping } = req.body;
    
    await tierChatroomService.setTyping(id, req.userId, isTyping);
    res.json({ success: true });
  } catch (error) {
    console.error('Error setting typing:', error);
    res.status(500).json({ success: false, error: 'Failed to set typing' });
  }
});

module.exports = router;
