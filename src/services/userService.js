const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

/**
 * 简单用户管理（生产环境应使用数据库存储）
 * 默认用户：admin / admin123
 */

// 内存用户存储（重启后重置）
const users = new Map();

// 默认管理员账户
const DEFAULT_ADMIN = {
    id: 'admin',
    username: 'admin',
    passwordHash: bcrypt.hashSync('admin123', 10),
    role: 'admin',
    createdAt: new Date().toISOString()
};

users.set('admin', DEFAULT_ADMIN);

/**
 * 用户服务
 */
const userService = {
    /**
     * 验证用户登录
     */
    async authenticate(username, password) {
        const user = users.get(username);
        if (!user) {
            return { success: false, error: '用户名或密码错误' };
        }

        const validPassword = await bcrypt.compare(password, user.passwordHash);
        if (!validPassword) {
            return { success: false, error: '用户名或密码错误' };
        }

        // 返回不带密码的用户信息
        const { passwordHash, ...userWithoutPassword } = user;
        return { success: true, user: userWithoutPassword };
    },

    /**
     * 创建用户
     */
    async createUser(username, password, role = 'user') {
        if (users.has(username)) {
            return { success: false, error: '用户名已存在' };
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const user = {
            id: uuidv4(),
            username,
            passwordHash,
            role,
            createdAt: new Date().toISOString()
        };

        users.set(username, user);

        const { passwordHash: _, ...userWithoutPassword } = user;
        return { success: true, user: userWithoutPassword };
    },

    /**
     * 获取用户信息
     */
    getUser(username) {
        const user = users.get(username);
        if (!user) return null;

        const { passwordHash, ...userWithoutPassword } = user;
        return userWithoutPassword;
    },

    /**
     * 列出所有用户
     */
    listUsers() {
        return Array.from(users.values()).map(({ passwordHash, ...user }) => user);
    },

    /**
     * 删除用户
     */
    deleteUser(username) {
        if (username === 'admin') {
            return { success: false, error: '不能删除管理员账户' };
        }
        const deleted = users.delete(username);
        return { success: deleted };
    },

    /**
     * 修改密码
     */
    async changePassword(username, oldPassword, newPassword) {
        const user = users.get(username);
        if (!user) {
            return { success: false, error: '用户不存在' };
        }

        const validPassword = await bcrypt.compare(oldPassword, user.passwordHash);
        if (!validPassword) {
            return { success: false, error: '原密码错误' };
        }

        user.passwordHash = await bcrypt.hash(newPassword, 10);
        users.set(username, user);

        return { success: true };
    }
};

module.exports = userService;
