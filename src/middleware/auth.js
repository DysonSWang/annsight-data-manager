const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'annsight-data-manager-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

/**
 * 验证 JWT Token 中间件
 * 使用方式：router.use(authMiddleware.required)
 */
const authMiddleware = {
    /**
     * 要求必须登录
     */
    required: (req, res, next) => {
        try {
            const authHeader = req.headers.authorization;

            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).json({
                    success: false,
                    error: '未提供认证令牌',
                    code: 'UNAUTHORIZED'
                });
            }

            const token = authHeader.substring(7);
            const decoded = jwt.verify(token, JWT_SECRET);

            // 将用户信息附加到请求对象
            req.user = decoded;
            next();

        } catch (error) {
            if (error.name === 'TokenExpiredError') {
                return res.status(401).json({
                    success: false,
                    error: '认证令牌已过期',
                    code: 'TOKEN_EXPIRED'
                });
            }
            if (error.name === 'JsonWebTokenError') {
                return res.status(401).json({
                    success: false,
                    error: '无效的认证令牌',
                    code: 'INVALID_TOKEN'
                });
            }
            return res.status(500).json({
                success: false,
                error: '认证失败：' + error.message,
                code: 'AUTH_ERROR'
            });
        }
    },

    /**
     * 可选登录（有 token 则验证，无 token 也放行）
     */
    optional: (req, res, next) => {
        try {
            const authHeader = req.headers.authorization;

            if (authHeader && authHeader.startsWith('Bearer ')) {
                const token = authHeader.substring(7);
                const decoded = jwt.verify(token, JWT_SECRET);
                req.user = decoded;
            }
            next();

        } catch (error) {
            // Token 无效时忽略，继续请求
            next();
        }
    },

    /**
     * 生成 Token
     */
    generateToken: (payload) => {
        return jwt.sign(
            {
                userId: payload.userId,
                username: payload.username,
                role: payload.role || 'user',
                iat: Math.floor(Date.now() / 1000)
            },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );
    },

    /**
     * 验证 Token（工具函数）
     */
    verifyToken: (token) => {
        return jwt.verify(token, JWT_SECRET);
    }
};

module.exports = authMiddleware;
