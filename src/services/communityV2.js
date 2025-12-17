

const { supabase } = require('../db/supabase');

async function getUserProfile(userId) {
  if (!userId) return null;

  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, deriv_id, username, display_name, fullname, profile_photo, performance_tier')
    .eq('id', userId)
    .single();

  if (error || !data) {
    return {
      id: userId,
      derivId: userId,
      username: `Trader_${String(userId).slice(-4)}`,
      displayName: `Trader ${String(userId).slice(-4)}`,
      avatarUrl: null
    };
  }

  return {
    id: data.id,
    derivId: data.deriv_id,
    username: data.username || `Trader_${String(data.deriv_id || userId).slice(-4)}`,
    displayName: data.display_name || data.fullname || data.username,
    avatarUrl: data.profile_photo
  };
}

async function checkRateLimit(userId, actionType, maxActions, windowMinutes) {
  const windowStart = new Date();
  windowStart.setMinutes(windowStart.getMinutes() - (windowStart.getMinutes() % windowMinutes), 0, 0);

  const { data, error } = await supabase.rpc('check_rate_limit', {
    p_user_id: userId,
    p_action_type: actionType,
    p_max_actions: maxActions,
    p_window_minutes: windowMinutes
  });

  if (error) {
    console.error('Rate limit check error:', error);
    return true;
  }

  return data;
}

function sanitizeText(text) {
  if (!text) return '';
  return text
    .trim()
    .replace(/<[^>]*>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '');
}

async function transformPost(post, currentUserId = null) {
  const author = await getUserProfile(post.user_id);


  let liked = false;
  if (currentUserId) {

    let { data: likeData, error } = await supabase
      .from('community_post_likes')
      .select('id')
      .eq('post_id', post.id)
      .eq('user_id', currentUserId)
      .single();

    if (error && error.code === '42P01') {

      const { data: voteData } = await supabase
        .from('post_votes')
        .select('id, vote_value')
        .eq('post_id', post.id)
        .eq('user_id', currentUserId)
        .single();
      liked = voteData?.vote_value === 1;
    } else {
      liked = !!likeData;
    }
  }


  const likeCount = post.like_count ?? ((post.upvotes || 0) - (post.downvotes || 0));
  const commentCount = post.comment_count ?? 0;

  return {
    id: post.id,
    content: post.content || post.title,
    postType: post.post_type || post.category || 'general',
    imageUrl: post.image_url,
    fileUrl: post.file_url,
    fileName: post.file_name,
    fileType: post.file_type,
    fileSize: post.file_size,
    likeCount,
    commentCount,
    viewCount: post.view_count || 0,
    liked,
    isPinned: post.is_pinned || false,
    createdAt: post.created_at,
    updatedAt: post.updated_at,
    author: {
      id: author.id,
      derivId: author.derivId,
      username: author.username,
      displayName: author.displayName,
      avatarUrl: author.avatarUrl
    }
  };
}

async function transformComment(comment) {
  const author = await getUserProfile(comment.user_id);

  return {
    id: comment.id,
    content: comment.content,
    likeCount: comment.like_count || 0,
    createdAt: comment.created_at,
    author: {
      id: author.id,
      username: author.username,
      avatarUrl: author.avatarUrl
    }
  };
}

