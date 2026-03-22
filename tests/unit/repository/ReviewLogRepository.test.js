const { getTestPool, truncateAllTables } = require('../../db');
const ReviewLogRepository = require('../../../src/repository/ReviewLogRepository');
const UserRepository = require('../../../src/repository/UserRepository');
const ProcessedDataRepository = require('../../../src/repository/ProcessedDataRepository');
const RawDataIndexRepository = require('../../../src/repository/RawDataIndexRepository');

describe('ReviewLogRepository', () => {
    let reviewLogRepo;
    let userRepo;
    let dataRepo;
    let rawRepo;
    let pool;
    let client;

    beforeAll(async () => {
        pool = getTestPool();
        reviewLogRepo = new ReviewLogRepository(pool);
        userRepo = new UserRepository(pool);
        dataRepo = new ProcessedDataRepository(pool);
        rawRepo = new RawDataIndexRepository(pool);
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

    const createTestData = async () => {
        await rawRepo.create({
            id: 'raw-001',
            ossUrl: 'https://oss.example.com/test.txt',
            contentType: 'text/plain',
            source: 'zhihu',
            batchId: 'batch-001'
        });
        await dataRepo.create({
            id: 'pd-001',
            rawDataId: 'raw-001',
            type: '教训案例',
            category: '职场',
            title: '测试标题',
            content: '测试内容'
        });
    };

    describe('create', () => {
        it('应该成功创建审核日志', async () => {
            await createTestData();

            const log = await reviewLogRepo.create({
                dataId: 'pd-001',
                reviewerId: 'reviewer-001',
                action: 'approve',
                resultValue: 'approved'
            });

            expect(log).toBeDefined();
            expect(log.data_id).toBe('pd-001');
            expect(log.reviewer_id).toBe('reviewer-001');
            expect(log.action).toBe('approve');
            expect(log.result).toBe('approved');
            expect(log.is_spot_check).toBe(false);
        });

        it('应该保存 oldValue 和 newValue', async () => {
            await createTestData();

            const log = await reviewLogRepo.create({
                dataId: 'pd-001',
                reviewerId: 'reviewer-001',
                action: 'update',
                oldValue: { category: '职场' },
                newValue: { category: '社交' },
                resultValue: 'updated'
            });

            expect(log.old_value).toEqual({ category: '职场' });
            expect(log.new_value).toEqual({ category: '社交' });
        });

        it('应该标记为抽检', async () => {
            await createTestData();

            const log = await reviewLogRepo.create({
                dataId: 'pd-001',
                reviewerId: 'reviewer-001',
                action: 'spot_check_correct',
                resultValue: 'corrected',
                isSpotCheck: true
            });

            expect(log.is_spot_check).toBe(true);
        });

        it('应该拒绝不存在的审核人', async () => {
            await createTestData();

            await expect(reviewLogRepo.create({
                dataId: 'pd-001',
                reviewerId: 'non-existent',
                action: 'approve',
                resultValue: 'approved'
            })).rejects.toThrow();
        });
    });

    describe('findByDataId', () => {
        it('应该通过数据 ID 查找日志', async () => {
            await createTestData();
            await reviewLogRepo.create({
                dataId: 'pd-001',
                reviewerId: 'reviewer-001',
                action: 'approve',
                resultValue: 'approved'
            });
            await reviewLogRepo.create({
                dataId: 'pd-001',
                reviewerId: 'reviewer-001',
                action: 'spot_check_correct',
                resultValue: 'corrected'
            });

            const logs = await reviewLogRepo.findByDataId('pd-001');
            expect(logs.length).toBe(2);
        });
    });

    describe('findByReviewerId', () => {
        it('应该通过审核人 ID 查找日志', async () => {
            await createTestData();
            await reviewLogRepo.create({
                dataId: 'pd-001',
                reviewerId: 'reviewer-001',
                action: 'approve',
                resultValue: 'approved'
            });
            await reviewLogRepo.create({
                dataId: 'pd-001',
                reviewerId: 'reviewer-001',
                action: 'reject',
                resultValue: 'rejected'
            });

            const logs = await reviewLogRepo.findByReviewerId('reviewer-001');
            expect(logs.length).toBe(2);
        });
    });

    describe('findSpotChecks', () => {
        it('应该查找抽检日志', async () => {
            await createTestData();
            await reviewLogRepo.create({
                dataId: 'pd-001',
                reviewerId: 'reviewer-001',
                action: 'approve',
                resultValue: 'approved'
            });
            await reviewLogRepo.create({
                dataId: 'pd-001',
                reviewerId: 'reviewer-001',
                action: 'spot_check_correct',
                resultValue: 'corrected',
                isSpotCheck: true
            });

            const spotChecks = await reviewLogRepo.findSpotChecks();
            expect(spotChecks.length).toBe(1);
            expect(spotChecks[0].is_spot_check).toBe(true);
        });
    });

    describe('getAccuracyStats', () => {
        it('应该计算 AI 准确率统计', async () => {
            await createTestData();
            // 创建抽检日志
            await reviewLogRepo.create({
                dataId: 'pd-001',
                reviewerId: 'reviewer-001',
                action: 'spot_check_correct',
                resultValue: 'corrected',
                isSpotCheck: true
            });
            await reviewLogRepo.create({
                dataId: 'pd-001',
                reviewerId: 'reviewer-001',
                action: 'spot_check_correct',
                resultValue: 'confirmed',
                isSpotCheck: true
            });

            const stats = await reviewLogRepo.getAccuracyStats();
            expect(Number(stats.total_spot_checks)).toBe(2);
            expect(Number(stats.corrections)).toBe(1);
            // 准确率 = 1 - (1/2) = 0.5
            expect(Number(stats.accuracy)).toBeCloseTo(0.5);
        });

        it('应该处理没有抽检数据的情况', async () => {
            const stats = await reviewLogRepo.getAccuracyStats();
            expect(Number(stats.total_spot_checks)).toBe(0);
        });
    });

    describe('getThresholdRecommendation', () => {
        it('应该基于准确率推荐阈值', async () => {
            await createTestData();
            // 创建一些抽检数据
            for (let i = 0; i < 10; i++) {
                await reviewLogRepo.create({
                    dataId: 'pd-001',
                    reviewerId: 'reviewer-001',
                    action: 'spot_check_correct',
                    resultValue: i < 2 ? 'corrected' : 'confirmed',
                    isSpotCheck: true
                });
            }

            const recommendation = await reviewLogRepo.getThresholdRecommendation(0.8);
            expect(recommendation.currentThreshold).toBe(0.8);
            expect(recommendation.accuracy).toBeDefined();
            expect(recommendation.recommendedThreshold).toBeDefined();
        });
    });
});
