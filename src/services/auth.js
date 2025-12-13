const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const JWT_REFRESH_EXPIRES_IN = '7d';

if (!JWT_SECRET) {
  console.error('⚠️ JWT_SECRET environment variable is missing - auth will fail');
}
if (!JWT_REFRESH_SECRET) {
  console.error('⚠️ JWT_REFRESH_SECRET environment variable is missing - auth will fail');
}

function generateToken(payload) {
  if (!JWT_SECRET) throw new Error('JWT_SECRET not configured');
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function generateTokens(userId, username, role = 'user', isAdmin = false) {
  const accessToken = jwt.sign(
    { userId, username, role, is_admin: isAdmin },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  const refreshToken = jwt.sign(
    { userId, username, role, is_admin: isAdmin, type: 'refresh' },
    JWT_REFRESH_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRES_IN }
  );

  return { accessToken, refreshToken };
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET);
  } catch (error) {
    return null;
  }
}

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
  generateTokens,
  verifyToken,
  verifyRefreshToken,
  authMiddleware,
  socketAuthMiddleware
};
