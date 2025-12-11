const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);

/**
 * Middleware to protect admin-only routes
 * Verifies JWT and checks is_admin flag in user_profiles
 * 
 * Single source of truth: Supabase user_profiles.is_admin
 */
const isAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - No token provided'
      });
    }

    const token = authHeader.split(' ')[1];

    // Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded || !decoded.userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - Invalid token'
      });
    }

    // Check is_admin in database - SINGLE SOURCE OF TRUTH
    const { data: profile, error } = await supabase
      .from('user_profiles')
      .select('is_admin, deriv_id')
      .eq('id', decoded.userId)
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
      console.log(`[isAdmin]  Access denied for user ${decoded.userId} (deriv_id: ${profile.deriv_id}) - not admin`);
      return res.status(403).json({
        success: false,
        error: 'Forbidden - Admin access required'
      });
    }

    // Attach user info to request
    req.user = {
      userId: decoded.userId,
      isAdmin: true,
      derivAccountId: profile.deriv_id
    };

    console.log(`[isAdmin]  Admin access granted for ${decoded.userId}`);
    next();

  } catch (error) {
    console.error('[isAdmin] Middleware error:', error);

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - Invalid token'
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - Token expired'
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

module.exports = isAdmin;
