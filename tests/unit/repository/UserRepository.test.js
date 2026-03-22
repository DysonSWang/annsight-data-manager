const { getTestPool, truncateAllTables } = require('../../db');
const UserRepository = require('../../../src/repository/UserRepository');

describe('UserRepository', () => {
    let repo;
    let pool;
    let client;

    beforeAll(async () => {
        pool = getTestPool();
        repo = new UserRepository(pool);
        // 获取一个专用客户端用于清空数据
        client = await pool.connect();
    });

    afterAll(async () => {
        if (client) {
            client.release();
        }
    });

    beforeEach(async () => {
        // 在每个测试前清空数据
        await truncateAllTables(client);
    });

    describe('create', () => {
        it('应该成功创建新用户', async () => {
            const userData = {
                id: 'user-001',
                username: 'testuser',
                password: 'password123',
                role: 'reviewer'
            };

            const user = await repo.create(userData);

            expect(user).toBeDefined();
            expect(user.id).toBe('user-001');
            expect(user.username).toBe('testuser');
            expect(user.role).toBe('reviewer');
            // 安全实践：不返回 password_hash
            expect(user.password_hash).toBeUndefined();
        });

        it('应该拒绝重复的用户名', async () => {
            const userData = {
                id: 'user-001',
                username: 'testuser',
                password: 'password123',
                role: 'reviewer'
            };

            await repo.create(userData);

            await expect(repo.create({
                ...userData,
                id: 'user-002'
            })).rejects.toThrow();
        });

        it('应该要求必填字段', async () => {
            await expect(repo.create({
                id: 'user-001',
                username: 'testuser'
                // 缺少 password
            })).rejects.toThrow();
        });
    });

    describe('findById', () => {
        it('应该通过 ID 找到用户', async () => {
            const created = await repo.create({
                id: 'user-001',
                username: 'testuser',
                password: 'password123',
                role: 'reviewer'
            });

            const found = await repo.findById('user-001');

            expect(found).toBeDefined();
            expect(found.username).toBe('testuser');
        });

        it('应该返回 undefined 当用户不存在', async () => {
            const found = await repo.findById('non-existent');
            expect(found).toBeUndefined();
        });
    });

    describe('findByUsername', () => {
        it('应该通过用户名找到用户', async () => {
            await repo.create({
                id: 'user-001',
                username: 'testuser',
                password: 'password123',
                role: 'reviewer'
            });

            const found = await repo.findByUsername('testuser');

            expect(found).toBeDefined();
            expect(found.id).toBe('user-001');
        });

        it('应该返回 undefined 当用户名不存在', async () => {
            const found = await repo.findByUsername('nonexistent');
            expect(found).toBeUndefined();
        });
    });

    describe('validatePassword', () => {
        it('应该验证正确的密码', async () => {
            const user = await repo.create({
                id: 'user-001',
                username: 'testuser',
                password: 'password123',
                role: 'reviewer'
            });

            const isValid = await repo.validatePassword(user.id, 'password123');
            expect(isValid).toBe(true);
        });

        it('应该拒绝错误的密码', async () => {
            const user = await repo.create({
                id: 'user-001',
                username: 'testuser',
                password: 'password123',
                role: 'reviewer'
            });

            const isValid = await repo.validatePassword(user.id, 'wrongpassword');
            expect(isValid).toBe(false);
        });

        it('应该拒绝不存在的用户', async () => {
            const isValid = await repo.validatePassword('non-existent', 'anypassword');
            expect(isValid).toBe(false);
        });
    });

    describe('updateLastLogin', () => {
        it('应该更新最后登录时间', async () => {
            const user = await repo.create({
                id: 'user-001',
                username: 'testuser',
                password: 'password123',
                role: 'reviewer'
            });

            await repo.updateLastLogin(user.id);

            const updated = await repo.findById(user.id);
            expect(updated.last_login_at).toBeDefined();
        });
    });

    describe('listUsers', () => {
        it('应该返回用户列表', async () => {
            await repo.create({
                id: 'user-001',
                username: 'user1',
                password: 'password123',
                role: 'reviewer'
            });
            await repo.create({
                id: 'user-002',
                username: 'user2',
                password: 'password123',
                role: 'admin'
            });

            const users = await repo.listUsers();

            expect(users.length).toBeGreaterThanOrEqual(2);
        });

        it('应该支持分页', async () => {
            for (let i = 0; i < 5; i++) {
                await repo.create({
                    id: `user-00${i}`,
                    username: `user${i}`,
                    password: 'password123',
                    role: 'reviewer'
                });
            }

            const page1 = await repo.listUsers({ limit: 2, offset: 0 });
            const page2 = await repo.listUsers({ limit: 2, offset: 2 });

            expect(page1.length).toBe(2);
            expect(page2.length).toBe(2);
        });
    });
});
