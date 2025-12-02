/**
 * Profile Service
 * Handles user profiles, profile pictures, and friend search
 */

const { prisma } = require('./database');
const path = require('path');
const fs = require('fs').promises;

// Profile picture storage path
const UPLOAD_DIR = path.join(__dirname, '../../uploads/profiles');

/**
 * Initialize upload directory
 */
async function initializeUploadDir() {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    console.log('✅ Upload directory initialized');
  } catch (err) {
    console.error('Failed to create upload directory:', err);
  }
}

/**
 * Get user profile
 */
async function getUserProfile(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      displayName: true,
      email: true,
      avatarUrl: true,
      derivUserId: true,
      currency: true,
      country: true,
      winRate: true,
      totalTrades: true,
      totalProfit: true,
      emotionalScore: true,
      fomoScore: true,
      revengeScore: true,
      overtradingScore: true,
      disciplineScore: true,
      riskLevel: true,
      tradingStyle: true,
      preferredContractType: true,
      reputationScore: true,
      isOnline: true,
      lastSeenAt: true,
      createdAt: true
    }
  });
  
  if (!user) return null;
  
  // Get friend count
  const friendCount = await prisma.friend.count({
    where: {
      OR: [
        { userId, status: 'accepted' },
        { friendId: userId, status: 'accepted' }
      ]
    }
  });
  
  // Get chatroom count
  const chatroomCount = await prisma.userChatroom.count({
    where: { userId, isActive: true }
  });
  
  return {
    ...user,
    friendCount,
    chatroomCount
  };
}

/**
 * Update user profile
 */
async function updateUserProfile(userId, updates) {
  const allowedFields = ['displayName', 'email', 'avatarUrl'];
  const data = {};
  
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      data[field] = updates[field];
    }
  }
  
  return prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true,
      username: true,
      displayName: true,
      email: true,
      avatarUrl: true
    }
  });
}

/**
 * Save profile picture
 */
async function saveProfilePicture(userId, file) {
  await initializeUploadDir();
  
  const filename = `${userId}-${Date.now()}${path.extname(file.originalname)}`;
  const filepath = path.join(UPLOAD_DIR, filename);
  
  // Save file
  await fs.writeFile(filepath, file.buffer);
  
  // Update user avatar URL
  const avatarUrl = `/api/uploads/profiles/${filename}`;
  await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl }
  });
  
  return avatarUrl;
}

/**
 * Delete profile picture
 */
async function deleteProfilePicture(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarUrl: true }
  });
  
  if (user?.avatarUrl && user.avatarUrl.startsWith('/api/uploads/')) {
    const filename = user.avatarUrl.split('/').pop();
    const filepath = path.join(UPLOAD_DIR, filename);
    
    try {
      await fs.unlink(filepath);
    } catch (err) {
      console.error('Failed to delete profile picture:', err);
    }
  }
  
  await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl: null }
  });
}

/**
 * Search users by username (fuzzy search)
 * Only searches by username, never exposes user IDs in search
 */
async function searchUsersByUsername(query, limit = 20, excludeUserId = null) {
  if (!query || query.length < 2) {
    return [];
  }
  
  // Sanitize query
  const sanitizedQuery = query.toLowerCase().replace(/[^a-z0-9_]/g, '');
  
  const users = await prisma.user.findMany({
    where: {
      AND: [
        {
          OR: [
            { username: { contains: sanitizedQuery, mode: 'insensitive' } },
            { displayName: { contains: sanitizedQuery, mode: 'insensitive' } }
          ]
        },
        excludeUserId ? { id: { not: excludeUserId } } : {},
        { isBanned: false }
      ]
    },
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      isOnline: true,
      lastSeenAt: true,
      reputationScore: true
    },
    orderBy: [
      // Prioritize exact match
      { username: 'asc' }
    ],
    take: limit
  });
  
  // Sort by relevance (exact match first, then starts with, then contains)
  return users.sort((a, b) => {
    const aLower = a.username.toLowerCase();
    const bLower = b.username.toLowerCase();
    const qLower = sanitizedQuery.toLowerCase();
    
    if (aLower === qLower) return -1;
    if (bLower === qLower) return 1;
    if (aLower.startsWith(qLower)) return -1;
    if (bLower.startsWith(qLower)) return 1;
    return 0;
  });
}

/**
 * Get public profile (for viewing other users)
 */
async function getPublicProfile(username) {
  const user = await prisma.user.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      winRate: true,
      totalTrades: true,
      riskLevel: true,
      tradingStyle: true,
      reputationScore: true,
      isOnline: true,
      lastSeenAt: true,
      createdAt: true
    }
  });
  
  if (!user) return null;
  
  // Get friend count (public info)
  const friendCount = await prisma.friend.count({
    where: {
      OR: [
        { userId: user.id, status: 'accepted' },
        { friendId: user.id, status: 'accepted' }
      ]
    }
  });
  
  // Get post count
  const postCount = await prisma.communityPost.count({
    where: { userId: user.id }
  });
  
  return {
    ...user,
    friendCount,
    postCount
  };
}

/**
 * Send friend request by username
 */
