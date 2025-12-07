const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../db/supabase');

async function getUserProfile(userId) {
  if (!userId) return null;
  
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, username, display_name, fullname, profile_photo, performance_tier')
    .eq('id', userId)
    .single();
  
  if (error || !data) {
    return {
      id: userId,
      username: `Trader_${String(userId).slice(-4)}`,
      displayName: `Trader ${String(userId).slice(-4)}`,
      avatarUrl: `https:
      reputation: 0
    };
  }
  
  return {
    id: data.id,
    username: data.username || `Trader_${String(userId).slice(-4)}`,
    displayName: data.display_name || data.fullname || data.username,
    avatarUrl: data.profile_photo || `https:
    reputation: data.performance_tier === 'elite' ? 500 : data.performance_tier === 'pro' ? 300 : 100
  };
}

async function transformPost(post, currentUserId = null) {
  const author = await getUserProfile(post.user_id);
  
  
  const { count: commentCount } = await supabase
    .from('post_comments')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', post.id)
    .eq('is_deleted', false);
  
  
  let userVote = 0;
  if (currentUserId) {
    const { data: vote } = await supabase
      .from('post_votes')
      .select('vote_value')
      .eq('post_id', post.id)
      .eq('user_id', currentUserId)
      .single();
    userVote = vote?.vote_value || 0;
  }
  
  return {
    id: post.id,
    title: post.title,
    content: post.content,
    category: post.category || 'discussion',
    tags: post.tags || [],
    attachments: post.attachments || [],
    author: {
      username: author.username,
      displayName: author.displayName,
      avatarUrl: author.avatarUrl,
      reputation: author.reputation
    },
    votes: (post.upvotes || 0) - (post.downvotes || 0),
    upvotes: post.upvotes || 0,
    downvotes: post.downvotes || 0,
    commentCount: commentCount || 0,
    userVote,
    isPinned: Boolean(post.is_pinned),
    createdAt: post.created_at,
    updatedAt: post.updated_at,
    viewCount: post.view_count || 0
  };
}

async function transformComment(comment) {
  const author = await getUserProfile(comment.user_id);
  return {
    id: comment.id,
    content: comment.content,
    author: {
      username: author.username,
      displayName: author.displayName,
      avatarUrl: author.avatarUrl
    },
    createdAt: comment.created_at
  };
}

async function createPost(userId, data = {}, userInfo = {}) {
  const { title, content, category, tags = [], attachments = [] } = data;
  
  if (!title || title.length < 5 || title.length > 200) {
    return { success: false, error: 'Title must be 5-200 characters' };
  }
  if (!content || content.length < 10 || content.length > 10000) {
    return { success: false, error: 'Content must be 10-10000 characters' };
  }
  
  const { data: post, error } = await supabase
    .from('community_posts')
    .insert({
      user_id: userId,
      title: title.trim(),
      content: content.trim(),
      category: category || 'discussion',
      tags: Array.isArray(tags) ? tags : [],
      attachments: Array.isArray(attachments) ? attachments : [],
      upvotes: 0,
      downvotes: 0,
      view_count: 0,
      is_pinned: false,
      is_deleted: false
    })
    .select()
    .single();
  
  if (error) {
    console.error('[Community] Create post error:', error);
    return { success: false, error: 'Failed to create post' };
  }
  
  const transformedPost = await transformPost(post, userId);
  return { success: true, post: transformedPost };
}

async function getFeed(options = {}) {
  try {
    const { 
      page = 1, 
      limit = 20, 
      category, 
      sortBy = 'trending', 
      timeRange = 'week',
      userId = null 
    } = options;
    
    
    let timeFilter = null;
    if (timeRange && timeRange !== 'all') {
      const now = new Date();
      switch (timeRange) {
        case 'day':
          timeFilter = new Date(now - 24 * 60 * 60 * 1000).toISOString();
          break;
        case 'week':
          timeFilter = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
          break;
        case 'month':
          timeFilter = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
          break;
      }
    }
    
    
    let query = supabase
      .from('community_posts')
      .select('*', { count: 'exact' })
      .eq('is_deleted', false);
    
    if (category) {
      query = query.eq('category', category);
    }
    
    if (timeFilter) {
      query = query.gte('created_at', timeFilter);
    }
    
    
    switch (sortBy) {
      case 'newest':
        query = query.order('created_at', { ascending: false });
        break;
      case 'top':
        query = query.order('upvotes', { ascending: false });
        break;
      case 'trending':
      default:
        query = query.order('created_at', { ascending: false });
        break;
    }
    
    
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);
    
    const { data: posts, error, count } = await query;
    
    if (error) {
      console.error('[Community] Get feed error:', error);
      return { posts: [], pagination: { page, limit, total: 0, totalPages: 0, hasMore: false } };
    }
    
    
    const transformedPosts = await Promise.all(
      (posts || []).map(post => transformPost(post, userId))
    );
    
    
    if (sortBy === 'trending') {
      transformedPosts.sort((a, b) => {
        const aScore = a.votes / Math.max(1, (Date.now() - new Date(a.createdAt)) / 3600000);
        const bScore = b.votes / Math.max(1, (Date.now() - new Date(b.createdAt)) / 3600000);
        return bScore - aScore;
      });
    }
    
    const total = count || 0;
    const totalPages = Math.ceil(total / limit);
    
    return {
      posts: transformedPosts,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasMore: page < totalPages
      }
    };
  } catch (error) {
    console.error('[Community] getFeed error:', error);
    return {
      posts: [],
      pagination: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
        hasMore: false
      }
    };
  }
}

