const express = require('express');
const router = express.Router();

// Import modular routes
const botRoutes = require('./bot');
const sessionRoutes = require('./sessions');
const statsRoutes = require('./stats');
const notificationRoutes = require('./notifications');
const logsRoutes = require('./logs');
const recoveryRoutes = require('./recovery');
const usersRoutes = require('./users');

// Mount routes
router.use('/bot', botRoutes);
router.use('/sessions', sessionRoutes);
router.use('/stats', statsRoutes);
router.use('/notifications', notificationRoutes);
router.use('/logs', logsRoutes);
router.use('/recovery', recoveryRoutes);
router.use('/users', usersRoutes);

module.exports = router;
