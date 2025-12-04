/**
 * Tier Chatroom Routes
 * Users are auto-grouped by their performance tier
 */

const express = require('express');
const { supabase } = require('../db/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Get io from app
function getIo(req) {
  return req.app.get('io');
}

// =============================================
// HELPER FUNCTIONS
// =============================================

/**
 * Get user's tier based on analytics
 */
function calculateTier(winRate, totalTrades) {
  if (totalTrades >= 1000 && winRate >= 80) return 'master';
  if (totalTrades >= 500 && winRate >= 65) return 'expert';
  if (totalTrades >= 200 && winRate >= 55) return 'advanced';
  if (totalTrades >= 50 && winRate >= 45) return 'intermediate';
  return 'beginner';
}

/**
 * Get user profile by ID
 */
async function getUserProfile(userId) {
  // First try to find by deriv_id (the userId from JWT is actually deriv_id)
  let { data, error } = await supabase
    .from('user_profiles')
    .select('id, deriv_id, username, fullname, profile_photo, is_online, win_rate, total_trades')
    .eq('deriv_id', userId)
    .single();

  if (!data) {
    // Try by UUID
    const result = await supabase
      .from('user_profiles')
      .select('id, deriv_id, username, fullname, profile_photo, is_online, win_rate, total_trades')
      .eq('id', userId)
      .single();
    data = result.data;
    error = result.error;
  }

  if (error || !data) {
    return null;
  }

  return data;
}

/**
 * Get or create user profile
 */
async function getOrCreateProfile(derivId, username) {
  let profile = await getUserProfile(derivId);
  
  if (!profile) {
    // Create profile
    const { data, error } = await supabase
      .from('user_profiles')
      .insert({
        deriv_id: derivId,
        username: username || `Trader_${derivId.slice(-4)}`
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error creating profile:', error);
      return null;
    }
    profile = data;
  }
  
  return profile;
}

// =============================================
// ROUTES
// =============================================

/**
 * Get all tier chatrooms
 * GET /api/community/tier-chatrooms
 */
router.get('/tier-chatrooms', authMiddleware, async (req, res) => {
  try {
    const { data: chatrooms, error } = await supabase
      .from('tier_chatrooms')
      .select('*')
      .eq('is_active', true)
      .order('min_trades', { ascending: true });

    if (error) {
      console.error('Error fetching tier chatrooms:', error);
      return res.status(500).json({ error: 'Failed to fetch chatrooms' });
    }

    res.json({ 
      success: true, 
      chatrooms: chatrooms || [] 
    });
  } catch (error) {
    console.error('Get tier chatrooms error:', error);
    res.status(500).json({ error: 'Failed to get chatrooms' });
  }
});

/**
 * Get user's current tier chatroom assignment
 * GET /api/community/my-tier-chatroom
 */
router.get('/my-tier-chatroom', authMiddleware, async (req, res) => {
  try {
    const derivId = req.username || req.userId;
    
    // Get user profile
    const profile = await getUserProfile(derivId);
    
    if (!profile) {
      return res.json({ 
        success: false, 
        assignment: null,
        message: 'Profile not found'
      });
    }

    // Get user's chatroom membership
    const { data: membership, error } = await supabase
      .from('chatroom_members')
      .select(`
        *,
        tier_chatrooms (*)
      `)
      .eq('user_id', profile.id)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching membership:', error);
    }

    res.json({
      success: !!membership,
      assignment: membership || null
    });
  } catch (error) {
    console.error('Get my tier chatroom error:', error);
    res.status(500).json({ error: 'Failed to get chatroom assignment' });
  }
});

/**
 * Assign user to tier chatroom based on analytics
 * POST /api/community/assign-tier
 */
router.post('/assign-tier', authMiddleware, async (req, res) => {
  try {
    const { winRate = 0, totalTrades = 0 } = req.body;
    const derivId = req.username || req.userId;
    
    // Get or create user profile
    const profile = await getOrCreateProfile(derivId, req.username);
    
    if (!profile) {
      return res.status(400).json({ 
        success: false, 
        error: 'Failed to get user profile' 
      });
    }

    // Calculate tier
    const tier = calculateTier(winRate, totalTrades);

    // Get the chatroom for this tier
    const { data: chatroom, error: chatroomError } = await supabase
      .from('tier_chatrooms')
      .select('*')
      .eq('tier', tier)
      .single();

    if (chatroomError || !chatroom) {
      console.error('Chatroom not found for tier:', tier, chatroomError);
      return res.status(404).json({ 
        success: false, 
        error: 'Chatroom not found for tier' 
      });
    }

    // Remove from any other tier chatrooms first
    await supabase
      .from('chatroom_members')
      .delete()
      .eq('user_id', profile.id);

    // Add to the correct tier chatroom
    const { error: insertError } = await supabase
      .from('chatroom_members')
      .upsert({
        chatroom_id: chatroom.id,
        user_id: profile.id,
        deriv_id: derivId,
        last_active: new Date().toISOString()
      }, {
        onConflict: 'chatroom_id,user_id'
      });

    if (insertError) {
      console.error('Error assigning to chatroom:', insertError);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to assign to chatroom' 
      });
    }

    // Update member count
    const { count } = await supabase
      .from('chatroom_members')
      .select('*', { count: 'exact', head: true })
      .eq('chatroom_id', chatroom.id);

    await supabase
      .from('tier_chatrooms')
      .update({ 
        member_count: count || 0,
        updated_at: new Date().toISOString()
      })
      .eq('id', chatroom.id);

    // Emit WebSocket event
    const io = getIo(req); if (io) {
      io.to(`tier:${tier}`).emit('member:joined', {
        chatroomId: chatroom.id,
        userId: profile.id,
        derivId: derivId
      });
    }

    res.json({
      success: true,
      tier,
      chatroom,
      assignment: {
        chatroom_id: chatroom.id,
        user_id: profile.id,
        tier_chatrooms: chatroom
      }
    });
  } catch (error) {
    console.error('Assign tier error:', error);
    res.status(500).json({ error: 'Failed to assign to tier chatroom' });
  }
});