async function getPost(postId, userId = null) {
  
  const { data: post, error } = await supabase
    .from('community_posts')
    .select('*')
    .eq('id', postId)
    .eq('is_deleted', false)
    .single();
  
  if (error || !post) {
    return null;
  }
  
  
  await supabase
    .from('community_posts')
    .update({ view_count: (post.view_count || 0) + 1 })
    .eq('id', postId);
  
  
  const { data: comments } = await supabase
    .from('post_comments')
    .select('*')
    .eq('post_id', postId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: true });
  
  
  const transformedPost = await transformPost(post, userId);
  
  
  const transformedComments = await Promise.all(
    (comments || []).map(comment => transformComment(comment))
  );
  
  return {
    ...transformedPost,
    comments: transformedComments
  };
}

async function votePost(userId, postId, value) {
  if (![1, 0, -1].includes(value)) {
    return { success: false, error: 'Invalid vote value' };
  }
  
  
  const { data: post, error: postError } = await supabase
    .from('community_posts')
    .select('id, upvotes, downvotes')
    .eq('id', postId)
    .eq('is_deleted', false)
    .single();
  
  if (postError || !post) {
    return { success: false, error: 'Post not found' };
  }
  
  
  const { data: existingVote } = await supabase
    .from('post_votes')
    .select('id, vote_value')
    .eq('post_id', postId)
    .eq('user_id', userId)
    .single();
  
  const previousValue = existingVote?.vote_value || 0;
  
  if (value === 0) {
    
    if (existingVote) {
      await supabase.from('post_votes').delete().eq('id', existingVote.id);
    }
  } else if (existingVote) {
    
    await supabase
      .from('post_votes')
      .update({ vote_value: value })
      .eq('id', existingVote.id);
  } else {
    
    await supabase
      .from('post_votes')
      .insert({ post_id: postId, user_id: userId, vote_value: value });
  }
  
  
  let upvotes = post.upvotes || 0;
  let downvotes = post.downvotes || 0;
  
  if (previousValue === 1) upvotes--;
  if (previousValue === -1) downvotes--;
  if (value === 1) upvotes++;
  if (value === -1) downvotes++;
  
  
  await supabase
    .from('community_posts')
    .update({ upvotes, downvotes })
    .eq('id', postId);
  
  return {
    success: true,
    votes: upvotes - downvotes,
    upvotes,
    downvotes
  };
}

async function addComment(userId, postId, content, userInfo = {}) {
  if (!content || content.trim().length < 1 || content.length > 2000) {
    return { success: false, error: 'Comment must be 1-2000 characters' };
  }
  
  
  const { data: post } = await supabase
    .from('community_posts')
    .select('id')
    .eq('id', postId)
    .eq('is_deleted', false)
    .single();
  
  if (!post) {
    return { success: false, error: 'Post not found' };
  }
  
  
  const { data: comment, error } = await supabase
    .from('post_comments')
    .insert({
      post_id: postId,
      user_id: userId,
      content: content.trim(),
      is_deleted: false
    })
    .select()
    .single();
  
  if (error) {
    console.error('[Community] Add comment error:', error);
    return { success: false, error: 'Failed to add comment' };
  }
  
  const transformedComment = await transformComment(comment);
  return { success: true, comment: transformedComment };
}