async function sendFriendRequest(userId, targetUsername) {
  // Find target user
  const targetUser = await prisma.user.findUnique({
    where: { username: targetUsername },
    select: { id: true, username: true }
  });
  
  if (!targetUser) {
    return { success: false, error: 'User not found' };
  }
  
  if (targetUser.id === userId) {
    return { success: false, error: 'Cannot add yourself as a friend' };
  }
  
  // Check existing relationship
  const existing = await prisma.friend.findFirst({
    where: {
      OR: [
        { userId, friendId: targetUser.id },
        { userId: targetUser.id, friendId: userId }
      ]
    }
  });
  
  if (existing) {
    if (existing.status === 'accepted') {
      return { success: false, error: 'Already friends' };
    }
    if (existing.status === 'pending') {
      return { success: false, error: 'Friend request already pending' };
    }
    if (existing.status === 'blocked') {
      return { success: false, error: 'Unable to send friend request' };
    }
  }
  
  // Create friend request
  await prisma.friend.create({
    data: {
      userId,
      friendId: targetUser.id,
      status: 'pending'
    }
  });
  
  // Create notification for target user
  await prisma.notification.create({
    data: {
      userId: targetUser.id,
      type: 'friend_request',
      title: 'New Friend Request',
      message: `You have a new friend request`,
      link: '/friends'
    }
  });
  
  return { success: true, targetUsername: targetUser.username };
}

/**
 * Accept friend request
 */
async function acceptFriendRequest(userId, requestId) {
  const request = await prisma.friend.findFirst({
    where: {
      id: requestId,
      friendId: userId,
      status: 'pending'
    },
    include: { user: true }
  });
  
  if (!request) {
    return { success: false, error: 'Friend request not found' };
  }
  
  await prisma.friend.update({
    where: { id: requestId },
    data: { status: 'accepted' }
  });
  
  // Notify the requester
  await prisma.notification.create({
    data: {
      userId: request.userId,
      type: 'friend_accepted',
      title: 'Friend Request Accepted',
      message: `Your friend request was accepted`,
      link: '/friends'
    }
  });
  
  return { success: true };
}

/**
 * Decline friend request
 */
async function declineFriendRequest(userId, requestId) {
  const request = await prisma.friend.findFirst({
    where: {
      id: requestId,
      friendId: userId,
      status: 'pending'
    }
  });
  
  if (!request) {
    return { success: false, error: 'Friend request not found' };
  }
  
  await prisma.friend.delete({
    where: { id: requestId }
  });
  
  return { success: true };
}

/**
 * Get friend list
 */
async function getFriendList(userId) {
  const friends = await prisma.friend.findMany({
    where: {
      OR: [
        { userId, status: 'accepted' },
        { friendId: userId, status: 'accepted' }
      ]
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
      },
      friend: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          isOnline: true,
          lastSeenAt: true
        }
      }
    }
  });
  
  return friends.map(f => {
    const friendData = f.userId === userId ? f.friend : f.user;
    return {
      id: f.id,
      friendId: friendData.id,
      username: friendData.username,
      displayName: friendData.displayName,
      avatarUrl: friendData.avatarUrl,
      isOnline: friendData.isOnline,
      lastSeenAt: friendData.lastSeenAt
    };
  });
}

/**
 * Get pending friend requests
 */
async function getPendingRequests(userId) {
  const requests = await prisma.friend.findMany({
    where: {
      friendId: userId,
      status: 'pending'
    },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          reputationScore: true
        }
      }
    }
  });
  
  return requests.map(r => ({
    id: r.id,
    from: {
      username: r.user.username,
      displayName: r.user.displayName,
      avatarUrl: r.user.avatarUrl,
      reputationScore: r.user.reputationScore
    },
    createdAt: r.createdAt
  }));
}

/**
 * Remove friend
 */
async function removeFriend(userId, friendshipId) {
  const friendship = await prisma.friend.findFirst({
    where: {
      id: friendshipId,
      OR: [
        { userId },
        { friendId: userId }
      ],
      status: 'accepted'
    }
  });
  
  if (!friendship) {
    return { success: false, error: 'Friendship not found' };
  }
  
  await prisma.friend.delete({
    where: { id: friendshipId }
  });
  
  return { success: true };
}

/**
 * Block user
 */
async function blockUser(userId, targetUsername) {
  const targetUser = await prisma.user.findUnique({
    where: { username: targetUsername },
    select: { id: true }
  });
  
  if (!targetUser) {
    return { success: false, error: 'User not found' };
  }
  
  // Remove existing friendship if any
  await prisma.friend.deleteMany({
    where: {
      OR: [
        { userId, friendId: targetUser.id },
        { userId: targetUser.id, friendId: userId }
      ]
    }
  });
  
  // Create block record
  await prisma.friend.create({
    data: {
      userId,
      friendId: targetUser.id,
      status: 'blocked'
    }
  });
  
  return { success: true };
}

/**
 * Unblock user
 */
async function unblockUser(userId, targetUsername) {
  const targetUser = await prisma.user.findUnique({
    where: { username: targetUsername },
    select: { id: true }
  });
  
  if (!targetUser) {
    return { success: false, error: 'User not found' };
  }
  
  await prisma.friend.deleteMany({
    where: {
      userId,
      friendId: targetUser.id,
      status: 'blocked'
    }
  });
  
  return { success: true };
}

/**
 * Check if users are friends
 */
async function areFriends(userId1, userId2) {
  const friendship = await prisma.friend.findFirst({
    where: {
      OR: [
        { userId: userId1, friendId: userId2, status: 'accepted' },
        { userId: userId2, friendId: userId1, status: 'accepted' }
      ]
    }
  });
  
  return !!friendship;
}

/**
 * Check if user is blocked
 */
async function isBlocked(userId, targetId) {
  const block = await prisma.friend.findFirst({
    where: {
      OR: [
        { userId, friendId: targetId, status: 'blocked' },
        { userId: targetId, friendId: userId, status: 'blocked' }
      ]
    }
  });
  
  return !!block;
}

module.exports = {
  initializeUploadDir,
  getUserProfile,
  updateUserProfile,
  saveProfilePicture,
  deleteProfilePicture,
  searchUsersByUsername,
  getPublicProfile,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  getFriendList,
  getPendingRequests,
  removeFriend,
  blockUser,
  unblockUser,
  areFriends,
  isBlocked
};
