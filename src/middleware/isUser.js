const { supabase } = require('../db/supabase');

/**
 * Middleware to protect user routes
 * Relies on authMiddleware to verify JWT
 */
const isUser = async (req, res, next) => {
    try {
        // req.userId should be set by authMiddleware
        if (!req.userId) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized - Auth required'
            });
        }

        // Get user profile to ensure it exists and user isn't banned
        // Use central client which handles service key correctly
        // Robustness: Check by id (likely UUID) first, then fallback to deriv_id
        let { data: profile, error } = await supabase
            .from('user_profiles')
            .select('id, is_admin, deriv_id, display_name, email, is_banned')
            .eq('id', req.userId)
            .maybeSingle();

        // Fallback: If not found by UUID, try by deriv_id (some legacy tokens or edge cases)
        if (!profile && !error) {
            const { data: fallbackProfile, error: fallbackError } = await supabase
                .from('user_profiles')
                .select('id, is_admin, deriv_id, display_name, email, is_banned')
                .eq('deriv_id', req.userId)
                .maybeSingle();

            profile = fallbackProfile;
            error = fallbackError;
        }

        if (error || !profile) {
            console.error('[isUser] Profile lookup failure:', error?.message || 'Profile not found', {
                queriedId: req.userId,
                errorCode: error?.code
            });
            return res.status(403).json({
                success: false,
                error: 'Forbidden - Profile not found',
                code: 'PROFILE_NOT_FOUND',
                userId: req.userId
            });
        }

        if (profile.is_banned) {
            console.warn(`[isUser] Banned user attempted access: ${req.userId}`);
            return res.status(403).json({
                success: false,
                error: 'Account suspended'
            });
        }

        // IMPORTANT: Update userId and req.user to the standardized DB ID (UUID)
        // This ensures downstream handlers use the internal ID regardless of token contents
        req.userId = profile.id;

        // Enrich req.user and ensure standard naming conventions
        req.user = {
            ...(req.user || {}),
            id: profile.id, // Primary ID for DB queries
            userId: profile.id, // Alias used in some services
            isAdmin: profile.is_admin || false,
            derivAccountId: profile.deriv_id,
            derivId: profile.deriv_id,
            displayName: profile.display_name,
            email: profile.email
        };

        next();

    } catch (error) {
        console.error('[isUser] Middleware critical error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
};

module.exports = isUser;