async function deletePost(userId, postId) {
  const { data: post } = await supabase
    .from('community_posts')
    .select('user_id')
    .eq('id', postId)
    .eq('is_deleted', false)
    .single();
  
  if (!post) {
    return { success: false, error: 'Post not found' };
  }
  
  if (post.user_id !== userId) {
    return { success: false, error: 'Not authorized to delete this post' };
  }
  
  await supabase
    .from('community_posts')
    .update({ is_deleted: true })
    .eq('id', postId);
  
  return { success: true };
}

async function deleteComment(userId, commentId) {
  const { data: comment } = await supabase
    .from('post_comments')
    .select('user_id')
    .eq('id', commentId)
    .eq('is_deleted', false)
    .single();
  
  if (!comment) {
    return { success: false, error: 'Comment not found' };
  }
  
  if (comment.user_id !== userId) {
    return { success: false, error: 'Not authorized to delete this comment' };
  }
  
  await supabase
    .from('post_comments')
    .update({ is_deleted: true })
    .eq('id', commentId);
  
  return { success: true };
}

async function getUserPosts(username, page = 1, limit = 20) {
  
  const { data: user } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('username', username)
    .single();
  
  if (!user) {
    return { posts: [], pagination: { page, limit, total: 0, totalPages: 0, hasMore: false } };
  }
  
  const offset = (page - 1) * limit;
  
  const { data: posts, count } = await supabase
    .from('community_posts')
    .select('*', { count: 'exact' })
    .eq('user_id', user.id)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  
  const transformedPosts = await Promise.all(
    (posts || []).map(async post => ({
      id: post.id,
      title: post.title,
      content: post.content,
      category: post.category,
      votes: (post.upvotes || 0) - (post.downvotes || 0),
      commentCount: 0, 
      createdAt: post.created_at
    }))
  );
  
  const total = count || 0;
  const totalPages = Math.ceil(total / limit);
  
  return {
    posts: transformedPosts,
    pagination: { page, limit, total, totalPages, hasMore: page < totalPages }
  };
}

async function getTrendingTags(limit = 10) {
  const { data: posts } = await supabase
    .from('community_posts')
    .select('tags')
    .eq('is_deleted', false);
  
  const tagCount = {};
  (posts || []).forEach(post => {
    (post.tags || []).forEach(tag => {
      tagCount[tag] = (tagCount[tag] || 0) + 1;
    });
  });
  
  return Object.entries(tagCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
}

async function searchPosts(query, options = {}) {
  const { page = 1, limit = 20, category } = options;
  
  if (!query) {
    return { posts: [], pagination: { page: 1, limit, total: 0, totalPages: 1, hasMore: false } };
  }
  
  const searchPattern = `%${query}%`;
  const offset = (page - 1) * limit;
  
  let dbQuery = supabase
    .from('community_posts')
    .select('*', { count: 'exact' })
    .eq('is_deleted', false)
    .or(`title.ilike.${searchPattern},content.ilike.${searchPattern}`);
  
  if (category) {
    dbQuery = dbQuery.eq('category', category);
  }
  
  const { data: posts, count } = await dbQuery
    .order('upvotes', { ascending: false })
    .range(offset, offset + limit - 1);
  
  const transformedPosts = await Promise.all(
    (posts || []).map(async post => {
      const author = await getUserProfile(post.user_id);
      return {
        id: post.id,
        title: post.title,
        content: post.content.substring(0, 200),
        category: post.category,
        author,
        votes: (post.upvotes || 0) - (post.downvotes || 0),
        commentCount: 0,
        createdAt: post.created_at
      };
    })
  );
  
  const total = count || 0;
  const totalPages = Math.ceil(total / limit);
  
  return {
    posts: transformedPosts,
    pagination: { page, limit, total, totalPages, hasMore: page < totalPages }
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
