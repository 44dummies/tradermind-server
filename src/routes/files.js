

const express = require('express');
const multer = require('multer');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { uploadFile, deleteFile } = require('../services/fileStorage');
const { getProfileByDerivId, upsertUserProfile } = require('../services/profile');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, 
    files: 5 
  },
  fileFilter: (req, file, cb) => {
    
    const allowedTypes = [
      
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      
      'video/mp4', 'video/webm', 'video/quicktime',
      
      'audio/webm', 'audio/mp3', 'audio/mpeg', 'audio/ogg', 'audio/wav',
      
      'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`), false);
    }
  }
});

router.use(authMiddleware);

async function getOrCreateUser(derivId) {
  let user = await getProfileByDerivId(derivId);
  if (!user) {
    user = await upsertUserProfile(derivId, {
      username: `trader_${derivId.toLowerCase().slice(0, 8)}`,
      fullname: null,
      email: null,
      country: null
    });
  }
  return user;
}

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }
    
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(500).json({ error: 'Failed to get/create user' });
    }
    
    const context = req.query.context || req.body.context || 'chat';
    
    const result = await uploadFile(req.file, currentUser.id, context);
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json({
      success: true,
      file: {
        url: result.url,
        fileName: result.fileName,
        fileType: result.fileType,
        fileSize: result.fileSize,
        fileHash: result.fileHash
      }
    });
  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

router.post('/upload-multiple', upload.array('files', 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }
    
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(500).json({ error: 'Failed to get/create user' });
    }
    
    const context = req.query.context || req.body.context || 'chat';
    
    const results = await Promise.all(
      req.files.map(file => uploadFile(file, currentUser.id, context))
    );
    
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    res.json({
      success: true,
      uploaded: successful.length,
      failed: failed.length,
      files: successful.map(r => ({
        url: r.url,
        fileName: r.fileName,
        fileType: r.fileType,
        fileSize: r.fileSize,
        fileHash: r.fileHash
      })),
      errors: failed.map(r => r.error)
    });
  } catch (error) {
    console.error('Multiple file upload error:', error);
    res.status(500).json({ error: 'Failed to upload files' });
  }
});

router.post('/voice', upload.single('voice'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No voice file provided' });
    }
    
    
    if (!req.file.mimetype.startsWith('audio/')) {
      return res.status(400).json({ error: 'File must be an audio file' });
    }
    
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(500).json({ error: 'Failed to get/create user' });
    }
    
    const result = await uploadFile(req.file, currentUser.id, 'voice');
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json({
      success: true,
      voice: {
        url: result.url,
        fileName: result.fileName,
        fileType: result.fileType,
        fileSize: result.fileSize,
        duration: req.body.duration || null 
      }
    });
  } catch (error) {
    console.error('Voice upload error:', error);
    res.status(500).json({ error: 'Failed to upload voice note' });
  }
});

router.delete('/:storagePath(*)', async (req, res) => {
  try {
    const { storagePath } = req.params;
    const context = req.query.context || 'chat';
    
    const currentUser = await getOrCreateUser(req.user.derivId);
    if (!currentUser) {
      return res.status(500).json({ error: 'Failed to get/create user' });
    }
    
    
    const userIdFragment = currentUser.id.substring(0, 8);
    if (!storagePath.startsWith(userIdFragment)) {
      return res.status(403).json({ error: 'You can only delete your own files' });
    }
    
    const result = await deleteFile(storagePath, context);
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('File delete error:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 50MB' });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files. Maximum is 5 files at once' });
    }
    return res.status(400).json({ error: error.message });
  }
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  next();
});

module.exports = router;
