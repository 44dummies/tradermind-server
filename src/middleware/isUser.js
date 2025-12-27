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
        console.log(`[isUser] Attempting profile lookup for: ${req.userId}`);

        let { data: profile, error } = await supabase
            .from('user_profiles')
            .select('id, is_admin, deriv_id, display_name, email')
            .eq('id', req.userId)
            .maybeSingle();

        if (error) {
            console.error(`[isUser] Primary lookup (UUID) DB Error:`, error);
        }

        // Fallback: If not found by UUID, try by deriv_id (some legacy tokens or edge cases)
        if (!profile && !error) {
            console.log(`[isUser] Profile not found by UUID, trying Deriv ID: ${req.userId}`);
            const { data: fallbackProfile, error: fallbackError } = await supabase
                .from('user_profiles')
                .select('id, is_admin, deriv_id, display_name, email')
                .eq('deriv_id', req.userId)
                .maybeSingle();

            if (fallbackError) {
                console.error(`[isUser] Fallback lookup (DerivID) DB Error:`, fallbackError);
            }

            profile = fallbackProfile;
            error = fallbackError;
        }

        if (error || !profile) {
            const reason = error ? `DB Error: ${error.message}` : 'No record found in user_profiles';
            console.error(`[isUser] FINAL Profile lookup failure for ${req.userId}: ${reason}`);

            return res.status(403).json({
                success: false,
                error: `Forbidden - Profile not found (${reason})`,
                code: 'PROFILE_NOT_FOUND',
                userId: req.userId,
                diagnostic: {
                    attemptedId: req.userId,
                    reason: reason,
                    dbErrorCode: error?.code
                }
            });
        }

        /* 
        if (profile.is_banned) {
            console.warn(`[isUser] Banned user attempted access: ${req.userId}`);
            return res.status(403).json({
                success: false,
                error: 'Account suspended'
            });
        }
        */

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
