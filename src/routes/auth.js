const express = require('express');
const authMiddleware = require('../middleware/auth');
const userService = require('../services/userService');

const router = express.Router();

/**
 * 用户登录
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: '用户名和密码不能为空'
            });
        }

        const result = await userService.authenticate(username, password);
        if (!result.success) {
            return res.status(401).json(result);
        }

        // 生成 JWT token
        const token = authMiddleware.generateToken(result.user);

        res.json({
            success: true,
            token,
            user: result.user
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            error: '登录失败：' + error.message
        });
    }
});

/**
 * 获取当前用户信息
 * GET /api/auth/me
 */
router.get('/me', authMiddleware.required, async (req, res) => {
    try {
        const user = userService.getUser(req.user.username);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: '用户不存在'
            });
        }

        res.json({
            success: true,
            user
        });

    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({
            success: false,
            error: '获取用户信息失败：' + error.message
        });
    }
});

/**
 * 修改密码
 * POST /api/auth/change-password
 */
router.post('/change-password', authMiddleware.required, async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;

        if (!oldPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                error: '原密码和新密码不能为空'
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                error: '密码长度至少为 6 位'
            });
        }

        const result = await userService.changePassword(
            req.user.username,
            oldPassword,
            newPassword
        );

        if (!result.success) {
            return res.status(400).json(result);
        }

        res.json({
            success: true,
            message: '密码修改成功'
        });

    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({
            success: false,
            error: '修改密码失败：' + error.message
        });
    }
});

/**
 * 创建用户（仅管理员）
 * POST /api/auth/users
 */
router.post('/users', authMiddleware.required, async (req, res) => {
    try {
        // 检查管理员权限
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: '需要管理员权限'
            });
        }

        const { username, password, role = 'user' } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: '用户名和密码不能为空'
            });
        }

        const result = await userService.createUser(username, password, role);

        if (!result.success) {
            return res.status(400).json(result);
        }

        res.status(201).json({
            success: true,
            user: result.user
        });

    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({
            success: false,
            error: '创建用户失败：' + error.message
        });
    }
});

/**
 * 列出所有用户（仅管理员）
 * GET /api/auth/users
 */
router.get('/users', authMiddleware.required, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: '需要管理员权限'
            });
        }

        const users = userService.listUsers();
        res.json({
            success: true,
            users
        });

    } catch (error) {
        console.error('List users error:', error);
        res.status(500).json({
            success: false,
            error: '获取用户列表失败：' + error.message
        });
    }
});

/**
 * 删除用户（仅管理员）
 * DELETE /api/auth/users/:username
 */
router.delete('/users/:username', authMiddleware.required, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: '需要管理员权限'
            });
        }

        const result = userService.deleteUser(req.params.username);

        if (!result.success) {
            return res.status(400).json(result);
        }

        res.json({
            success: true,
            message: '用户已删除'
        });

    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({
            success: false,
            error: '删除用户失败：' + error.message
        });
    }
});

module.exports = router;