/**
 * Get chatroom members
 * GET /api/community/tier-chatroom/:id/members
 */
router.get('/tier-chatroom/:id/members', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 50 } = req.query;

    const { data: members, error } = await supabase
      .from('chatroom_members')
      .select(`
        id,
        user_id,
        deriv_id,
        joined_at,
        last_active,
        role,
        user_profiles (
          id,
          deriv_id,
          username,
          fullname,
          profile_photo,
          is_online,
          win_rate,
          total_trades
        )
      `)
      .eq('chatroom_id', id)
      .order('last_active', { ascending: false })
      .limit(parseInt(limit));

    if (error) {
      console.error('Error fetching members:', error);
      return res.status(500).json({ error: 'Failed to fetch members' });
    }

    // Return in format frontend expects (with user_profiles nested)
    res.json({
      success: true,
      members: members || []
    });
  } catch (error) {
    console.error('Get members error:', error);
    res.status(500).json({ error: 'Failed to get members' });
  }
});

/**
 * Get chatroom messages
 * GET /api/community/tier-chatroom/:id/messages
 */
router.get('/tier-chatroom/:id/messages', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 50, before } = req.query;

    let query = supabase
      .from('chatroom_messages')
      .select(`
        id,
        chatroom_id,
        sender_id,
        message_text,
        message_type,
        file_name,
        file_type,
        file_size,
        file_url,
        reply_to_id,
        reactions,
        is_deleted,
        is_pinned,
        created_at,
        user_profiles!sender_id (
          id,
          deriv_id,
          username,
          fullname,
          profile_photo
        )
      `)
      .eq('chatroom_id', id)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (before) {
      query = query.lt('created_at', before);
    }

    const { data: messages, error } = await query;

    if (error) {
      console.error('Error fetching messages:', error);
      return res.status(500).json({ error: 'Failed to fetch messages' });
    }

    // Transform and reverse to get chronological order
    const transformedMessages = (messages || []).reverse().map(msg => ({
      id: msg.id,
      chatroomId: msg.chatroom_id,
      senderId: msg.sender_id,
      text: msg.message_text,
      type: msg.message_type,
      fileName: msg.file_name,
      fileType: msg.file_type,
      fileSize: msg.file_size,
      fileUrl: msg.file_url,
      replyToId: msg.reply_to_id,
      reactions: msg.reactions || {},
      isPinned: msg.is_pinned,
      createdAt: msg.created_at,
      sender: msg.user_profiles ? {
        id: msg.user_profiles.id,
        derivId: msg.user_profiles.deriv_id,
        username: msg.user_profiles.username,
        displayName: msg.user_profiles.fullname || msg.user_profiles.username,
        avatarUrl: msg.user_profiles.profile_photo
      } : null
    }));

    res.json({
      success: true,
      messages: transformedMessages
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

/**
 * Send a message to chatroom
 * POST /api/community/tier-chatroom/:id/message
 */
router.post('/tier-chatroom/:id/message', authMiddleware, async (req, res) => {
  try {
    const { id: chatroomId } = req.params;
    const { text, type = 'text', fileName, fileType, fileSize, fileUrl, replyToId } = req.body;
    const derivId = req.username || req.userId;

    // Get user profile
    const profile = await getUserProfile(derivId);
    
    if (!profile) {
      return res.status(400).json({ 
        success: false, 
        error: 'User profile not found' 
      });
    }

    // Check if user is a member of this chatroom
    const { data: membership } = await supabase
      .from('chatroom_members')
      .select('id')
      .eq('chatroom_id', chatroomId)
      .eq('user_id', profile.id)
      .single();

    if (!membership) {
      return res.status(403).json({ 
        success: false, 
        error: 'Not a member of this chatroom' 
      });
    }

    // Insert message
    const { data: message, error } = await supabase
      .from('chatroom_messages')
      .insert({
        chatroom_id: chatroomId,
        sender_id: profile.id,
        message_text: text,
        message_type: type,
        file_name: fileName,
        file_type: fileType,
        file_size: fileSize,
        file_url: fileUrl,
        reply_to_id: replyToId
      })
      .select(`
        *,
        user_profiles!sender_id (
          id,
          deriv_id,
          username,
          fullname,
          profile_photo
        )
      `)
      .single();

    if (error) {
      console.error('Error sending message:', error);
      return res.status(500).json({ error: 'Failed to send message' });
    }

    // Update last_active for the member
    await supabase
      .from('chatroom_members')
      .update({ last_active: new Date().toISOString() })
      .eq('chatroom_id', chatroomId)
      .eq('user_id', profile.id);

    const transformedMessage = {
      id: message.id,
      chatroomId: message.chatroom_id,
      senderId: message.sender_id,
      text: message.message_text,
      type: message.message_type,
      fileName: message.file_name,
      fileType: message.file_type,
      fileSize: message.file_size,
      fileUrl: message.file_url,
      replyToId: message.reply_to_id,
      reactions: message.reactions || {},
      isPinned: message.is_pinned,
      createdAt: message.created_at,
      sender: message.user_profiles ? {
        id: message.user_profiles.id,
        derivId: message.user_profiles.deriv_id,
        username: message.user_profiles.username,
        displayName: message.user_profiles.fullname || message.user_profiles.username,
        avatarUrl: message.user_profiles.profile_photo
      } : null
    };

    // Emit WebSocket event
    const io = getIo(req); if (io) {
      io.to(`chatroom:${chatroomId}`).emit('message:new', transformedMessage);
    }

    res.status(201).json({
      success: true,
      message: transformedMessage
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

/**
 * Add reaction to message
 * POST /api/community/tier-message/:id/reaction
 */
router.post('/tier-message/:id/reaction', authMiddleware, async (req, res) => {
  try {
    const { id: messageId } = req.params;
    const { emoji } = req.body;
    const derivId = req.username || req.userId;

    // Get user profile
    const profile = await getUserProfile(derivId);
    
    if (!profile) {
      return res.status(400).json({ error: 'User profile not found' });
    }

    // Get current message
    const { data: message, error: fetchError } = await supabase
      .from('chatroom_messages')
      .select('reactions, chatroom_id')
      .eq('id', messageId)
      .single();

    if (fetchError || !message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Update reactions
    const reactions = message.reactions || {};
    if (!reactions[emoji]) {
      reactions[emoji] = [];
    }

    const userIndex = reactions[emoji].indexOf(profile.id);
    if (userIndex === -1) {
      reactions[emoji].push(profile.id);
    } else {
      reactions[emoji].splice(userIndex, 1);
      if (reactions[emoji].length === 0) {
        delete reactions[emoji];
      }
    }

    // Save updated reactions
    const { error: updateError } = await supabase
      .from('chatroom_messages')
      .update({ reactions })
      .eq('id', messageId);

    if (updateError) {
      console.error('Error updating reaction:', updateError);
      return res.status(500).json({ error: 'Failed to update reaction' });
    }

    // Emit WebSocket event
    const io = getIo(req); if (io) {
      io.to(`chatroom:${message.chatroom_id}`).emit('message:reaction', {
        messageId,
        reactions,
        userId: profile.id,
        emoji
      });
    }

    res.json({ success: true, reactions });
  } catch (error) {
    console.error('Add reaction error:', error);
    res.status(500).json({ error: 'Failed to add reaction' });
  }
});

/**
 * Delete a message
 * DELETE /api/community/tier-message/:id
 */
router.delete('/tier-message/:id', authMiddleware, async (req, res) => {
  try {
    const { id: messageId } = req.params;
    const derivId = req.username || req.userId;

    // Get user profile
    const profile = await getUserProfile(derivId);
    
    if (!profile) {
      return res.status(400).json({ error: 'User profile not found' });
    }

    // Get message to verify ownership
    const { data: message, error: fetchError } = await supabase
      .from('chatroom_messages')
      .select('sender_id, chatroom_id')
      .eq('id', messageId)
      .single();

    if (fetchError || !message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (message.sender_id !== profile.id) {
      return res.status(403).json({ error: 'Cannot delete another user\'s message' });
    }

    // Soft delete the message
    const { error: deleteError } = await supabase
      .from('chatroom_messages')
      .update({ 
        is_deleted: true,
        deleted_by: profile.id
      })
      .eq('id', messageId);

    if (deleteError) {
      console.error('Error deleting message:', deleteError);
      return res.status(500).json({ error: 'Failed to delete message' });
    }

    // Emit WebSocket event
    const io = getIo(req); if (io) {
      io.to(`chatroom:${message.chatroom_id}`).emit('message:delete', {
        messageId,
        chatroomId: message.chatroom_id
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

/**
 * Set typing indicator
 * POST /api/community/tier-chatroom/:id/typing
 */
router.post('/tier-chatroom/:id/typing', authMiddleware, async (req, res) => {
  try {
    const { id: chatroomId } = req.params;
    const { isTyping } = req.body;
    const derivId = req.username || req.userId;

    // Emit WebSocket event only
    const io = getIo(req); if (io) {
      io.to(`chatroom:${chatroomId}`).emit('typing', {
        chatroomId,
        userId: derivId,
        isTyping
      });
    }

    res.json({ success: true });
  } catch (error) {
    res.json({ success: true }); // Silent fail for typing
  }
});

module.exports = router;
