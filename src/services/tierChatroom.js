

const { supabase } = require('../db/supabase');

async function getTierChatrooms() {
  const { data, error } = await supabase
    .from('tier_chatrooms')
    .select('*')
    .eq('is_active', true)
    .order('min_win_rate', { ascending: true });
  
  if (error) {
    console.error('Error fetching tier chatrooms:', error);
    return [];
  }
  
  return data || [];
}

async function getUserTierChatroom(userId) {
  const { data, error } = await supabase
    .from('chatroom_members')
    .select(`
      *,
      tier_chatrooms (*)
    `)
    .eq('user_id', userId)
    .single();
  
  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching user chatroom:', error);
  }
  
  return data;
}

async function isUserAlreadyAssigned(userId) {
  const { data, error } = await supabase
    .from('chatroom_members')
    .select('id, chatroom_id')
    .eq('user_id', userId)
    .limit(1);
  
  if (error) {
    console.error('Error checking user assignment:', error);
    return false;
  }
  
  return data && data.length > 0;
}

function calculateTier(winRate, totalTrades) {
  if (totalTrades >= 1000 && winRate >= 80) return 'master';
  if (totalTrades >= 500 && winRate >= 65) return 'expert';
  if (totalTrades >= 200 && winRate >= 55) return 'advanced';
  if (totalTrades >= 50 && winRate >= 45) return 'intermediate';
  return 'beginner';
}

async function assignUserToTierChatroom(userId, derivId, winRate = 0, totalTrades = 0, forceReassign = false) {
  
  if (!forceReassign) {
    const alreadyAssigned = await isUserAlreadyAssigned(userId);
    if (alreadyAssigned) {
      console.log(`User ${userId} already assigned to a chatroom, skipping assignment`);
      
      const currentAssignment = await getUserTierChatroom(userId);
      if (currentAssignment?.tier_chatrooms) {
        return { 
          chatroom: currentAssignment.tier_chatrooms, 
          member: currentAssignment, 
          tier: currentAssignment.tier_chatrooms.tier,
          alreadyAssigned: true 
        };
      }
    }
  }
  
  const tier = calculateTier(winRate, totalTrades);
  
  
  const { data: chatroom, error: chatroomError } = await supabase
    .from('tier_chatrooms')
    .select('*')
    .eq('tier', tier)
    .single();
  
  if (chatroomError || !chatroom) {
    console.error('Error finding tier chatroom:', chatroomError);
    return null;
  }
  
  
  if (forceReassign) {
    await supabase
      .from('chatroom_members')
      .delete()
      .eq('user_id', userId);
  }
  
  
  const { data: member, error: memberError } = await supabase
    .from('chatroom_members')
    .upsert({
      chatroom_id: chatroom.id,
      user_id: userId,
      deriv_id: derivId,
      last_active: new Date().toISOString()
    }, {
      onConflict: 'chatroom_id,user_id'
    })
    .select()
    .single();
  
  if (memberError) {
    console.error('Error assigning user to chatroom:', memberError);
    return null;
  }
  
  
  const { count } = await supabase
    .from('chatroom_members')
    .select('*', { count: 'exact', head: true })
    .eq('chatroom_id', chatroom.id);
  
  await supabase
    .from('tier_chatrooms')
    .update({ member_count: count })
    .eq('id', chatroom.id);
  
  return { chatroom, member, tier, alreadyAssigned: false };
}

async function getChatroomMembers(chatroomId, limit = 50) {
  const { data, error } = await supabase
    .from('chatroom_members')
    .select(`
      *,
      user_profiles (
        id,
        deriv_id,
        username,
        fullname,
        profile_photo,
        is_online,
        win_rate,
        total_trades,
        performance_tier
      )
    `)
    .eq('chatroom_id', chatroomId)
    .order('last_active', { ascending: false })
    .limit(limit);
  
  if (error) {
    console.error('Error fetching chatroom members:', error);
    return [];
  }
  
  return data || [];
}

