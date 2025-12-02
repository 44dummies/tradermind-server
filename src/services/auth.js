/**
 * JWT Authentication Service
 */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

/**
 * Generate JWT token
 */
function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Verify JWT token
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

/**
 * Express middleware to authenticate requests
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: { message: 'No token provided', code: 'NO_TOKEN' } });
  }
  
  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);
  
  if (!decoded) {
    return res.status(401).json({ error: { message: 'Invalid token', code: 'INVALID_TOKEN' } });
  }
  
  req.user = decoded;
  next();
}

/**
 * Socket.IO authentication middleware
 */
function socketAuthMiddleware(socket, next) {
  const token = socket.handshake.auth.token || socket.handshake.query.token;
  
  if (!token) {
    return next(new Error('Authentication required'));
  }
  
  const decoded = verifyToken(token);
  
  if (!decoded) {
    return next(new Error('Invalid token'));
  }
  
  socket.user = decoded;
  next();
}

module.exports = {
  generateToken,
  verifyToken,
  authMiddleware,
  socketAuthMiddleware
};
