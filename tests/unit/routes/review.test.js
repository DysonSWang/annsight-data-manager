const request = require('supertest');
const express = require('express');
const { getTestPool, truncateAllTables } = require('../../db');
const ReviewRoutes = require('../../../src/routes/review');
const UserRepository = require('../../../src/repository/UserRepository');
const ProcessedDataRepository = require('../../../src/repository/ProcessedDataRepository');
const RawDataIndexRepository = require('../../../src/repository/RawDataIndexRepository');

describe('Review API - Low Confidence', () => {
    let app;
    let pool;
    let client;
    let userRepo;
    let dataRepo;
    let rawRepo;
    let testToken;

    beforeAll(async () => {
        pool = getTestPool();
        client = await pool.connect();
        userRepo = new UserRepository(pool);
        dataRepo = new ProcessedDataRepository(pool);
        rawRepo = new RawDataIndexRepository(pool);

        // 创建 Express 应用
        app = express();
        app.use(express.json());
        // 设置数据库连接池
        app.locals.pool = pool;

        // 简单的认证中间件
        app.use((req, res, next) => {
            const authHeader = req.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                req.user = { username: 'test-user', config: {} };
            } else {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            next();
        });

        app.use('/api/review', ReviewRoutes);
    });

    afterAll(async () => {
        if (client) {
            client.release();
        }
    });

    beforeEach(async () => {
        await truncateAllTables(client);
        // 创建测试数据
        await userRepo.create({
            id: 'user-001',
            username: 'test-user',
            password: 'password123',
            role: 'reviewer'
        });
        testToken = 'fake-jwt-token';

        // 创建原始数据
        await rawRepo.create({
            id: 'raw-001',
            ossUrl: 'https://oss.example.com/test1.txt',
            contentType: 'text/plain',
            source: 'zhihu',
            batchId: 'batch-001'
        });
        await rawRepo.create({
            id: 'raw-002',
            ossUrl: 'https://oss.example.com/test2.txt',
            contentType: 'text/plain',
            source: 'zhihu',
            batchId: 'batch-001'
        });
    });

    describe('GET /api/review/processed/low-confidence', () => {
        it('应该返回低置信度待审核数据', async () => {
            // 创建低置信度数据
            await dataRepo.create({
                id: 'pd-001',
                rawDataId: 'raw-001',
                type: '教训案例',
                category: '职场',
                title: '低置信度数据',
                content: '内容 1',
                aiConfidenceScore: 0.5
            });
            await dataRepo.create({
                id: 'pd-002',
                rawDataId: 'raw-002',
                type: '教训案例',
                category: '职场',
                title: '高置信度数据',
                content: '内容 2',
                aiConfidenceScore: 0.9
            });

            const response = await request(app)
                .get('/api/review/processed/low-confidence')
                .set('Authorization', `Bearer ${testToken}`)
                .expect(200);

            expect(response.body.data).toBeDefined();
            expect(response.body.data.length).toBe(1);
            expect(response.body.data[0].id).toBe('pd-001');
            expect(response.body.data[0].ai_confidence_score).toBe('0.5000');
        });

        it('应该按置信度升序排序', async () => {
            await dataRepo.create({
                id: 'pd-001',
                rawDataId: 'raw-001',
                type: '教训案例',
                category: '职场',
                title: '中等置信度',
                content: '内容 1',
                aiConfidenceScore: 0.6
            });
            await dataRepo.create({
                id: 'pd-002',
                rawDataId: 'raw-002',
                type: '教训案例',
                category: '职场',
                title: '最低置信度',
                content: '内容 2',
                aiConfidenceScore: 0.3
            });

            const response = await request(app)
                .get('/api/review/processed/low-confidence')
                .set('Authorization', `Bearer ${testToken}`)
                .expect(200);

            expect(response.body.data.length).toBe(2);
            // 第一个应该是置信度最低的
            expect(Number(response.body.data[0].ai_confidence_score)).toBeLessThan(
                Number(response.body.data[1].ai_confidence_score)
            );
        });

        it('应该支持分页', async () => {
            for (let i = 0; i < 5; i++) {
                await rawRepo.create({
                    id: `raw-00${i + 10}`,
                    ossUrl: `https://oss.example.com/test${i}.txt`,
                    contentType: 'text/plain',
                    source: 'zhihu',
                    batchId: 'batch-001'
                });
                await dataRepo.create({
                    id: `pd-00${i + 10}`,
                    rawDataId: `raw-00${i + 10}`,
                    type: '教训案例',
                    category: '职场',
                    title: `数据${i}`,
                    content: `内容${i}`,
                    aiConfidenceScore: 0.3 + i * 0.1
                });
            }

            const response = await request(app)
                .get('/api/review/processed/low-confidence?page=1&pageSize=2')
                .set('Authorization', `Bearer ${testToken}`)
                .expect(200);

            expect(response.body.data.length).toBe(2);
        });

        it('应该只返回 pending 状态的数据', async () => {
            await dataRepo.create({
                id: 'pd-001',
                rawDataId: 'raw-001',
                type: '教训案例',
                category: '职场',
                title: '已审核数据',
                content: '内容 1',
                aiConfidenceScore: 0.5
            });
            // 先创建然后批准它
            await dataRepo.approve('pd-001', 'test-user');

            await dataRepo.create({
                id: 'pd-002',
                rawDataId: 'raw-002',
                type: '教训案例',
                category: '职场',
                title: '待审核数据',
                content: '内容 2',
                aiConfidenceScore: 0.5
            });

            const response = await request(app)
                .get('/api/review/processed/low-confidence')
                .set('Authorization', `Bearer ${testToken}`)
                .expect(200);

            expect(response.body.data.length).toBe(1);
            expect(response.body.data[0].id).toBe('pd-002');
        });

        it('应该拒绝未认证请求', async () => {
            const response = await request(app)
                .get('/api/review/processed/low-confidence')
                .expect(401);

            expect(response.body.error).toBe('Unauthorized');
        });
    });

    describe('POST /api/review/processed/decide', () => {
        it('应该批准数据', async () => {
            await dataRepo.create({
                id: 'pd-001',
                rawDataId: 'raw-001',
                type: '教训案例',
                category: '职场',
                title: '测试数据',
                content: '内容'
            });

            const response = await request(app)
                .post('/api/review/processed/decide')
                .set('Authorization', `Bearer ${testToken}`)
                .send({
                    id: 'pd-001',
                    action: 'approve'
                })
                .expect(200);

            expect(response.body.success).toBe(true);

            const updated = await dataRepo.findById('pd-001');
            expect(updated.review_status).toBe('approved');
            expect(updated.reviewed_by).toBe('test-user');
        });

        it('应该拒绝数据', async () => {
            await dataRepo.create({
                id: 'pd-001',
                rawDataId: 'raw-001',
                type: '教训案例',
                category: '职场',
                title: '测试数据',
                content: '内容'
            });

            const response = await request(app)
                .post('/api/review/processed/decide')
                .set('Authorization', `Bearer ${testToken}`)
                .send({
                    id: 'pd-001',
                    action: 'reject',
                    rejectReason: '内容不相关'
                })
                .expect(200);

            expect(response.body.success).toBe(true);

            const updated = await dataRepo.findById('pd-001');
            expect(updated.review_status).toBe('rejected');
            expect(updated.reject_reason).toBe('内容不相关');
        });

        it('应该支持修正', async () => {
            await dataRepo.create({
                id: 'pd-001',
                rawDataId: 'raw-001',
                type: '教训案例',
                category: '职场',
                title: '测试数据',
                content: '内容'
            });

            const response = await request(app)
                .post('/api/review/processed/decide')
                .set('Authorization', `Bearer ${testToken}`)
                .send({
                    id: 'pd-001',
                    action: 'approve',
                    corrections: { category: '社交' }
                })
                .expect(200);

            expect(response.body.success).toBe(true);

            const updated = await dataRepo.findById('pd-001');
            expect(updated.category).toBe('社交');
        });

        it('应该拒绝无效操作', async () => {
            const response = await request(app)
                .post('/api/review/processed/decide')
                .set('Authorization', `Bearer ${testToken}`)
                .send({
                    id: 'pd-001',
                    action: 'invalid'
                })
                .expect(400);

            expect(response.body.error).toContain('Invalid action');
        });

        it('应该拒绝缺少必填字段', async () => {
            const response = await request(app)
                .post('/api/review/processed/decide')
                .set('Authorization', `Bearer ${testToken}`)
                .send({})
                .expect(400);

            expect(response.body.error).toContain('Missing required fields');
        });
    });

    describe('GET /api/review/stats/ai-accuracy', () => {
        it('应该返回 AI 准确率统计', async () => {
            const response = await request(app)
                .get('/api/review/stats/ai-accuracy')
                .set('Authorization', `Bearer ${testToken}`)
                .expect(200);

            expect(response.body).toBeDefined();
            expect(response.body.total_spot_checks).toBe(0);
            expect(response.body.corrections).toBe(0);
            expect(response.body.accuracy).toBe(1.0);
        });
    });

    describe('GET /api/review/stats/threshold-recommendation', () => {
        it('应该返回阈值建议', async () => {
            const response = await request(app)
                .get('/api/review/stats/threshold-recommendation?currentThreshold=0.8')
                .set('Authorization', `Bearer ${testToken}`)
                .expect(200);

            expect(response.body.currentThreshold).toBe(0.8);
            expect(response.body.accuracy).toBeDefined();
            expect(response.body.recommendedThreshold).toBeDefined();
        });
    });

    describe('POST /api/review/processed/batch-correct', () => {
        it('应该批量修正符合条件的数据', async () => {
            await dataRepo.create({
                id: 'pd-001',
                rawDataId: 'raw-001',
                type: '教训案例',
                category: '职场',
                title: '测试 1',
                content: '内容 1'
            });
            await dataRepo.create({
                id: 'pd-002',
                rawDataId: 'raw-002',
                type: '教训案例',
                category: '职场',
                title: '测试 2',
                content: '内容 2'
            });

            // 先批准数据
            await dataRepo.approve('pd-001', 'test-user');
            await dataRepo.approve('pd-002', 'test-user');

            const response = await request(app)
                .post('/api/review/processed/batch-correct')
                .set('Authorization', `Bearer ${testToken}`)
                .send({
                    conditions: { type: '教训案例', category: '职场' },
                    corrections: { category: '社交' }
                })
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.updated).toBe(2);

            const updated = await dataRepo.findById('pd-001');
            expect(updated.category).toBe('社交');
        });
    });

    describe('GET /api/review/processed/ready-for-rag', () => {
        it('应该返回可以同步到 Dify 的数据', async () => {
            await dataRepo.create({
                id: 'pd-001',
                rawDataId: 'raw-001',
                type: '教训案例',
                category: '职场',
                title: '测试数据',
                content: '内容'
            });

            // 批准并设置冷却期已过
            await dataRepo.approve('pd-001', 'test-user');
            await client.query(`
                UPDATE processed_data
                SET cooling_until = NOW() - INTERVAL '25 hours'
                WHERE id = 'pd-001'
            `);

            const response = await request(app)
                .get('/api/review/processed/ready-for-rag')
                .set('Authorization', `Bearer ${testToken}`)
                .expect(200);

            expect(response.body.data).toBeDefined();
            expect(response.body.count).toBe(1);
            expect(response.body.data[0].id).toBe('pd-001');
        });

        it('不应该返回冷却期内的数据', async () => {
            await dataRepo.create({
                id: 'pd-001',
                rawDataId: 'raw-001',
                type: '教训案例',
                category: '职场',
                title: '测试数据',
                content: '内容'
            });

            // 批准但冷却期未过
            await dataRepo.approve('pd-001', 'test-user');
            await client.query(`
                UPDATE processed_data
                SET cooling_until = NOW() + INTERVAL '23 hours'
                WHERE id = 'pd-001'
            `);

            const response = await request(app)
                .get('/api/review/processed/ready-for-rag')
                .set('Authorization', `Bearer ${testToken}`)
                .expect(200);

            expect(response.body.count).toBe(0);
        });
    });

    describe('POST /api/review/processed/auto-approve', () => {
        it('应该自动批准高置信度数据', async () => {
            await dataRepo.create({
                id: 'pd-001',
                rawDataId: 'raw-001',
                type: '教训案例',
                category: '职场',
                title: '高置信度数据',
                content: '内容',
                aiConfidenceScore: 0.9
            });
            await dataRepo.create({
                id: 'pd-002',
                rawDataId: 'raw-002',
                type: '教训案例',
                category: '职场',
                title: '低置信度数据',
                content: '内容',
                aiConfidenceScore: 0.5
            });

            const response = await request(app)
                .post('/api/review/processed/auto-approve')
                .set('Authorization', `Bearer ${testToken}`)
                .send({ minConfidence: 0.8 })
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.updated).toBe(1);

            const updated = await dataRepo.findById('pd-001');
            expect(updated.review_status).toBe('approved');
            expect(updated.auto_approved).toBe(true);
        });
    });

    describe('GET /api/review/processed/spot-check/stratified', () => {
        it('应该返回分层抽样数据', async () => {
            await dataRepo.create({
                id: 'pd-001',
                rawDataId: 'raw-001',
                type: '教训案例',
                category: '职场',
                title: '测试 1',
                content: '内容 1'
            });

            // 批准并标记为自动批准
            await dataRepo.approve('pd-001', 'test-user');
            await client.query(`
                UPDATE processed_data
                SET auto_approved = TRUE
                WHERE id = 'pd-001'
            `);

            const response = await request(app)
                .get('/api/review/processed/spot-check/stratified?minPerType=2')
                .set('Authorization', `Bearer ${testToken}`)
                .expect(200);

            expect(response.body.data).toBeDefined();
        });
    });

    describe('POST /api/review/processed/spot-check/correct', () => {
        it('应该修正抽检数据', async () => {
            await dataRepo.create({
                id: 'pd-001',
                rawDataId: 'raw-001',
                type: '教训案例',
                category: '职场',
                title: '测试数据',
                content: '内容'
            });

            const response = await request(app)
                .post('/api/review/processed/spot-check/correct')
                .set('Authorization', `Bearer ${testToken}`)
                .send({
                    id: 'pd-001',
                    corrections: { category: '社交' }
                })
                .expect(200);

            expect(response.body.success).toBe(true);

            const updated = await dataRepo.findById('pd-001');
            expect(updated.category).toBe('社交');
        });

        it('应该拒绝缺少必填字段', async () => {
            const response = await request(app)
                .post('/api/review/processed/spot-check/correct')
                .set('Authorization', `Bearer ${testToken}`)
                .send({})
                .expect(400);

            expect(response.body.error).toContain('Missing required fields');
        });
    });
});
