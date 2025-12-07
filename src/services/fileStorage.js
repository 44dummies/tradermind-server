

const { supabase } = require('../db/supabase');
const crypto = require('crypto');
const path = require('path');

const CHAT_FILES_BUCKET = 'chat-files';
const VOICE_NOTES_BUCKET = 'voice-notes';
const CHATROOM_FILES_BUCKET = 'chatroom-files';
const PROFILE_PHOTOS_BUCKET = 'profile-photos';

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; 
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; 
const MAX_VOICE_SIZE = 5 * 1024 * 1024; 
const MAX_FILE_SIZE = 25 * 1024 * 1024; 

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const ALLOWED_AUDIO_TYPES = ['audio/webm', 'audio/mp3', 'audio/mpeg', 'audio/ogg', 'audio/wav'];
const ALLOWED_DOCUMENT_TYPES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

async function initializeStorageBuckets() {
  const buckets = [
    { name: CHAT_FILES_BUCKET, public: true },
    { name: VOICE_NOTES_BUCKET, public: true },
    { name: CHATROOM_FILES_BUCKET, public: true },
    { name: PROFILE_PHOTOS_BUCKET, public: true }
  ];
  
  for (const bucket of buckets) {
    try {
      const { data: existingBuckets } = await supabase.storage.listBuckets();
      const bucketExists = existingBuckets?.some(b => b.name === bucket.name);
      
      if (!bucketExists) {
        const { error } = await supabase.storage.createBucket(bucket.name, {
          public: bucket.public,
          fileSizeLimit: MAX_FILE_SIZE
        });
        
        if (error && !error.message.includes('already exists')) {
          console.error(`Failed to create bucket ${bucket.name}:`, error);
        } else {
          console.log(`Storage bucket ${bucket.name} created/verified`);
        }
      } else {
        console.log(`Storage bucket ${bucket.name} already exists`);
      }
    } catch (err) {
      console.error(`Error checking/creating bucket ${bucket.name}:`, err);
    }
  }
}

function generateFileName(originalName, userId) {
  const timestamp = Date.now();
  const randomBytes = crypto.randomBytes(8).toString('hex');
  const ext = path.extname(originalName);
  const baseName = path.basename(originalName, ext).substring(0, 20).replace(/[^a-zA-Z0-9]/g, '_');
  return `${userId.substring(0, 8)}/${timestamp}-${randomBytes}-${baseName}${ext}`;
}

function validateFile(file, type) {
  const { mimetype, size } = file;
  
  let allowedTypes = [];
  let maxSize = MAX_FILE_SIZE;
  
  switch (type) {
    case 'image':
      allowedTypes = ALLOWED_IMAGE_TYPES;
      maxSize = MAX_IMAGE_SIZE;
      break;
    case 'video':
      allowedTypes = ALLOWED_VIDEO_TYPES;
      maxSize = MAX_VIDEO_SIZE;
      break;
    case 'voice':
    case 'audio':
      allowedTypes = ALLOWED_AUDIO_TYPES;
      maxSize = MAX_VOICE_SIZE;
      break;
    case 'document':
      allowedTypes = ALLOWED_DOCUMENT_TYPES;
      maxSize = MAX_FILE_SIZE;
      break;
    default:
      allowedTypes = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES, ...ALLOWED_AUDIO_TYPES, ...ALLOWED_DOCUMENT_TYPES];
  }
  
  if (!allowedTypes.includes(mimetype)) {
    return { valid: false, error: `File type ${mimetype} not allowed for ${type}` };
  }
  
  if (size > maxSize) {
    return { valid: false, error: `File size ${(size / 1024 / 1024).toFixed(2)}MB exceeds limit of ${(maxSize / 1024 / 1024).toFixed(2)}MB` };
  }
  
  return { valid: true };
}

async function uploadFile(file, userId, context = 'chat') {
  try {
    
    let bucket = CHAT_FILES_BUCKET;
    if (context === 'chatroom') {
      bucket = CHATROOM_FILES_BUCKET;
    } else if (context === 'voice') {
      bucket = VOICE_NOTES_BUCKET;
    }
    
    
    let fileType = 'file';
    if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      fileType = 'image';
    } else if (ALLOWED_VIDEO_TYPES.includes(file.mimetype)) {
      fileType = 'video';
    } else if (ALLOWED_AUDIO_TYPES.includes(file.mimetype)) {
      fileType = 'voice';
    }
    
    
    const validation = validateFile(file, fileType);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    
    
    const filePath = generateFileName(file.originalname, userId);
    
    
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });
    
    if (error) {
      console.error('Supabase storage upload error:', error);
      return { success: false, error: error.message };
    }
    
    
    const { data: urlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(filePath);
    
    
    const fileHash = crypto.createHash('sha256').update(file.buffer).digest('hex');
    
    return {
      success: true,
      url: urlData.publicUrl,
      fileName: file.originalname,
      fileType: file.mimetype,
      fileSize: file.size,
      fileHash,
      storagePath: data.path
    };
  } catch (error) {
    console.error('File upload error:', error);
    return { success: false, error: 'Failed to upload file' };
  }
}

