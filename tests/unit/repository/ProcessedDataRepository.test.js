const { getTestPool, truncateAllTables } = require('../../db');
const ProcessedDataRepository = require('../../../src/repository/ProcessedDataRepository');
const RawDataIndexRepository = require('../../../src/repository/RawDataIndexRepository');
const UserRepository = require('../../../src/repository/UserRepository');

describe('ProcessedDataRepository', () => {
    let repo;
    let rawRepo;
    let userRepo;
    let pool;
    let client;

    beforeAll(async () => {
        pool = getTestPool();
        repo = new ProcessedDataRepository(pool);
        rawRepo = new RawDataIndexRepository(pool);
        userRepo = new UserRepository(pool);
        client = await pool.connect();
    });

    afterAll(async () => {
        if (client) {
            client.release();
        }
    });

    beforeEach(async () => {
        await truncateAllTables(client);
        // 创建测试用户
        await userRepo.create({
            id: 'user-001',
            username: 'reviewer-001',
            password: 'password123',
            role: 'reviewer'
        });
    });

    const createRawData = async (id = 'raw-001') => {
        await rawRepo.create({
            id,
            ossUrl: 'https://oss.example.com/test.txt',
            contentType: 'text/plain',
            source: 'zhihu',
            batchId: 'batch-001'
        });
    };

    describe('create', () => {
        it('应该成功创建加工数据记录', async () => {
            await createRawData();

            const data = {
                id: 'pd-001',
                rawDataId: 'raw-001',
                type: '教训案例',
                category: '职场',
                title: '测试标题',
                content: '测试内容'
            };

            const result = await repo.create(data);

            expect(result).toBeDefined();
            expect(result.id).toBe('pd-001');
            expect(result.type).toBe('教训案例');
            expect(result.category).toBe('职场');
            expect(result.review_status).toBe('pending');
        });

        it('应该拒绝不存在的外键', async () => {
            const data = {
                id: 'pd-001',
                rawDataId: 'non-existent',
                type: '教训案例',
                category: '职场',
                title: '测试标题',
                content: '测试内容'
            };

            await expect(repo.create(data)).rejects.toThrow();
        });

        it('应该保存 conversation JSONB 字段', async () => {
            await createRawData();

            const data = {
                id: 'pd-001',
                rawDataId: 'raw-001',
                type: '教训案例',
                category: '职场',
                title: '测试标题',
                content: '测试内容',
                conversation: [
                    { role: 'user', content: '问题' },
                    { role: 'assistant', content: '回答' }
                ]
            };

            await repo.create(data);
            const found = await repo.findById('pd-001');

            expect(found.conversation).toEqual([
                { role: 'user', content: '问题' },
                { role: 'assistant', content: '回答' }
            ]);
        });

        it('应该设置默认 collection_name 为 default', async () => {
            await createRawData();

            const data = {
                id: 'pd-001',
                rawDataId: 'raw-001',
                type: '教训案例',
                category: '职场',
                title: '测试标题',
                content: '测试内容'
            };

            const result = await repo.create(data);
            expect(result.collection_name).toBe('default');
        });

        it('应该设置 AI 置信度和冷却期', async () => {
            await createRawData();

            const data = {
                id: 'pd-001',
                rawDataId: 'raw-001',
                type: '教训案例',
                category: '职场',
                title: '测试标题',
                content: '测试内容',
                aiConfidenceScore: 0.85,
                autoApproved: true
            };

            const result = await repo.create(data);
            expect(Number(result.ai_confidence_score)).toBe(0.85);
            expect(result.auto_approved).toBe(true);
            expect(result.cooling_until).toBeDefined();
        });
    });

    describe('findById', () => {
        it('应该通过 ID 找到记录', async () => {
            await createRawData();
            await repo.create({
                id: 'pd-001',
                rawDataId: 'raw-001',
                type: '教训案例',
                category: '职场',
                title: '测试标题',
                content: '测试内容'
            });

            const found = await repo.findById('pd-001');
            expect(found).toBeDefined();
            expect(found.title).toBe('测试标题');
        });

        it('应该返回 undefined 当记录不存在', async () => {
            const found = await repo.findById('non-existent');
            expect(found).toBeUndefined();
        });
    });

    describe('findLowConfidence', () => {
        it('应该找到低置信度待审核数据', async () => {
            await createRawData();
            await repo.create({
                id: 'pd-001',
                rawDataId: 'raw-001',
                type: '教训案例',
                category: '职场',
                title: '低置信度',
                content: '测试内容',
                aiConfidenceScore: 0.6
            });
            await repo.create({
                id: 'pd-002',
                rawDataId: 'raw-001',
                type: '教训案例',
                category: '职场',
                title: '高置信度',
                content: '测试内容',
                aiConfidenceScore: 0.9
            });

            const lowConf = await repo.findLowConfidence(0.8);
            expect(lowConf.length).toBe(1);
            expect(lowConf[0].id).toBe('pd-001');
        });
    });

    describe('autoApprove', () => {
        it('应该自动批准高置信度数据', async () => {
            await createRawData();
            await repo.create({
                id: 'pd-001',
                rawDataId: 'raw-001',
                type: '教训案例',
                category: '职场',
                title: '测试标题',
                content: '测试内容',
                aiConfidenceScore: 0.9
            });

            const updated = await repo.autoApprove('pd-001', 24);
            expect(updated.review_status).toBe('approved');
            expect(updated.auto_approved).toBe(true);
            expect(updated.ready_for_rag).toBe(false);
        });
    });

    describe('approve', () => {
        it('应该手动批准数据', async () => {
            await createRawData();
            await repo.create({
                id: 'pd-001',
                rawDataId: 'raw-001',
                type: '教训案例',
                category: '职场',
                title: '测试标题',
                content: '测试内容'
            });

            await repo.approve('pd-001', 'reviewer-001');
            const found = await repo.findById('pd-001');

            expect(found.review_status).toBe('approved');
            expect(found.reviewed_by).toBe('reviewer-001');
        });
    });

    describe('reject', () => {
        it('应该拒绝数据', async () => {
            await createRawData();
            await repo.create({
                id: 'pd-001',
                rawDataId: 'raw-001',
                type: '教训案例',
                category: '职场',
                title: '测试标题',
                content: '测试内容'
            });

            await repo.reject('pd-001', 'reviewer-001', '内容不相关');
            const found = await repo.findById('pd-001');

            expect(found.review_status).toBe('rejected');
            expect(found.reject_reason).toBe('内容不相关');
        });
    });

    describe('findReadyForRag', () => {
        it('应该找到冷却期已过可以同步到 Dify 的数据', async () => {
            await createRawData();
            await repo.create({
                id: 'pd-001',
                rawDataId: 'raw-001',
                type: '教训案例',
                category: '职场',
                title: '测试标题',
                content: '测试内容'
            });
            // 先批准，然后手动更新冷却期
            await repo.approve('pd-001', 'reviewer-001');
            await client.query(`
                UPDATE processed_data
                SET cooling_until = NOW() - INTERVAL '25 hours'
                WHERE id = 'pd-001'
            `);

            const ready = await repo.findReadyForRag();
            expect(ready.length).toBe(1);
            expect(ready[0].id).toBe('pd-001');
        });

        it('不应该返回冷却期内的数据', async () => {
            await createRawData();
            await repo.create({
                id: 'pd-001',
                rawDataId: 'raw-001',
                type: '教训案例',
                category: '职场',
                title: '测试标题',
                content: '测试内容'
            });
            // 先批准，然后手动更新冷却期到未来
            await repo.approve('pd-001', 'reviewer-001');
            await client.query(`
                UPDATE processed_data
                SET cooling_until = NOW() + INTERVAL '23 hours'
                WHERE id = 'pd-001'
            `);

            const ready = await repo.findReadyForRag();
            expect(ready.length).toBe(0);
        });
    });

    describe('markAsUsedInRag', () => {
        it('应该标记已同步到 Dify', async () => {
            await createRawData();
            await repo.create({
                id: 'pd-001',
                rawDataId: 'raw-001',
                type: '教训案例',
                category: '职场',
                title: '测试标题',
                content: '测试内容'
            });

            await repo.markAsUsedInRag('pd-001');
            const found = await repo.findById('pd-001');

            expect(found.used_in_rag).toBe(true);
            expect(found.rag_imported_at).toBeDefined();
        });
    });

    describe('getSpotCheckSamples', () => {
        it('应该按类型分层抽样', async () => {
            await createRawData('raw-001');
            await createRawData('raw-002');
            await createRawData('raw-003');

            // 创建不同类型的数据
            await repo.create({
                id: 'pd-001',
                rawDataId: 'raw-001',
                type: '教训案例',
                category: '职场',
                title: '测试 1',
                content: '内容 1',
                autoApproved: true
            });
            await repo.create({
                id: 'pd-002',
                rawDataId: 'raw-002',
                type: '教训案例',
                category: '社交',
                title: '测试 2',
                content: '内容 2',
                autoApproved: true
            });
            await repo.create({
                id: 'pd-003',
                rawDataId: 'raw-003',
                type: '战术方法',
                category: '职场',
                title: '测试 3',
                content: '内容 3',
                autoApproved: true
            });

            // 批准这些数据
            await repo.approve('pd-001', 'reviewer-001');
            await repo.approve('pd-002', 'reviewer-001');
            await repo.approve('pd-003', 'reviewer-001');

            // 更新 auto_approved 标志
            await client.query(`
                UPDATE processed_data
                SET auto_approved = TRUE
                WHERE id IN ('pd-001', 'pd-002', 'pd-003')
            `);

            const samples = await repo.getSpotCheckSamples({ minPerType: 2 });
            expect(samples.length).toBeGreaterThan(0);
        });
    });

    describe('batchCorrect', () => {
        it('应该批量修正符合条件的数据', async () => {
            await createRawData('raw-001');
            await createRawData('raw-002');

            await repo.create({
                id: 'pd-001',
                rawDataId: 'raw-001',
                type: '教训案例',
                category: '职场',
                title: '测试 1',
                content: '内容 1'
            });
            await repo.create({
                id: 'pd-002',
                rawDataId: 'raw-002',
                type: '教训案例',
                category: '职场',
                title: '测试 2',
                content: '内容 2'
            });

            // 批准数据
            await repo.approve('pd-001', 'reviewer-001');
            await repo.approve('pd-002', 'reviewer-001');

            const corrected = await repo.batchCorrect(
                { type: '教训案例', category: '职场' },
                { category: '社交' }
            );

            expect(corrected).toBe(2);

            const updated = await repo.findById('pd-001');
            expect(updated.category).toBe('社交');
        });
    });

    describe('exportForFinetuning', () => {
        it('应该导出用于微调的数据', async () => {
            await createRawData();
            await repo.create({
                id: 'pd-001',
                rawDataId: 'raw-001',
                type: '教训案例',
                category: '职场',
                title: '测试标题',
                content: '测试内容',
                conversation: [
                    { role: 'user', content: '问题' },
                    { role: 'assistant', content: '回答' }
                ]
            });

            // 批准数据
            await repo.approve('pd-001', 'reviewer-001');

            const exported = await repo.exportForFinetuning();
            expect(exported.length).toBe(1);
            expect(exported[0].conversation).toBeDefined();
        });
    });
});
