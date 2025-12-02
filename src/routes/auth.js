/**
 * Authentication Routes
 */

const express = require('express');
const { prisma } = require('../services/database');
const { generateTokens, verifyToken, verifyRefreshToken } = require('../services/auth');
const { autoAssignUserToChatrooms } = require('../services/assignment');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

/**
 * Register new user
 * POST /api/auth/register
 */
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, derivUserId, currency, country } = req.body;
    
    // Validate required fields
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required' });
    }
    
    // Validate username format
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({ 
        error: 'Username must be 3-20 characters and contain only letters, numbers, and underscores' 
      });
    }
    
    // Check if username exists
    const existingUsername = await prisma.user.findUnique({ where: { username } });
    if (existingUsername) {
      return res.status(400).json({ error: 'Username already taken' });
    }
    
    // Check if email exists
    const existingEmail = await prisma.user.findUnique({ where: { email } });
    if (existingEmail) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);
    
    // Create user
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
    
    // Auto-assign to chatrooms
    await autoAssignUserToChatrooms(user.id);
    
    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user.id, user.username);
    
    // Store refresh token
    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken }
    });
    
    res.status(201).json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      },
      accessToken,
      refreshToken
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

/**
 * Login
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    // Find user
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Check if banned
    if (user.isBanned) {
      return res.status(403).json({ error: 'Account suspended' });
    }
    
    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user.id, user.username);
    
    // Update user
    await prisma.user.update({
      where: { id: user.id },
      data: {
        refreshToken,
        isOnline: true,
        lastSeenAt: new Date()
      }
    });
    
    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl
      },
      accessToken,
      refreshToken
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * Login with Deriv OAuth
 * POST /api/auth/deriv
 */
router.post('/deriv', async (req, res) => {
  try {
    const { derivUserId, loginid, email, currency, country, fullname } = req.body;
    
    if (!derivUserId || !loginid) {
      return res.status(400).json({ error: 'Deriv user ID and login ID are required' });
    }
    
    // Find or create user
    let user = await prisma.user.findUnique({ where: { derivUserId } });
    
    if (!user) {
      // Create new user from Deriv login
      const username = `trader_${loginid}`;
      
      user = await prisma.user.create({
        data: {
          id: uuidv4(),
          username,
          displayName: fullname || username,
          email: email || `${loginid}@deriv.local`,
          passwordHash: '', // No password for OAuth users
          derivUserId,
          currency,
          country
        }
      });
      
      // Auto-assign to chatrooms
      await autoAssignUserToChatrooms(user.id);
    }
    
    // Check if banned
    if (user.isBanned) {
      return res.status(403).json({ error: 'Account suspended' });
    }
    
    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user.id, user.username);
    
    // Update user
    await prisma.user.update({
      where: { id: user.id },
      data: {
        refreshToken,
        isOnline: true,
        lastSeenAt: new Date(),
        currency,
        country
      }
    });
    
    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl
      },
      accessToken,
      refreshToken
    });
  } catch (error) {
    console.error('Deriv login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * Refresh token
 * POST /api/auth/refresh
 */
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }
    
    // Verify refresh token
    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
    
    // Find user and verify stored token
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    });
    
    if (!user || user.refreshToken !== refreshToken) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    
    // Generate new tokens
    const tokens = generateTokens(user.id, user.username);
    
    // Update stored refresh token
    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: tokens.refreshToken }
    });
    
    res.json(tokens);
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

/**
 * Logout
 * POST /api/auth/logout
 */
router.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(200).json({ success: true });
    }
    
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
    
    res.json({ success: true });
  } catch (error) {
    res.json({ success: true });
  }
});

/**
 * Get current user
 * GET /api/auth/me
 */
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
        createdAt: true
      }
    });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

module.exports = router;