async function getChatroomMessages(chatroomId, limit = 50, before = null) {
  let query = supabase
    .from('chatroom_messages')
    .select(`
      *,
      sender:user_profiles!sender_id (
        id,
        username,
        fullname,
        profile_photo,
        performance_tier
      ),
      reply_to:chatroom_messages!reply_to_id (
        id,
        message_text,
        sender:user_profiles!sender_id (username)
      )
    `)
    .eq('chatroom_id', chatroomId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(limit);
  
  if (before) {
    query = query.lt('created_at', before);
  }
  
  const { data, error } = await query;
  
  if (error) {
    console.error('Error fetching messages:', error);
    return [];
  }
  
  
  return (data || []).reverse();
}

async function sendMessage(chatroomId, senderId, messageData) {
  const { 
    text, 
    type = 'text', 
    fileName = null, 
    fileType = null, 
    fileSize = null,
    fileHash = null,
    fileUrl = null, 
    replyToId = null 
  } = messageData;
  
  const { data, error } = await supabase
    .from('chatroom_messages')
    .insert({
      chatroom_id: chatroomId,
      sender_id: senderId,
      message_text: text,
      message_type: type,
      file_name: fileName,
      file_type: fileType,
      file_size: fileSize,
      file_hash: fileHash,
      file_url: fileUrl, 
      reply_to_id: replyToId
    })
    .select(`
      *,
      sender:user_profiles!sender_id (
        id,
        username,
        fullname,
        profile_photo,
        performance_tier
      )
    `)
    .single();
  
  if (error) {
    console.error('Error sending message:', error);
    return { success: false, error: error.message };
  }
  
  
  await supabase
    .from('chatroom_members')
    .update({ last_active: new Date().toISOString() })
    .eq('chatroom_id', chatroomId)
    .eq('user_id', senderId);
  
  return { success: true, message: data };
}

async function addReaction(messageId, userId, emoji) {
  
  const { data: message, error: fetchError } = await supabase
    .from('chatroom_messages')
    .select('reactions')
    .eq('id', messageId)
    .single();
  
  if (fetchError) {
    return { success: false, error: 'Message not found' };
  }
  
  const reactions = message.reactions || {};
  
  
  if (!reactions[emoji]) {
    reactions[emoji] = [];
  }
  
  const userIndex = reactions[emoji].indexOf(userId);
  if (userIndex > -1) {
    reactions[emoji].splice(userIndex, 1);
    if (reactions[emoji].length === 0) {
      delete reactions[emoji];
    }
  } else {
    reactions[emoji].push(userId);
  }
  
  const { error: updateError } = await supabase
    .from('chatroom_messages')
    .update({ reactions })
    .eq('id', messageId);
  
  if (updateError) {
    return { success: false, error: updateError.message };
  }
  
  return { success: true, reactions };
}

async function deleteMessage(messageId, userId, isAdmin = false) {
  
  const { data: message } = await supabase
    .from('chatroom_messages')
    .select('sender_id')
    .eq('id', messageId)
    .single();
  
  if (!message) {
    return { success: false, error: 'Message not found' };
  }
  
  if (message.sender_id !== userId && !isAdmin) {
    return { success: false, error: 'Unauthorized' };
  }
  
  const { error } = await supabase
    .from('chatroom_messages')
    .update({ 
      is_deleted: true, 
      deleted_by: userId,
      message_text: '[Message deleted]'
    })
    .eq('id', messageId);
  
  if (error) {
    return { success: false, error: error.message };
  }
  
  return { success: true };
}

async function togglePinMessage(messageId, userId) {
  
  const { data: member } = await supabase
    .from('chatroom_members')
    .select('role')
    .eq('user_id', userId)
    .single();
  
  if (!member || !['moderator', 'admin'].includes(member.role)) {
    return { success: false, error: 'Unauthorized' };
  }
  
  const { data: message } = await supabase
    .from('chatroom_messages')
    .select('is_pinned')
    .eq('id', messageId)
    .single();
  
  const { error } = await supabase
    .from('chatroom_messages')
    .update({ is_pinned: !message.is_pinned })
    .eq('id', messageId);
  
  if (error) {
    return { success: false, error: error.message };
  }
  
  return { success: true, isPinned: !message.is_pinned };
}

async function setTyping(chatroomId, userId, isTyping) {
  if (isTyping) {
    await supabase
      .from('chatroom_typing')
      .upsert({
        chatroom_id: chatroomId,
        user_id: userId,
        started_at: new Date().toISOString()
      });
  } else {
    await supabase
      .from('chatroom_typing')
      .delete()
      .eq('chatroom_id', chatroomId)
      .eq('user_id', userId);
  }
}

async function getTypingUsers(chatroomId) {
  
  const fiveSecondsAgo = new Date(Date.now() - 5000).toISOString();
  
  const { data } = await supabase
    .from('chatroom_typing')
    .select(`
      user_id,
      user_profiles!user_id (username)
    `)
    .eq('chatroom_id', chatroomId)
    .gte('started_at', fiveSecondsAgo);
  
  return data || [];
}

async function updateUserOnlineStatus(userId, isOnline) {
  await supabase
    .from('user_profiles')
    .update({ 
      is_online: isOnline,
      last_seen: new Date().toISOString()
    })
    .eq('id', userId);
}

async function getChatroomOnlineCount(chatroomId) {
  const { count } = await supabase
    .from('chatroom_members')
    .select('*', { count: 'exact', head: true })
    .eq('chatroom_id', chatroomId)
    .eq('user_profiles.is_online', true);
  
  return count || 0;
}

module.exports = {
  getTierChatrooms,
  getUserTierChatroom,
  isUserAlreadyAssigned,
  calculateTier,
  assignUserToTierChatroom,
  getChatroomMembers,
  getChatroomMessages,
  sendMessage,
  addReaction,
  deleteMessage,
  togglePinMessage,
  setTyping,
  getTypingUsers,
  updateUserOnlineStatus,
  getChatroomOnlineCount
};
