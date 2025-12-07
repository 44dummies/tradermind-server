const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);

/**
 * Middleware to protect user routes
 * Verifies JWT and ensures user exists
 */
const isUser = async (req, res, next) => {
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

        // Get user profile
        const { data: profile, error } = await supabase
            .from('user_profiles')
            .select('is_admin, deriv_id, display_name, email')
            .eq('id', decoded.userId)
            .single();

        if (error || !profile) {
            console.error('[isUser] Profile lookup error:', error);
            return res.status(403).json({
                success: false,
                error: 'Forbidden - Profile not found'
            });
        }

        // Attach user info to request
        req.user = {
            userId: decoded.userId,
            isAdmin: profile.is_admin || false,
            derivAccountId: profile.deriv_id,
            displayName: profile.display_name,
            email: profile.email
        };

        console.log(`[isUser] ✅ User access granted for ${decoded.userId}`);
        next();

    } catch (error) {
        console.error('[isUser] Middleware error:', error);

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

module.exports = isUser;
