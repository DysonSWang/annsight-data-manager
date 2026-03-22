const { getTestPool, truncateAllTables } = require('../../db');
const FinetuningExportService = require('../../../src/services/FinetuningExportService');
const ProcessedDataRepository = require('../../../src/repository/ProcessedDataRepository');
const RawDataIndexRepository = require('../../../src/repository/RawDataIndexRepository');
const UserRepository = require('../../../src/repository/UserRepository');

describe('FinetuningExportService', () => {
    let service;
    let dataRepo;
    let rawRepo;
    let userRepo;
    let pool;
    let client;

    beforeAll(async () => {
        pool = getTestPool();
        client = await pool.connect();
        dataRepo = new ProcessedDataRepository(pool);
        rawRepo = new RawDataIndexRepository(pool);
        userRepo = new UserRepository(pool);
        service = new FinetuningExportService(pool);
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

    const createApprovedData = async (id, conversation = null) => {
        await rawRepo.create({
            id: `raw-${id}`,
            ossUrl: `https://oss.example.com/test${id}.txt`,
            contentType: 'text/plain',
            source: 'zhihu',
            batchId: 'batch-001'
        });

        await dataRepo.create({
            id: `pd-${id}`,
            rawDataId: `raw-${id}`,
            type: '教训案例',
            category: '职场',
            title: `标题${id}`,
            content: `内容${id}`,
            conversation
        });

        await dataRepo.approve(`pd-${id}`, 'system');
    };

    describe('exportToJsonl', () => {
        it('应该导出 JSONL 格式数据', async () => {
            await createApprovedData('001', [
                { role: 'user', content: '问题 1' },
                { role: 'assistant', content: '回答 1' }
            ]);

            const result = await service.exportToJsonl();

            expect(result.lines.length).toBe(1);
            expect(result.lines[0]).toContain('"messages"');
            expect(result.lines[0]).toContain('问题 1');
            expect(result.lines[0]).toContain('回答 1');
        });

        it('应该为没有对话的数据生成指令格式', async () => {
            await createApprovedData('001', null);

            const result = await service.exportToJsonl();

            expect(result.lines.length).toBe(1);
            const parsed = JSON.parse(result.lines[0]);
            expect(parsed.instruction).toBeDefined();
            expect(parsed.input).toBeDefined();
            expect(parsed.output).toBeDefined();
        });

        it('应该正确转义 JSON 特殊字符', async () => {
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
                title: '包含"引号"的标题',
                content: '包含\n换行符的内容',
                conversation: [
                    { role: 'user', content: '包含\r\n 回车换行' },
                    { role: 'assistant', content: '包含\t制表符' }
                ]
            });

            await dataRepo.approve('pd-001', 'system');

            const result = await service.exportToJsonl();

            // 应该能正确解析
            const parsed = JSON.parse(result.lines[0]);
            expect(parsed.messages).toBeDefined();
        });
    });

    describe('splitDatasets', () => {
        it('应该按 8:1:1 拆分数据集', async () => {
            // 创建 10 条数据
            for (let i = 1; i <= 10; i++) {
                await createApprovedData(`00${i}`, [
                    { role: 'user', content: `问题${i}` },
                    { role: 'assistant', content: `回答${i}` }
                ]);
            }

            const splits = await service.splitDatasets();

            expect(splits.train.length).toBe(8);
            expect(splits.validation.length).toBe(1);
            expect(splits.test.length).toBe(1);
        });

        it('应该处理少于 10 条的数据', async () => {
            for (let i = 1; i <= 5; i++) {
                await createApprovedData(`00${i}`, [
                    { role: 'user', content: `问题${i}` },
                    { role: 'assistant', content: `回答${i}` }
                ]);
            }

            const splits = await service.splitDatasets();

            // 5 条数据：train=4, validation=1, test=0 或类似
            expect(splits.train.length + splits.validation.length + splits.test.length).toBe(5);
            expect(splits.train.length).toBeGreaterThan(0);
        });
    });

    describe('exportAndSplit', () => {
        it('应该导出并拆分数据集', async () => {
            for (let i = 1; i <= 10; i++) {
                await createApprovedData(`00${i}`, [
                    { role: 'user', content: `问题${i}` },
                    { role: 'assistant', content: `回答${i}` }
                ]);
            }

            const result = await service.exportAndSplit();

            expect(result.total).toBe(10);
            expect(result.train.lines.length).toBe(8);
            expect(result.validation.lines.length).toBe(1);
            expect(result.test.lines.length).toBe(1);
        });
    });

    describe('markAsExported', () => {
        it('应该标记已导出的数据', async () => {
            await createApprovedData('001', [
                { role: 'user', content: '问题' },
                { role: 'assistant', content: '回答' }
            ]);

            await service.markAsExported(['pd-001']);

            const data = await dataRepo.findById('pd-001');
            expect(data.used_in_finetuning).toBe(true);
            expect(data.finetuning_exported_at).toBeDefined();
        });
    });

    describe('getExportStats', () => {
        it('应该返回导出统计信息', async () => {
            await createApprovedData('001', [
                { role: 'user', content: '问题' },
                { role: 'assistant', content: '回答' }
            ]);
            // 直接通过 SQL 更新 used_in_finetuning 字段
            await client.query(`
                UPDATE processed_data
                SET used_in_finetuning = TRUE, finetuning_exported_at = CURRENT_TIMESTAMP
                WHERE id = 'pd-001'
            `);

            const stats = await service.getExportStats();

            expect(stats.totalApproved).toBeGreaterThan(0);
            expect(stats.exported).toBe(1);
            expect(stats.pendingExport).toBe(0);
        });
    });
});