async function createPost(userId, data) {

  try {
    const canPost = await checkRateLimit(userId, 'create_post', 5, 10);
    if (!canPost) {
      return { success: false, error: 'Rate limit exceeded. Please wait before posting again.' };
    }
  } catch (e) {

  }

  const content = sanitizeText(data.content);
  const postType = data.post_type || data.postType || 'general';
  const imageUrl = data.image_url || data.imageUrl;
  const fileUrl = data.file_url || data.fileUrl;
  const fileName = data.file_name || data.fileName;
  const fileType = data.file_type || data.fileType;
  const fileSize = data.file_size || data.fileSize;

  if (!content || content.length < 1) {
    return { success: false, error: 'Post content is required' };
  }

  if (content.length > 5000) {
    return { success: false, error: 'Post content is too long (max 5000 characters)' };
  }

  const validTypes = ['general', 'strategy', 'result', 'question', 'news', 'discussion'];
  if (!validTypes.includes(postType)) {
    return { success: false, error: 'Invalid post type' };
  }


  let post, error;


  const result = await supabase
    .from('community_posts')
    .insert({
      user_id: userId,
      content,
      category: postType,
      image_url: imageUrl,
      file_url: fileUrl,
      file_name: fileName,
      file_type: fileType,
      file_size: fileSize,
      upvotes: 0,
      downvotes: 0
    })
    .select()
    .single();

  post = result.data;
  error = result.error;

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
      sortBy = 'newest',
      userId = null
    } = options;


    let query = supabase
      .from('community_posts')
      .select('id, user_id, content, title, category, upvotes, downvotes, created_at, updated_at', { count: 'exact' });


    if (category && category !== 'all') {
      query = query.eq('category', category);
    }


    switch (sortBy) {
      case 'top':
        query = query.order('upvotes', { ascending: false, nullsFirst: false });
        break;
      case 'trending':

        query = query
          .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
          .order('upvotes', { ascending: false, nullsFirst: false });
        break;
      case 'newest':
      default:
        query = query.order('created_at', { ascending: false });
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
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0, hasMore: false }
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

  return transformPost(post, userId);
}

async function deletePost(userId, postId) {
  const { data: post, error: fetchError } = await supabase
    .from('community_posts')
    .select('user_id')
    .eq('id', postId)
    .single();

  if (fetchError || !post) {
    return { success: false, error: 'Post not found' };
  }

  if (post.user_id !== userId) {
    return { success: false, error: 'Not authorized to delete this post' };
  }

  const { error } = await supabase
    .from('community_posts')
    .update({ is_deleted: true })
    .eq('id', postId);

  if (error) {
    return { success: false, error: 'Failed to delete post' };
  }

  return { success: true };
}

async function likePost(userId, postId, liked) {
  try {
    if (liked) {

      const { error } = await supabase
        .from('community_post_likes')
        .insert({ post_id: postId, user_id: userId });

      if (error && error.code !== '23505') {
        throw error;
      }
    } else {

      await supabase
        .from('community_post_likes')
        .delete()
        .eq('post_id', postId)
        .eq('user_id', userId);
    }


    const { data: post } = await supabase
      .from('community_posts')
      .select('like_count')
      .eq('id', postId)
      .single();

    return {
      success: true,
      likeCount: post?.like_count || 0,
      liked
    };
  } catch (error) {
    console.error('[Community] Like post error:', error);
    return { success: false, error: 'Failed to like post' };
  }
}

async function getComments(postId, options = {}) {
  const { page = 1, limit = 50 } = options;

  const { data: comments, error, count } = await supabase
    .from('community_comments')
    .select('*', { count: 'exact' })
    .eq('post_id', postId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: true })
    .range((page - 1) * limit, page * limit - 1);

  if (error) {
    console.error('[Community] Get comments error:', error);
    return { comments: [], total: 0 };
  }

  const transformedComments = await Promise.all(
    (comments || []).map(transformComment)
  );

  return {
    comments: transformedComments,
    total: count || 0
  };
}

async function addComment(userId, postId, content) {

  const canComment = await checkRateLimit(userId, 'add_comment', 20, 5);
  if (!canComment) {
    return { success: false, error: 'Rate limit exceeded. Please wait before commenting again.' };
  }

  const sanitizedContent = sanitizeText(content);

  if (!sanitizedContent || sanitizedContent.length < 1) {
    return { success: false, error: 'Comment content is required' };
  }

  if (sanitizedContent.length > 2000) {
    return { success: false, error: 'Comment is too long (max 2000 characters)' };
  }


  const { data: post, error: postError } = await supabase
    .from('community_posts')
    .select('id')
    .eq('id', postId)
    .eq('is_deleted', false)
    .single();

  if (postError || !post) {
    return { success: false, error: 'Post not found' };
  }

  const { data: comment, error } = await supabase
    .from('community_comments')
    .insert({
      post_id: postId,
      user_id: userId,
      content: sanitizedContent,
      like_count: 0,
      is_deleted: false
    })
    .select()
    .single();

  if (error) {
    console.error('[Community] Add comment error:', error);
    return { success: false, error: 'Failed to add comment' };
  }

  const transformedComment = await transformComment(comment);


  const { data: updatedPost } = await supabase
    .from('community_posts')
    .select('comment_count')
    .eq('id', postId)
    .single();

  return {
    success: true,
    comment: transformedComment,
    commentCount: updatedPost?.comment_count || 0
  };
}

