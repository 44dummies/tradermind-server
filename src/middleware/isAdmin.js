const { supabase } = require('../db/supabase');

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
    // Use central client which handles service key correctly
    // Robustness: Check by id (likely UUID) first, then fallback to deriv_id
    let { data: profile, error } = await supabase
      .from('user_profiles')
      .select('id, is_admin, deriv_id')
      .eq('id', req.userId)
      .maybeSingle();

    // Fallback: If not found by UUID, try by deriv_id
    if (!profile && !error) {
      const { data: fallbackProfile, error: fallbackError } = await supabase
        .from('user_profiles')
        .select('id, is_admin, deriv_id')
        .eq('deriv_id', req.userId)
        .maybeSingle();

      profile = fallbackProfile;
      error = fallbackError;
    }

    if (error || !profile) {
      console.error('[isAdmin] Profile lookup failure:', error?.message || 'Profile not found', {
        queriedId: req.userId
      });
      return res.status(403).json({
        success: false,
        error: 'Forbidden - Profile not found'
      });
    }

    // Check only database flag
    if (profile.is_admin !== true) {
      console.warn(`[isAdmin] Access denied for user ${req.userId} - not admin`);
      return res.status(403).json({
        success: false,
        error: 'Forbidden - Admin access required'
      });
    }

    // IMPORTANT: Update userId and req.user to the standardized DB ID (UUID)
    // This ensures downstream handlers use the internal ID regardless of token contents
    req.userId = profile.id;

    // Attach user info to request
    req.user = {
      ...(req.user || {}),
      id: profile.id,
      userId: profile.id,
      isAdmin: true,
      derivAccountId: profile.deriv_id,
      derivId: profile.deriv_id
    };

    console.log(`[isAdmin] Admin access granted for ${profile.id}`);
    next();

  } catch (error) {
    console.error('[isAdmin] Middleware critical error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

module.exports = isAdmin;
