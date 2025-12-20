const express = require('express');
const router = express.Router();
const isUser = require('../../middleware/isUser');

// Import sub-routers
const sessionRoutes = require('./sessions');
const statsRoutes = require('./stats');
const notificationRoutes = require('./notifications');

// Mount sub-routers
// These will be prefixed by /api/user (as mounted in index.js)
router.use('/sessions', sessionRoutes);
router.use('/stats', statsRoutes);
router.use('/notifications', notificationRoutes);

// Export the router
module.exports = router;