async function deleteFile(storagePath, context = 'chat') {
  try {
    let bucket = CHAT_FILES_BUCKET;
    if (context === 'chatroom') {
      bucket = CHATROOM_FILES_BUCKET;
    } else if (context === 'voice') {
      bucket = VOICE_NOTES_BUCKET;
    }
    
    const { error } = await supabase.storage
      .from(bucket)
      .remove([storagePath]);
    
    if (error) {
      console.error('Delete file error:', error);
      return { success: false, error: error.message };
    }
    
    return { success: true };
  } catch (error) {
    console.error('Delete file error:', error);
    return { success: false, error: 'Failed to delete file' };
  }
}

async function getSignedUrl(storagePath, context = 'chat', expiresIn = 3600) {
  try {
    let bucket = CHAT_FILES_BUCKET;
    if (context === 'chatroom') {
      bucket = CHATROOM_FILES_BUCKET;
    } else if (context === 'voice') {
      bucket = VOICE_NOTES_BUCKET;
    }
    
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(storagePath, expiresIn);
    
    if (error) {
      return { success: false, error: error.message };
    }
    
    return { success: true, url: data.signedUrl };
  } catch (error) {
    return { success: false, error: 'Failed to get signed URL' };
  }
}

async function uploadProfilePhoto(file, userId) {
  try {
    
    if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      return { success: false, error: 'Only image files are allowed for profile photos' };
    }
    
    
    if (file.size > 5 * 1024 * 1024) {
      return { success: false, error: 'Profile photo must be less than 5MB' };
    }
    
    
    const ext = path.extname(file.originalname) || '.jpg';
    const filePath = `${userId}/avatar${ext}`;
    
    
    try {
      const { data: existingFiles } = await supabase.storage
        .from(PROFILE_PHOTOS_BUCKET)
        .list(userId);
      
      if (existingFiles && existingFiles.length > 0) {
        const filesToDelete = existingFiles.map(f => `${userId}/${f.name}`);
        await supabase.storage.from(PROFILE_PHOTOS_BUCKET).remove(filesToDelete);
      }
    } catch (err) {
      
      console.log('[Profile] Could not delete old photos:', err.message);
    }
    
    
    const { data, error } = await supabase.storage
      .from(PROFILE_PHOTOS_BUCKET)
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: true 
      });
    
    if (error) {
      console.error('[Profile] Storage upload error:', error);
      return { success: false, error: error.message };
    }
    
    
    const { data: urlData } = supabase.storage
      .from(PROFILE_PHOTOS_BUCKET)
      .getPublicUrl(filePath);
    
    
    const publicUrl = `${urlData.publicUrl}?v=${Date.now()}`;
    
    return {
      success: true,
      url: publicUrl,
      storagePath: data.path
    };
  } catch (error) {
    console.error('[Profile] Photo upload error:', error);
    return { success: false, error: 'Failed to upload profile photo' };
  }
}

async function deleteProfilePhoto(userId) {
  try {
    const { data: existingFiles } = await supabase.storage
      .from(PROFILE_PHOTOS_BUCKET)
      .list(userId);
    
    if (existingFiles && existingFiles.length > 0) {
      const filesToDelete = existingFiles.map(f => `${userId}/${f.name}`);
      await supabase.storage.from(PROFILE_PHOTOS_BUCKET).remove(filesToDelete);
    }
    
    return { success: true };
  } catch (error) {
    console.error('[Profile] Delete photo error:', error);
    return { success: false, error: 'Failed to delete profile photo' };
  }
}

module.exports = {
  initializeStorageBuckets,
  uploadFile,
  deleteFile,
  getSignedUrl,
  uploadProfilePhoto,
  deleteProfilePhoto,
  CHAT_FILES_BUCKET,
  VOICE_NOTES_BUCKET,
  CHATROOM_FILES_BUCKET,
  PROFILE_PHOTOS_BUCKET
};
