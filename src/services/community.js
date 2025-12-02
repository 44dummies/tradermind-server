/**
 * Community Service
 * Handles community posts, comments, voting, and feed
 */

const { prisma } = require('./database');

/**
 * Create a new community post
 */
async function createPost(userId, data) {
  const { title, content, category, tags, attachments } = data;
  
  // Validate
  if (!title || title.length < 5 || title.length > 200) {
    return { success: false, error: 'Title must be 5-200 characters' };
  }
  if (!content || content.length < 10 || content.length > 10000) {
    return { success: false, error: 'Content must be 10-10000 characters' };
  }
  
  const post = await prisma.communityPost.create({
    data: {
      userId,
      title: title.trim(),
      content: content.trim(),
      category: category || 'discussion',
      tags: tags || [],
      attachments: attachments || []
    },
    include: {
      user: {
        select: {
          username: true,
          displayName: true,
          avatarUrl: true,
          reputationScore: true
        }
      }
    }
  });
  
  return { success: true, post };
}

/**
 * Get community feed with pagination
 */
async function getFeed(options = {}) {
  const {
    page = 1,
    limit = 20,
    category = null,
    sortBy = 'trending', // trending, newest, top
    timeRange = 'week', // day, week, month, all
    userId = null
  } = options;
  
  const skip = (page - 1) * limit;
  
  // Build where clause
  const where = {
    isDeleted: false
  };
  
  if (category) {
    where.category = category;
  }
  
  // Time range filter for trending/top
  if (timeRange !== 'all') {
    const now = new Date();
    let startDate;
    switch (timeRange) {
      case 'day':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = null;
    }
    if (startDate) {
      where.createdAt = { gte: startDate };
    }
  }
  
  // Build order clause
  let orderBy;
  switch (sortBy) {
    case 'newest':
      orderBy = { createdAt: 'desc' };
      break;
    case 'top':
      orderBy = { voteScore: 'desc' };
      break;
    case 'trending':
    default:
      // Trending = hot score (combination of votes and recency)
      orderBy = [{ voteScore: 'desc' }, { createdAt: 'desc' }];
      break;
  }
  
  const [posts, total] = await Promise.all([
    prisma.communityPost.findMany({
      where,
      include: {
        user: {
          select: {
            username: true,
            displayName: true,
            avatarUrl: true,
            reputationScore: true
          }
        },
        _count: {
          select: { comments: true }
        }
      },
      orderBy,
      skip,
      take: limit
    }),
    prisma.communityPost.count({ where })
  ]);
  
  // Get user's votes if authenticated
  let userVotes = {};
  if (userId) {
    const votes = await prisma.postVote.findMany({
      where: {
        userId,
        postId: { in: posts.map(p => p.id) }
      }
    });
    userVotes = votes.reduce((acc, v) => {
      acc[v.postId] = v.value;
      return acc;
    }, {});
  }
  
  // Format posts
  const formattedPosts = posts.map(post => ({
    id: post.id,
    title: post.title,
    content: post.content,
    category: post.category,
    tags: post.tags,
    attachments: post.attachments,
    author: {
      username: post.user.username,
      displayName: post.user.displayName,
      avatarUrl: post.user.avatarUrl,
      reputation: post.user.reputationScore
    },
    votes: post.voteScore,
    upvotes: post.upvotes,
    downvotes: post.downvotes,
    commentCount: post._count.comments,
    userVote: userVotes[post.id] || 0,
    isPinned: post.isPinned,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt
  }));
  
  return {
    posts: formattedPosts,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: skip + posts.length < total
    }
  };
}

/**
 * Get single post with comments
 */
