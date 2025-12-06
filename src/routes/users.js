

const express = require('express');
const multer = require('multer');
const { 
  getUserProfile,
  getProfileByDerivId,
  upsertUserProfile,
  updateUserProfile,
  saveProfilePicture,
  deleteProfilePicture,
  searchUsersByUsername,
  getPublicProfile
} = require('../services/profile');
const { authMiddleware } = require('../middleware/auth');
const { supabase } = require('../db/supabase');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const derivId = req.user?.derivId || req.username;
    console.log('[Users] GET /me - derivId:', derivId);
    
    
    let profile = await getProfileByDerivId(derivId);
    
    
    if (!profile) {
      profile = await getUserProfile(req.userId);
    }
    
    if (!profile) {
      
      console.log('[Users] Creating profile for:', derivId);
      profile = await upsertUserProfile(derivId, {
        username: `trader_${derivId.toLowerCase().slice(0, 8)}`,
        display_name: derivId,
        fullname: derivId
      });
    }
    
    res.json(profile);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

router.put('/me', authMiddleware, async (req, res) => {
  try {
    const derivId = req.user?.derivId || req.username;
    console.log('[Users] PUT /me - derivId:', derivId);
    console.log('[Users] PUT /me - body:', JSON.stringify(req.body));
    
    if (!derivId) {
      return res.status(400).json({ error: 'No derivId found in token' });
    }
    
    
    const updateData = {};
    if (req.body.username !== undefined) updateData.username = req.body.username;
    if (req.body.display_name !== undefined) updateData.display_name = req.body.display_name;
    if (req.body.fullname !== undefined) updateData.fullname = req.body.fullname;
    if (req.body.bio !== undefined) updateData.bio = req.body.bio;
    if (req.body.profile_photo !== undefined) updateData.profile_photo = req.body.profile_photo;
    if (req.body.status_message !== undefined) updateData.status_message = req.body.status_message;
    updateData.updated_at = new Date().toISOString();
    
    console.log('[Users] Update data:', JSON.stringify(updateData));
    
    
    const { data: profile, error } = await supabase
      .from('user_profiles')
      .update(updateData)
      .eq('deriv_id', derivId)
      .select()
      .single();
    
    if (error) {
      
      if (error.code === 'PGRST116') {
        console.log('[Users] Profile not found, creating new one');
        const { data: newProfile, error: createError } = await supabase
          .from('user_profiles')
          .insert({
            deriv_id: derivId,
            username: req.body.username || `trader_${derivId.toLowerCase().slice(0, 8)}`,
            display_name: req.body.display_name || derivId,
            fullname: req.body.fullname || req.body.display_name || derivId,
            bio: req.body.bio || '',
            profile_photo: req.body.profile_photo || '',
            performance_tier: 'beginner',
            is_online: true,
            last_seen_at: new Date().toISOString()
          })
          .select()
          .single();
        
        if (createError) {
          console.error('[Users] Create profile error:', createError);
          return res.status(500).json({ error: 'Failed to create profile', details: createError.message });
        }
        
        console.log('[Users] Profile created:', newProfile?.id);
        return res.json(newProfile);
      }
      
      console.error('[Users] Update error:', error);
      return res.status(500).json({ error: 'Failed to update profile', details: error.message });
    }
    
    console.log('[Users] Profile updated:', profile?.id);
    res.json(profile);
  } catch (error) {
    console.error('[Users] Exception:', error);
    res.status(500).json({ error: 'Failed to update profile', details: error.message });
  }
});

