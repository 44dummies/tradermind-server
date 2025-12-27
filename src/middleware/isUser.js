const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);

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
        const { data: profile, error } = await supabase
            .from('user_profiles')
            .select('is_admin, deriv_id, display_name, email, is_banned')
            .eq('id', req.userId)
            .single();

        if (error || !profile) {
            console.error('[isUser] Profile lookup error:', error);
            return res.status(403).json({
                success: false,
                error: 'Forbidden - Profile not found'
            });
        }

        if (profile.is_banned) {
            return res.status(403).json({
                success: false,
                error: 'Account suspended'
            });
        }

        // Enrich req.user if not already enriched
        if (!req.user || !req.user.derivId) {
            req.user = {
                ...(req.user || {}),
                userId: req.userId,
                isAdmin: profile.is_admin || false,
                derivAccountId: profile.deriv_id,
                displayName: profile.display_name,
                email: profile.email
            };
        }

        next();

    } catch (error) {
        console.error('[isUser] Middleware error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
};

module.exports = isUser;
