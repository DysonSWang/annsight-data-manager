const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

/**
 * 用户仓库 - 负责用户数据的 CRUD 操作
 */
class UserRepository {
    constructor(pool) {
        this.pool = pool;
        this.saltRounds = 10;
    }

    /**
     * 创建新用户
     * @param {Object} userData - 用户数据
     * @param {string} userData.id - 用户 ID
     * @param {string} userData.username - 用户名
     * @param {string} userData.password - 密码（明文，会自动哈希）
     * @param {string} userData.role - 角色 (admin/reviewer/viewer)
     * @returns {Promise<Object>} 创建的用户（不含密码哈希）
     */
    async create(userData) {
        const { id, username, password, role = 'reviewer' } = userData;

        // 验证必填字段
        if (!id || !username || !password) {
            throw new Error('Missing required fields: id, username, password');
        }

        // 哈希密码
        const passwordHash = await bcrypt.hash(password, this.saltRounds);

        const query = `
            INSERT INTO users (id, username, password_hash, role)
            VALUES ($1, $2, $3, $4)
            RETURNING id, username, role, is_active, created_at
        `;

        const result = await this.pool.query(query, [id, username, passwordHash, role]);
        return result.rows[0];
    }

    /**
     * 通过 ID 查找用户
     * @param {string} id - 用户 ID
     * @returns {Promise<Object|undefined>} 用户对象或 undefined
     */
    async findById(id) {
        const query = `
            SELECT id, username, role, is_active, created_at, last_login_at
            FROM users
            WHERE id = $1
        `;

        const result = await this.pool.query(query, [id]);
        return result.rows[0];
    }

    /**
     * 通过用户名查找用户
     * @param {string} username - 用户名
     * @returns {Promise<Object|undefined>} 用户对象或 undefined
     */
    async findByUsername(username) {
        const query = `
            SELECT id, username, password_hash, role, is_active, created_at, last_login_at
            FROM users
            WHERE username = $1
        `;

        const result = await this.pool.query(query, [username]);
        return result.rows[0];
    }

    /**
     * 验证用户密码
     * @param {string} userId - 用户 ID
     * @param {string} password - 明文密码
     * @returns {Promise<boolean>} 密码是否正确
     */
    async validatePassword(userId, password) {
        const query = `
            SELECT password_hash
            FROM users
            WHERE id = $1
        `;

        const result = await this.pool.query(query, [userId]);
        if (result.rows.length === 0) {
            return false;
        }

        const { password_hash } = result.rows[0];
        return bcrypt.compare(password, password_hash);
    }

    /**
     * 更新最后登录时间
     * @param {string} userId - 用户 ID
     * @returns {Promise<void>}
     */
    async updateLastLogin(userId) {
        const query = `
            UPDATE users
            SET last_login_at = CURRENT_TIMESTAMP
            WHERE id = $1
        `;

        await this.pool.query(query, [userId]);
    }

    /**
     * 列出用户（支持分页）
     * @param {Object} options - 查询选项
     * @param {number} options.limit - 每页数量
     * @param {number} options.offset - 偏移量
     * @returns {Promise<Array>} 用户列表
     */
    async listUsers(options = {}) {
        const { limit = 20, offset = 0 } = options;

        const query = `
            SELECT id, username, role, is_active, created_at, last_login_at
            FROM users
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2
        `;

        const result = await this.pool.query(query, [limit, offset]);
        return result.rows;
    }

    /**
     * 更新用户角色
     * @param {string} userId - 用户 ID
     * @param {string} role - 新角色
     * @returns {Promise<Object>} 更新后的用户
     */
    async updateRole(userId, role) {
        const query = `
            UPDATE users
            SET role = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING id, username, role, is_active
        `;

        const result = await this.pool.query(query, [role, userId]);
        return result.rows[0];
    }

    /**
     * 激活/停用用户
     * @param {string} userId - 用户 ID
     * @param {boolean} isActive - 是否激活
     * @returns {Promise<void>}
     */
    async set_active(userId, isActive) {
        const query = `
            UPDATE users
            SET is_active = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
        `;

        await this.pool.query(query, [isActive, userId]);
    }
}

module.exports = UserRepository;
