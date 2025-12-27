

const { verifyTokenWithDetails } = require('../services/auth');

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  const { valid, decoded, error } = verifyTokenWithDetails(token);

  if (!valid) {
    console.error(`[AuthMiddleware] Token Rejected: ${error}`);
    return res.status(401).json({ error: `Invalid or expired token: ${error}` });
  }

  // DEBUG: Log decoded token contents
  console.log(`[AuthMiddleware] Decoded JWT:`, {
    userId: decoded.userId,
    username: decoded.username,
    role: decoded.role,
    is_admin: decoded.is_admin
  });
  req.userId = decoded.userId;
  req.username = decoded.username;
  req.user = {
    id: decoded.userId,
    derivId: decoded.username,
    username: decoded.username,
    role: decoded.role || 'user',
    is_admin: decoded.is_admin || false
  };
  next();
}

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
