
const express = require('express');
const { prisma } = require('../services/database');
const { generateTokens, verifyToken, verifyRefreshToken } = require('../services/auth');
const { autoAssignUserToChatrooms } = require('../services/assignment');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// Cookie configuration for refresh token
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true, // Always secure for None
  sameSite: 'none', // Allow cross-site usage
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/',
  partitioned: true // CHIPS support for cross-site cookies
};


router.post('/register', async (req, res) => {
  try {
    const { username, email, password, derivUserId, currency, country } = req.body;


    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required' });
    }


    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({
        error: 'Username must be 3-20 characters and contain only letters, numbers, and underscores'
      });
    }


    const existingUsername = await prisma.user.findUnique({ where: { username } });
    if (existingUsername) {
      return res.status(400).json({ error: 'Username already taken' });
    }


    const existingEmail = await prisma.user.findUnique({ where: { email } });
    if (existingEmail) {
      return res.status(400).json({ error: 'Email already registered' });
    }


    const passwordHash = await bcrypt.hash(password, 12);


    const user = await prisma.user.create({
      data: {
        id: uuidv4(),
        username,
        displayName: username,
        email,
        passwordHash,
        derivUserId,
        currency,
        country
      }
    });


    await autoAssignUserToChatrooms(user.id);

    // New users start with 'user' role
    const { accessToken, refreshToken } = generateTokens(user.id, user.username, 'user', false);


    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken }
    });

    // Set refresh token as HttpOnly cookie
    res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS);

    res.status(201).json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      },
      accessToken,
      refreshToken // Return for fallback
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }


    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }


    if (user.isBanned) {
      return res.status(403).json({ error: 'Account suspended' });
    }


    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate tokens with role
    const userRole = user.isAdmin ? 'admin' : (user.role || 'user');
    const { accessToken, refreshToken } = generateTokens(user.id, user.username, userRole, user.isAdmin || false);


    await prisma.user.update({
      where: { id: user.id },
      data: {
        refreshToken,
        isOnline: true,
        lastSeenAt: new Date()
      }
    });

    // Set refresh token as HttpOnly cookie
    res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS);

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        userRole: userRole,
        role: userRole,
        is_admin: user.isAdmin || false
      },
      accessToken,
      refreshToken // Return for fallback
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/deriv', async (req, res) => {
  try {
    console.log('Deriv auth request body:', req.body);
    const { derivUserId, loginid, email, currency, country, fullname } = req.body;


    const derivId = derivUserId || loginid;

    console.log('Extracted values:', { derivUserId, loginid, derivId, email });

    if (!derivId) {
      console.error('Missing derivId. Request body:', req.body);
      return res.status(400).json({ error: 'Deriv user ID or login ID is required' });
    }

    console.log('Looking for user with derivId:', derivId);


    let user;
    try {
      user = await prisma.user.findUnique({ where: { derivId } });
      console.log('User lookup result:', user ? 'found' : 'not found');
    } catch (dbErr) {
      console.error('Database lookup error:', dbErr.message);
      throw dbErr;
    }

    if (!user) {
      console.log('Creating new user...');

      try {

        const username = derivId.replace(/[^a-z0-9_]/gi, '_').substring(0, 50);

        user = await prisma.user.create({
          data: {
            id: uuidv4(),
            derivId,
            username,
            email: email || null,
            fullName: fullname || null,
            country: country || null,
            traderLevel: 'beginner',
            isAdmin: false // New users are not admins by default - set via database
          }
        });
        console.log('User created:', user.id);
      } catch (createErr) {
        console.error('User creation error:', createErr.message);
        console.error('Create error details:', createErr);
        throw createErr;
      }


      await autoAssignUserToChatrooms(user.id);
    }
    // Admin status is read from database - no hardcoded overrides
    // OPTIONAL: Environment variable override for emergency admin access
    const envAdminIds = process.env.ADMIN_DERIV_IDS?.split(',').map(id => id.trim()) || [];
    const isEnvAdmin = envAdminIds.includes(derivId);
    if (isEnvAdmin && !user.isAdmin) {
      console.log(`[Auth] Environment variable override: granting admin to ${derivId}`);
      user.isAdmin = true;
      // Also update in database for persistence
      await prisma.user.update({
        where: { id: user.id },
        data: { isAdmin: true }
      });
    }


    if (user.isBanned) {
      return res.status(403).json({ error: 'Account suspended' });
    }

    // Generate tokens with role
    const userRole = user.isAdmin ? 'admin' : (user.role || 'user');
    const { accessToken, refreshToken } = generateTokens(user.id, user.derivId, userRole, user.isAdmin || false);

    // Update user status AND sync refresh token to prevent mismatch
    await prisma.user.update({
      where: { id: user.id },
      data: {
        refreshToken, // CRITICAL: Always sync refresh token to DB on login
        isOnline: true,
        lastSeen: new Date(),
        country: country || user.country
      }
    });

    // Set refresh token as HttpOnly cookie
    res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS);

    res.json({
      user: {
        id: user.id,
        derivId: user.derivId,
        email: user.email,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
        traderLevel: user.traderLevel,
        role: userRole,
        is_admin: user.isAdmin || false
      },
      accessToken,
      refreshToken // Return for fallback
    });
  } catch (error) {
    console.error('Deriv login error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      error: 'Login failed',
      details: error.message
    });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    // Simple approach: body token preferred, fallback to cookie
    const refreshToken = req.body?.refreshToken || req.cookies?.refreshToken;

    if (!refreshToken) {
      console.debug('[Auth] No refresh token in body or cookies');
      return res.status(401).json({ error: 'Refresh token required' });
    }

    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) {
      console.debug('[Auth] Invalid/expired refresh token');
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Check token matches DB
    if (user.refreshToken !== refreshToken) {
      console.warn(`[Auth] Token mismatch for ${user.username}`);
      return res.status(401).json({ error: 'Session expired - please log in again' });
    }

    // Generate tokens with role
    const userRole = user.isAdmin ? 'admin' : (user.role || 'user');

    // Check if token needs rotation (expiring within 24h)
    const tokenPayload = verifyRefreshToken(refreshToken);
    const currentExp = tokenPayload?.exp;
    const now = Math.floor(Date.now() / 1000);
    const ONE_DAY = 24 * 60 * 60;

    let newRefreshToken = refreshToken;
    let newAccessToken = '';

    // If token expires in less than 24h, Rotate it. Otherwise, reuse it (Sticky Session)
    if (currentExp && (currentExp - now) < ONE_DAY) {
      console.debug('[Auth] Refresh token expiring soon, rotating...');
      const tokens = generateTokens(user.id, user.username, userRole, user.isAdmin || false);
      newAccessToken = tokens.accessToken;
      newRefreshToken = tokens.refreshToken;

      // Update DB with new token
      await prisma.user.update({
        where: { id: user.id },
        data: { refreshToken: newRefreshToken }
      });
    } else {
      console.debug('[Auth] Refresh token valid, generating new access token only');
      const jwt = require('jsonwebtoken');
      const JWT_SECRET = process.env.JWT_SECRET;
      const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

      newAccessToken = jwt.sign(
        { userId: user.id, username: user.username, role: userRole, is_admin: user.isAdmin || false },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );
    }

    // Return both tokens in body (frontend stores in sessionStorage)
    res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = verifyToken(token);

      if (decoded) {
        await prisma.user.update({
          where: { id: decoded.userId },
          data: {
            refreshToken: null,
            isOnline: false,
            lastSeenAt: new Date()
          }
        });
      }
    }

    // Clear the refresh token cookie
    res.clearCookie('refreshToken', { path: '/' });
    res.json({ success: true });
  } catch (error) {
    // Clear cookie even on error
    res.clearCookie('refreshToken', { path: '/' });
    res.json({ success: true });
  }
});

router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);

    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        username: true,
        displayName: true,
        email: true,
        avatarUrl: true,
        derivUserId: true,
        currency: true,
        country: true,
        winRate: true,
        totalTrades: true,
        reputationScore: true,
        reputationScore: true,
        createdAt: true,
        role: true,
        isAdmin: true
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      ...user,
      is_admin: user.isAdmin || user.role === 'admin'
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

module.exports = router;
