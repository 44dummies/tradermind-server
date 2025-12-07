

const express = require('express');
const { prisma } = require('../services/database');
const { 
  getUserChatrooms, 
  getRecommendedChatrooms,
  updateUserProfileAndReassign
} = require('../services/assignment');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  try {
    const chatrooms = await getUserChatrooms(req.userId);
    res.json(chatrooms);
  } catch (error) {
    console.error('Get chatrooms error:', error);
    res.status(500).json({ error: 'Failed to get chatrooms' });
  }
});

router.get('/recommendations', authMiddleware, async (req, res) => {
  try {
    const recommendations = await getRecommendedChatrooms(req.userId);
    res.json(recommendations);
  } catch (error) {
    console.error('Get recommendations error:', error);
    res.status(500).json({ error: 'Failed to get recommendations' });
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const chatroom = await prisma.chatroom.findUnique({
      where: { id: req.params.id },
      include: {
        _count: {
          select: { members: true }
        }
      }
    });
    
    if (!chatroom) {
      return res.status(404).json({ error: 'Chatroom not found' });
    }
    
    
    const membership = await prisma.userChatroom.findUnique({
      where: {
        userId_chatroomId: {
          userId: req.userId,
          chatroomId: req.params.id
        }
      }
    });
    
    res.json({
      ...chatroom,
      memberCount: chatroom._count.members,
      isMember: !!membership,
      fitScore: membership?.fitScore,
      isMuted: membership?.isMuted,
      canPost: membership?.canPost
    });
  } catch (error) {
    console.error('Get chatroom error:', error);
    res.status(500).json({ error: 'Failed to get chatroom' });
  }
});

router.get('/:id/messages', authMiddleware, async (req, res) => {
  try {
    const { before, limit = 50 } = req.query;
    
    
    const membership = await prisma.userChatroom.findUnique({
      where: {
        userId_chatroomId: {
          userId: req.userId,
          chatroomId: req.params.id
        }
      }
    });
    
    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this chatroom' });
    }
    
    const where = {
      chatroomId: req.params.id,
      isDeleted: false
    };
    
    if (before) {
      where.createdAt = { lt: new Date(before) };
    }
    
    const messages = await prisma.message.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true
          }
        },
        reactions: {
          include: {
            user: {
              select: {
                username: true
              }
            }
          }
        },
        readReceipts: {
          where: {
            userId: { not: req.userId }
          },
          select: {
            userId: true,
            readAt: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit)
    });
    
    
    res.json(messages.reverse());
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

router.get('/:id/members', authMiddleware, async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    
    const members = await prisma.userChatroom.findMany({
      where: {
        chatroomId: req.params.id,
        isActive: true
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
            isOnline: true,
            lastSeenAt: true
          }
        }
      },
      take: parseInt(limit)
    });
    
    res.json(members.map(m => ({
      ...m.user,
      fitScore: m.fitScore,
      role: m.role,
      joinedAt: m.joinedAt
    })));
  } catch (error) {
    console.error('Get members error:', error);
    res.status(500).json({ error: 'Failed to get members' });
  }
});

router.post('/:id/join', authMiddleware, async (req, res) => {
  try {
    const chatroom = await prisma.chatroom.findUnique({
      where: { id: req.params.id }
    });
    
    if (!chatroom) {
      return res.status(404).json({ error: 'Chatroom not found' });
    }
    
    
    if (chatroom.type !== 'public') {
      return res.status(403).json({ error: 'Cannot join this chatroom directly' });
    }
    
    await prisma.userChatroom.upsert({
      where: {
        userId_chatroomId: {
          userId: req.userId,
          chatroomId: req.params.id
        }
      },
      create: {
        userId: req.userId,
        chatroomId: req.params.id,
        fitScore: 100
      },
      update: {
        isActive: true
      }
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Join chatroom error:', error);
    res.status(500).json({ error: 'Failed to join chatroom' });
  }
});

router.post('/:id/leave', authMiddleware, async (req, res) => {
  try {
    await prisma.userChatroom.update({
      where: {
        userId_chatroomId: {
          userId: req.userId,
          chatroomId: req.params.id
        }
      },
      data: { isActive: false }
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Leave chatroom error:', error);
    res.status(500).json({ error: 'Failed to leave chatroom' });
  }
});

router.post('/:id/mute', authMiddleware, async (req, res) => {
  try {
    const { muted } = req.body;
    
    await prisma.userChatroom.update({
      where: {
        userId_chatroomId: {
          userId: req.userId,
          chatroomId: req.params.id
        }
      },
      data: { isMuted: muted }
    });
    
    res.json({ success: true, muted });
  } catch (error) {
    console.error('Mute chatroom error:', error);
    res.status(500).json({ error: 'Failed to mute chatroom' });
  }
});

router.post('/sync-profile', authMiddleware, async (req, res) => {
  try {
    const profileData = req.body;
    const assigned = await updateUserProfileAndReassign(req.userId, profileData);
    res.json({ success: true, assignedRooms: assigned });
  } catch (error) {
    console.error('Sync profile error:', error);
    res.status(500).json({ error: 'Failed to sync profile' });
  }
});

module.exports = router;