async function deleteComment(userId, commentId) {
  const { data: comment, error: fetchError } = await supabase
    .from('community_comments')
    .select('user_id, post_id')
    .eq('id', commentId)
    .single();

  if (fetchError || !comment) {
    return { success: false, error: 'Comment not found' };
  }

  if (comment.user_id !== userId) {
    return { success: false, error: 'Not authorized to delete this comment' };
  }

  const { error } = await supabase
    .from('community_comments')
    .update({ is_deleted: true })
    .eq('id', commentId);

  if (error) {
    return { success: false, error: 'Failed to delete comment' };
  }

  return { success: true };
}

async function updateOnlineStatus(userId, status = 'online') {
  await supabase
    .from('community_online_users')
    .upsert({
      user_id: userId,
      status,
      last_seen: new Date().toISOString()
    }, { onConflict: 'user_id' });
}

async function getOnlineUsers(limit = 50) {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('community_online_users')
    .select(`
      user_id,
      status,
      last_seen,
      user_profiles (
        id,
        deriv_id,
        username,
        display_name,
        profile_photo
      )
    `)
    .gte('last_seen', fiveMinutesAgo)
    .neq('status', 'offline')
    .limit(limit);

  if (error) {
    console.error('[Community] Get online users error:', error);
    return [];
  }

  return (data || []).map(row => ({
    id: row.user_profiles?.id || row.user_id,
    derivId: row.user_profiles?.deriv_id,
    username: row.user_profiles?.username || 'Anonymous',
    displayName: row.user_profiles?.display_name,
    avatarUrl: row.user_profiles?.profile_photo,
    status: row.status,
    lastSeen: row.last_seen
  }));
}

async function uploadPostImage(userId, file) {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  const maxSize = 2 * 1024 * 1024;

  if (!allowedTypes.includes(file.mimetype)) {
    return { success: false, error: 'Invalid file type. Only JPG, PNG, and WebP allowed.' };
  }

  if (file.size > maxSize) {
    return { success: false, error: 'File too large. Maximum 2MB allowed.' };
  }

  const ext = file.originalname.split('.').pop();
  const fileName = `${userId}/${Date.now()}.${ext}`;

  const { data, error } = await supabase.storage
    .from('post-images')
    .upload(fileName, file.buffer, {
      contentType: file.mimetype,
      upsert: false
    });

  if (error) {
    console.error('[Community] Upload image error:', error);
    return { success: false, error: 'Failed to upload image' };
  }

  const { data: urlData } = supabase.storage
    .from('post-images')
    .getPublicUrl(data.path);

  return { success: true, url: urlData.publicUrl };
}

module.exports = {
  createPost,
  getFeed,
  getPost,
  deletePost,
  likePost,
  getComments,
  addComment,
  deleteComment,
  updateOnlineStatus,
  getOnlineUsers,
  uploadPostImage,
  getUserProfile,
  transformPost,
  transformComment
};

// Upload any file (documents, etc) to community
async function uploadPostFile(userId, file) {
  const maxSize = 10 * 1024 * 1024; // 10MB for files

  if (file.size > maxSize) {
    return { success: false, error: 'File too large. Maximum 10MB allowed.' };
  }

  const ext = file.originalname.split('.').pop();
  const fileName = `${userId}/${Date.now()}_${file.originalname}`;

  const { data, error } = await supabase.storage
    .from('community-files')
    .upload(fileName, file.buffer, {
      contentType: file.mimetype,
      upsert: false
    });

  if (error) {
    console.error('[Community] Upload file error:', error);
    return { success: false, error: 'Failed to upload file' };
  }

  const { data: urlData } = supabase.storage
    .from('community-files')
    .getPublicUrl(data.path);

  return {
    success: true,
    url: urlData.publicUrl,
    fileName: file.originalname,
    fileType: file.mimetype,
    fileSize: file.size
  };
}