router.post('/me/avatar', authMiddleware, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }
    
    console.log('[Avatar] Uploading for user:', req.userId, 'File size:', req.file.size);
    const avatarUrl = await saveProfilePicture(req.userId, req.file);
    console.log('[Avatar] Upload successful, URL length:', avatarUrl?.length);
    
    res.json({ avatarUrl });
  } catch (error) {
    console.error('Upload avatar error:', error);
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

router.delete('/me/avatar', authMiddleware, async (req, res) => {
  try {
    await deleteProfilePicture(req.userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete avatar error:', error);
    res.status(500).json({ error: 'Failed to delete avatar' });
  }
});

router.get('/search', authMiddleware, async (req, res) => {
  try {
    const { q, limit } = req.query;
    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }
    const users = await searchUsersByUsername(q, parseInt(limit) || 20, req.userId);
    res.json(users);
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

router.get('/check-username/:username', authMiddleware, async (req, res) => {
  try {
    const { username } = req.params;
    
    if (!username || username.length < 3) {
      return res.json({ available: false, error: 'Username too short' });
    }
    
    
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, deriv_id')
      .eq('username', username.toLowerCase())
      .single();
    
    if (error && error.code === 'PGRST116') {
      
      return res.json({ available: true });
    }
    
    if (error) {
      throw error;
    }
    
    
    const isOwnUsername = data.deriv_id === req.user?.derivId || data.id === req.userId;
    
    res.json({ available: isOwnUsername });
  } catch (error) {
    console.error('Check username error:', error);
    res.status(500).json({ error: 'Failed to check username' });
  }
});

router.put('/me/profile', authMiddleware, async (req, res) => {
  try {
    const { username, display_name, bio, status_message } = req.body;
    
    
    if (username) {
      if (username.length < 3 || username.length > 20) {
        return res.status(400).json({ error: 'Username must be 3-20 characters' });
      }
      if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return res.status(400).json({ error: 'Invalid username format' });
      }
      
      
      const { data: existing } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('username', username.toLowerCase())
        .neq('id', req.userId)
        .single();
      
      if (existing) {
        return res.status(400).json({ error: 'Username is already taken' });
      }
    }
    
    const profile = await updateUserProfile(req.userId, {
      username: username?.toLowerCase(),
      display_name,
      bio,
      status_message,
    });
    
    res.json({ success: true, profile });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.put('/me/username', authMiddleware, async (req, res) => {
  try {
    const { username } = req.body;
    
    if (!username || username.length < 3 || username.length > 20) {
      return res.status(400).json({ error: 'Username must be 3-20 characters' });
    }
    
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ error: 'Invalid username format' });
    }
    
    
    const { data: existing } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('username', username.toLowerCase())
      .neq('id', req.userId)
      .single();
    
    if (existing) {
      return res.status(400).json({ error: 'Username is already taken' });
    }
    
    await updateUserProfile(req.userId, { username: username.toLowerCase() });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Update username error:', error);
    res.status(500).json({ error: 'Failed to update username' });
  }
});

router.get('/settings', authMiddleware, async (req, res) => {
  try {
    console.log('GET /settings - User:', req.user);
    
    
    let user = await getProfileByDerivId(req.user.derivId);
    
    console.log('Profile found:', user ? user.id : 'null');
    
    
    if (!user) {
      console.log('User not found, creating profile for:', req.user.derivId);
      user = await upsertUserProfile(req.user.derivId, {
        username: `trader_${req.user.derivId.toLowerCase().slice(0, 8)}`,
        fullname: null,
        email: null,
        country: null
      });
      console.log('Created user:', user.id);
    }

    
    const { data: settings, error: settingsError } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .single();
    
    if (settingsError && settingsError.code !== 'PGRST116') {
      console.error('Settings query error:', settingsError);
    }

    res.json({
      profile: {
        username: user.username,
        display_name: user.display_name || user.fullname,
        fullname: user.fullname,
        bio: user.bio || '',
        status_message: user.status_message || '',
        profile_photo: user.profile_photo,
        profile_photo_metadata: user.profile_photo_metadata,
        email: user.email,
        country: user.country,
        deriv_id: user.deriv_id,
        performance_tier: user.performance_tier,
        is_profile_complete: user.is_profile_complete || false,
        is_admin: user.is_admin || false,
        role: user.role || 'user',
      },
      privacy: settings?.privacy || {
        showUsername: true,
        showRealName: false,
        showEmail: false,
        showCountry: true,
        showPerformance: true,
        showOnlineStatus: true,
        profileVisibility: 'public',
      },
      notifications: settings?.notifications || {
        messages: true,
        chatMentions: true,
        achievements: true,
        streakReminders: true,
        communityUpdates: true,
        soundEnabled: true,
        pushEnabled: false,
      },
      chat: settings?.chat || {
        enterToSend: true,
        showTypingIndicator: true,
        showReadReceipts: true,
        autoDeleteMessages: false,
        messageRetention: 30,
      },
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

router.put('/settings', authMiddleware, async (req, res) => {
  try {
    const { profile, privacy, notifications, chat } = req.body;
    
    
    let user = await getProfileByDerivId(req.user.derivId);
    if (!user) {
      console.log('User not found during settings update, creating profile for:', req.user.derivId);
      user = await upsertUserProfile(req.user.derivId, {
        username: `trader_${req.user.derivId.toLowerCase().slice(0, 8)}`,
        fullname: null,
        email: null,
        country: null
      });
    }

    
    if (profile?.username && profile.username.toLowerCase() !== user.username?.toLowerCase()) {
      const { data: existingUser } = await supabase
        .from('user_profiles')
        .select('id')
        .ilike('username', profile.username)
        .neq('id', user.id)
        .single();
      
      if (existingUser) {
        return res.status(400).json({ error: 'Username already taken' });
      }
    }

    
    if (profile) {
      const profileUpdate = {
        updated_at: new Date().toISOString()
      };
      if (profile.username) profileUpdate.username = profile.username.toLowerCase();
      if (profile.display_name !== undefined) profileUpdate.display_name = profile.display_name;
      if (profile.fullname !== undefined) profileUpdate.fullname = profile.fullname;
      if (profile.bio !== undefined) profileUpdate.bio = profile.bio;
      if (profile.status_message !== undefined) profileUpdate.status_message = profile.status_message;
      if (profile.profile_photo !== undefined) profileUpdate.profile_photo = profile.profile_photo;
      if (profile.profile_photo_metadata !== undefined) {
        profileUpdate.profile_photo_metadata = profile.profile_photo_metadata;
      }

      console.log('Updating profile for user:', user.id);
      
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update(profileUpdate)
        .eq('id', user.id);
      
      if (updateError) {
        console.error('Profile update error:', updateError);
        throw updateError;
      }
    }

    
    const settingsData = {
      user_id: user.id,
      privacy: privacy || {},
      notifications: notifications || {},
      chat: chat || {},
      updated_at: new Date().toISOString(),
    };

    console.log('Upserting settings for user:', user.id);
    
    const { error: settingsError } = await supabase
      .from('user_settings')
      .upsert(settingsData, { onConflict: 'user_id' });
    
    if (settingsError) {
      console.error('Settings upsert error:', settingsError);
      throw settingsError;
    }

    res.json({ success: true, message: 'Settings updated successfully' });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Failed to update settings: ' + error.message });
  }
});

router.get('/check-username/:username', authMiddleware, async (req, res) => {
  try {
    const username = req.params.username.toLowerCase();
    
    
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.json({ available: false, reason: 'Invalid format' });
    }

    const { data: existingUser } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('username', username)
      .single();

    res.json({ 
      available: !existingUser,
      reason: existingUser ? 'Username taken' : null
    });
  } catch (error) {
    console.error('Check username error:', error);
    res.status(500).json({ error: 'Failed to check username' });
  }
});

router.get('/:username', authMiddleware, async (req, res) => {
  try {
    const profile = await getPublicProfile(req.params.username);
    if (!profile) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(profile);
  } catch (error) {
    console.error('Get public profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

module.exports = router;
