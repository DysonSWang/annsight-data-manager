const { getTestPool, truncateAllTables } = require('../../db');
const { EtlService } = require('../../../src/pipeline/etl-service');
const RawDataIndexRepository = require('../../../src/repository/RawDataIndexRepository');
const ProcessedDataRepository = require('../../../src/repository/ProcessedDataRepository');
const UserRepository = require('../../../src/repository/UserRepository');

// 处理 ESM 模块的命名导出兼容
const ProcessedDataRepositoryClass = ProcessedDataRepository.default || ProcessedDataRepository;
const RawDataIndexRepositoryClass = RawDataIndexRepository.default || RawDataIndexRepository;
const UserRepositoryClass = UserRepository.default || UserRepository;

describe('ETL Pipeline', () => {
    let etlService;
    let rawRepo;
    let dataRepo;
    let userRepo;
    let pool;
    let client;

    beforeAll(async () => {
        pool = getTestPool();
        client = await pool.connect();
        rawRepo = new RawDataIndexRepositoryClass(pool);
        dataRepo = new ProcessedDataRepositoryClass(pool);
        userRepo = new UserRepositoryClass(pool);
        etlService = new EtlService(pool);
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
            username: 'system',
            password: 'password123',
            role: 'admin'
        });
    });

    describe('processText', () => {
        it('应该处理纯文本并提取结构化数据', async () => {
            const text = '教训案例：当众指出领导错误，我被穿了三年小鞋。在一次项目会议上，我发现领导汇报的数据有错误，直接站起来说"汪总，这个数据不对"。会议室瞬间安静，领导脸色涨红。从那以后，重要会议不再通知我，我的晋升也被卡了三年。后来才明白，当众让领导下不来台，就是公开挑战他的权威。';

            const result = await etlService.processText(text, {
                source: 'manual',
                batchId: 'test-001'
            });

            expect(result.success).toBe(true);
            expect(result.processedDataId).toBeDefined();
            expect(result.context.type).toBe('教训案例');
            expect(result.context.category).toBeDefined();
            expect(result.context.aiConfidenceScore).toBeGreaterThan(0);
        });

        it('应该检测到重复内容（MD5）', async () => {
            const text = '这是一个测试文档，包含一些内容';

            const result1 = await etlService.processText(text);
            const result2 = await etlService.processText(text);

            expect(result1.success).toBe(true);
            expect(result2.isDuplicate).toBe(true);
            expect(result2.duplicateOf).toBeDefined();
        });
    });

    describe('processRawData', () => {
        it('应该处理不存在的数据', async () => {
            const result = await etlService.processRawData('non-existent');

            expect(result.success).toBe(false);
            expect(result.error).toBe('原始数据不存在');
        });
    });
});
