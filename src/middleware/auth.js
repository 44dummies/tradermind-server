/**
 * Authentication Middleware
 */

const { verifyToken } = require('../services/auth');

/**
 * Middleware to verify JWT token
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);
  
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  
  // The token contains: userId (UUID) and username (which is actually the derivId like CR6550175)
  // Set both formats for compatibility
  req.userId = decoded.userId;
  req.username = decoded.username;
  req.user = {
    id: decoded.userId,
    derivId: decoded.username,  // username in token IS the derivId
    username: decoded.username
  };
  next();
}

/**
 * Optional auth middleware - doesn't fail if no token
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    
    if (decoded) {
      req.userId = decoded.userId;
      req.username = decoded.username;
    }
  }
  
  next();
}

module.exports = { authMiddleware, optionalAuth };