async function getPost(postId, userId = null) {
  const post = await prisma.communityPost.findUnique({
    where: { id: postId },
    include: {
      user: {
        select: {
          username: true,
          displayName: true,
          avatarUrl: true,
          reputationScore: true
        }
      },
      comments: {
        where: { isDeleted: false },
        include: {
          user: {
            select: {
              username: true,
              displayName: true,
              avatarUrl: true
            }
          }
        },
        orderBy: { createdAt: 'asc' }
      }
    }
  });
  
  if (!post || post.isDeleted) {
    return null;
  }
  
  // Increment view count
  await prisma.communityPost.update({
    where: { id: postId },
    data: { viewCount: { increment: 1 } }
  });
  
  // Get user's vote
  let userVote = 0;
  if (userId) {
    const vote = await prisma.postVote.findUnique({
      where: {
        userId_postId: { userId, postId }
      }
    });
    userVote = vote?.value || 0;
  }
  
  return {
    id: post.id,
    title: post.title,
    content: post.content,
    category: post.category,
    tags: post.tags,
    attachments: post.attachments,
    author: {
      username: post.user.username,
      displayName: post.user.displayName,
      avatarUrl: post.user.avatarUrl,
      reputation: post.user.reputationScore
    },
    votes: post.voteScore,
    upvotes: post.upvotes,
    downvotes: post.downvotes,
    viewCount: post.viewCount + 1,
    userVote,
    isPinned: post.isPinned,
    comments: post.comments.map(c => ({
      id: c.id,
      content: c.content,
      author: {
        username: c.user.username,
        displayName: c.user.displayName,
        avatarUrl: c.user.avatarUrl
      },
      createdAt: c.createdAt
    })),
    createdAt: post.createdAt,
    updatedAt: post.updatedAt
  };
}

/**
 * Vote on a post
 */
async function votePost(userId, postId, value) {
  // Validate value
  if (![1, 0, -1].includes(value)) {
    return { success: false, error: 'Invalid vote value' };
  }
  
  const post = await prisma.communityPost.findUnique({
    where: { id: postId }
  });
  
  if (!post || post.isDeleted) {
    return { success: false, error: 'Post not found' };
  }
  
  // Get existing vote
  const existingVote = await prisma.postVote.findUnique({
    where: {
      userId_postId: { userId, postId }
    }
  });
  
  const previousValue = existingVote?.value || 0;
  
  if (value === 0) {
    // Remove vote
    if (existingVote) {
      await prisma.postVote.delete({
        where: { userId_postId: { userId, postId } }
      });
    }
  } else {
    // Upsert vote
    await prisma.postVote.upsert({
      where: { userId_postId: { userId, postId } },
      create: { userId, postId, value },
      update: { value }
    });
  }
  
  // Calculate vote changes
  let upvoteChange = 0;
  let downvoteChange = 0;
  
  if (previousValue === 1) upvoteChange -= 1;
  if (previousValue === -1) downvoteChange -= 1;
  if (value === 1) upvoteChange += 1;
  if (value === -1) downvoteChange += 1;
  
  // Update post vote counts
  const updatedPost = await prisma.communityPost.update({
    where: { id: postId },
    data: {
      upvotes: { increment: upvoteChange },
      downvotes: { increment: downvoteChange },
      voteScore: { increment: value - previousValue }
    }
  });
  
  // Update author reputation
  await prisma.user.update({
    where: { id: post.userId },
    data: {
      reputationScore: { increment: value - previousValue }
    }
  });
  
  return {
    success: true,
    votes: updatedPost.voteScore,
    upvotes: updatedPost.upvotes,
    downvotes: updatedPost.downvotes
  };
}

/**
 * Add comment to post
 */
async function addComment(userId, postId, content) {
  if (!content || content.length < 1 || content.length > 2000) {
    return { success: false, error: 'Comment must be 1-2000 characters' };
  }
  
  const post = await prisma.communityPost.findUnique({
    where: { id: postId }
  });
  
  if (!post || post.isDeleted) {
    return { success: false, error: 'Post not found' };
  }
  
  const comment = await prisma.postComment.create({
    data: {
      userId,
      postId,
      content: content.trim()
    },
    include: {
      user: {
        select: {
          username: true,
          displayName: true,
          avatarUrl: true
        }
      }
    }
  });
  
  // Notify post author
  if (post.userId !== userId) {
    await prisma.notification.create({
      data: {
        userId: post.userId,
        type: 'comment',
        title: 'New Comment',
        message: `Someone commented on your post`,
        link: `/community/post/${postId}`
      }
    });
  }
  
  return {
    success: true,
    comment: {
      id: comment.id,
      content: comment.content,
      author: {
        username: comment.user.username,
        displayName: comment.user.displayName,
        avatarUrl: comment.user.avatarUrl
      },
      createdAt: comment.createdAt
    }
  };
}