// Get all media (images and files) shared in community
async function getSharedMedia(options = {}) {
  const { page = 1, limit = 50, type = 'all' } = options;

  try {
    // Get posts with images
    let imageQuery = supabase
      .from('community_posts')
      .select('id, user_id, image_url, file_url, file_name, file_type, file_size, created_at')
      .eq('is_deleted', false)
      .order('created_at', { ascending: false });

    if (type === 'image') {
      imageQuery = imageQuery.not('image_url', 'is', null);
    } else if (type === 'file') {
      imageQuery = imageQuery.not('file_url', 'is', null);
    } else {
      // Get both - posts that have either image_url or file_url
      imageQuery = imageQuery.or('image_url.neq.null,file_url.neq.null');
    }

    const offset = (page - 1) * limit;
    imageQuery = imageQuery.range(offset, offset + limit - 1);

    const { data: posts, error, count } = await imageQuery;

    if (error) {
      console.error('[Community] Get shared media error:', error);
      return { media: [], pagination: { page, limit, total: 0, hasMore: false } };
    }

    // Transform to media items
    const mediaItems = await Promise.all((posts || []).map(async (post) => {
      const author = await getUserProfile(post.user_id);

      if (post.image_url) {
        return {
          id: `img_${post.id}`,
          postId: post.id,
          url: post.image_url,
          type: 'image',
          fileName: null,
          fileSize: null,
          createdAt: post.created_at,
          author: {
            id: author.id,
            username: author.username,
            avatarUrl: author.avatarUrl
          }
        };
      } else if (post.file_url) {
        return {
          id: `file_${post.id}`,
          postId: post.id,
          url: post.file_url,
          type: 'file',
          fileName: post.file_name,
          fileType: post.file_type,
          fileSize: post.file_size,
          createdAt: post.created_at,
          author: {
            id: author.id,
            username: author.username,
            avatarUrl: author.avatarUrl
          }
        };
      }
      return null;
    }));

    const filteredMedia = mediaItems.filter(m => m !== null);
    const total = count || filteredMedia.length;

    return {
      media: filteredMedia,
      pagination: {
        page,
        limit,
        total,
        hasMore: page * limit < total
      }
    };
  } catch (error) {
    console.error('[Community] getSharedMedia error:', error);
    return { media: [], pagination: { page: 1, limit: 50, total: 0, hasMore: false } };
  }
}

// Initialize the community-files storage bucket
async function initializeCommunityStorage() {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    // Check/Create community-files bucket
    const fileBucket = buckets?.find(b => b.name === 'community-files');
    if (!fileBucket) {
      await supabase.storage.createBucket('community-files', {
        public: true,
        fileSizeLimit: 10 * 1024 * 1024, // 10MB
        allowedMimeTypes: null // Allow all
      });
      console.log('[Community] Created community-files bucket');
    } else if (!fileBucket.public) {
      // Optional: Update to public if not
      await supabase.storage.updateBucket('community-files', { public: true });
    }

    // Check/Create post-images bucket
    const imgBucket = buckets?.find(b => b.name === 'post-images');
    if (!imgBucket) {
      await supabase.storage.createBucket('post-images', {
        public: true,
        fileSizeLimit: 2 * 1024 * 1024, // 2MB
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
      });
      console.log('[Community] Created post-images bucket');
    } else if (!imgBucket.public) {
      await supabase.storage.updateBucket('post-images', { public: true });
    }

  } catch (error) {
    console.error('[Community] Failed to initialize storage:', error);
  }
}

// Initialize storage on module load
initializeCommunityStorage();

module.exports.uploadPostFile = uploadPostFile;
module.exports.getSharedMedia = getSharedMedia;
