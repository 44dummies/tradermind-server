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
        const { data: profile, error } = await supabase
            .from('user_profiles')
            .select('id, is_admin, deriv_id, display_name, email, is_banned')
            .eq('id', req.userId)
            .single();

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

        // Enrich req.user if not already complete
        if (!req.user || !req.user.derivId) {
            req.user = {
                ...(req.user || {}),
                userId: req.userId,
                isAdmin: profile.is_admin || false,
                derivAccountId: profile.deriv_id,
                derivId: profile.deriv_id, // Ensure both naming conventions are present
                displayName: profile.display_name,
                email: profile.email
            };
        }

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