/**
 * Delete post (soft delete)
 */
async function deletePost(userId, postId) {
  const post = await prisma.communityPost.findUnique({
    where: { id: postId }
  });
  
  if (!post) {
    return { success: false, error: 'Post not found' };
  }
  
  if (post.userId !== userId) {
    return { success: false, error: 'Not authorized to delete this post' };
  }
  
  await prisma.communityPost.update({
    where: { id: postId },
    data: { isDeleted: true }
  });
  
  return { success: true };
}

/**
 * Delete comment (soft delete)
 */
async function deleteComment(userId, commentId) {
  const comment = await prisma.postComment.findUnique({
    where: { id: commentId }
  });
  
  if (!comment) {
    return { success: false, error: 'Comment not found' };
  }
  
  if (comment.userId !== userId) {
    return { success: false, error: 'Not authorized to delete this comment' };
  }
  
  await prisma.postComment.update({
    where: { id: commentId },
    data: { isDeleted: true }
  });
  
  return { success: true };
}

/**
 * Get user's posts
 */
async function getUserPosts(username, page = 1, limit = 20) {
  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true }
  });
  
  if (!user) {
    return { posts: [], pagination: { total: 0 } };
  }
  
  const skip = (page - 1) * limit;
  
  const [posts, total] = await Promise.all([
    prisma.communityPost.findMany({
      where: {
        userId: user.id,
        isDeleted: false
      },
      include: {
        user: {
          select: {
            username: true,
            displayName: true,
            avatarUrl: true
          }
        },
        _count: {
          select: { comments: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    }),
    prisma.communityPost.count({
      where: {
        userId: user.id,
        isDeleted: false
      }
    })
  ]);
  
  return {
    posts: posts.map(post => ({
      id: post.id,
      title: post.title,
      content: post.content,
      category: post.category,
      votes: post.voteScore,
      commentCount: post._count.comments,
      createdAt: post.createdAt
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: skip + posts.length < total
    }
  };
}

/**
 * Get trending tags
 */
async function getTrendingTags(limit = 10) {
  const recentPosts = await prisma.communityPost.findMany({
    where: {
      isDeleted: false,
      createdAt: {
        gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      }
    },
    select: { tags: true }
  });
  
  // Count tag occurrences
  const tagCounts = {};
  for (const post of recentPosts) {
    for (const tag of post.tags) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }
  
  // Sort by count and return top tags
  return Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
}

/**
 * Search posts
 */
async function searchPosts(query, options = {}) {
  const { page = 1, limit = 20, category = null } = options;
  const skip = (page - 1) * limit;
  
  const where = {
    isDeleted: false,
    OR: [
      { title: { contains: query, mode: 'insensitive' } },
      { content: { contains: query, mode: 'insensitive' } },
      { tags: { has: query.toLowerCase() } }
    ]
  };
  
  if (category) {
    where.category = category;
  }
  
  const [posts, total] = await Promise.all([
    prisma.communityPost.findMany({
      where,
      include: {
        user: {
          select: {
            username: true,
            displayName: true,
            avatarUrl: true
          }
        },
        _count: {
          select: { comments: true }
        }
      },
      orderBy: { voteScore: 'desc' },
      skip,
      take: limit
    }),
    prisma.communityPost.count({ where })
  ]);
  
  return {
    posts: posts.map(post => ({
      id: post.id,
      title: post.title,
      content: post.content.substring(0, 200),
      category: post.category,
      author: {
        username: post.user.username,
        displayName: post.user.displayName,
        avatarUrl: post.user.avatarUrl
      },
      votes: post.voteScore,
      commentCount: post._count.comments,
      createdAt: post.createdAt
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: skip + posts.length < total
    }
  };
}

module.exports = {
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
};
