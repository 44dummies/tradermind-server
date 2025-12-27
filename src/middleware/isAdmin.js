const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);

/**
 * Middleware to protect admin-only routes
 * Relies on authMiddleware to verify JWT
 * Single source of truth: Supabase user_profiles.is_admin
 */
const isAdmin = async (req, res, next) => {
  try {
    // req.userId should be set by authMiddleware
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - Auth required'
      });
    }

    // Check is_admin in database - SINGLE SOURCE OF TRUTH
    const { data: profile, error } = await supabase
      .from('user_profiles')
      .select('is_admin, deriv_id')
      .eq('id', req.userId)
      .single();

    if (error || !profile) {
      console.error('[isAdmin] Profile lookup error:', error);
      return res.status(403).json({
        success: false,
        error: 'Forbidden - Profile not found'
      });
    }

    // Check only database flag
    if (profile.is_admin !== true) {
      console.log(`[isAdmin]  Access denied for user ${req.userId} (deriv_id: ${profile.deriv_id}) - not admin`);
      return res.status(403).json({
        success: false,
        error: 'Forbidden - Admin access required'
      });
    }

    // Attach user info to request
    req.user = {
      userId: req.userId,
      isAdmin: true,
      derivAccountId: profile.deriv_id
    };

    console.log(`[isAdmin]  Admin access granted for ${req.userId}`);
    next();

  } catch (error) {
    console.error('[isAdmin] Middleware error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

module.exports = isAdmin;
