const { getTestPool, truncateAllTables } = require('../../db');
const DifySyncService = require('../../../src/services/DifySyncService');
const ProcessedDataRepository = require('../../../src/repository/ProcessedDataRepository');
const RawDataIndexRepository = require('../../../src/repository/RawDataIndexRepository');
const UserRepository = require('../../../src/repository/UserRepository');

// Mock Dify API
const mockDifyApi = {
    importedDocs: [],
    async importDocument(datasetId, document) {
        // 模拟 API 延迟
        await new Promise(resolve => setTimeout(resolve, 10));

        this.importedDocs.push({ datasetId, ...document });
        return { success: true, documentId: `doc-${Date.now()}` };
    }
};

describe('DifySyncService', () => {
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
        service = new DifySyncService(pool, mockDifyApi, 'default-dataset');
    });

    afterAll(async () => {
        if (client) {
            client.release();
        }
    });

    beforeEach(async () => {
        await truncateAllTables(client);
        mockDifyApi.importedDocs = [];

        // 创建测试用户
        await userRepo.create({
            id: 'user-001',
            username: 'system',
            password: 'password123',
            role: 'admin'
        });
    }, 30000);

    describe('syncToDify', () => {
        it('应该同步单条数据到 Dify', async () => {
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
                title: '测试文档',
                content: '这是测试内容',
                collectionName: 'cases'
            });

            // 批准并设置冷却期已过
            await dataRepo.approve('pd-001', 'system');
            await client.query(`
                UPDATE processed_data
                SET cooling_until = NOW() - INTERVAL '25 hours'
                WHERE id = 'pd-001'
            `);

            const result = await service.syncToDify('pd-001');

            expect(result.success).toBe(true);
            expect(result.documentId).toBeDefined();
            expect(mockDifyApi.importedDocs.length).toBe(1);
            expect(mockDifyApi.importedDocs[0].title).toBe('测试文档');
        });

        it('应该标记已同步的数据', async () => {
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
                title: '测试文档',
                content: '这是测试内容'
            });

            await dataRepo.approve('pd-001', 'system');
            await client.query(`
                UPDATE processed_data
                SET cooling_until = NOW() - INTERVAL '25 hours'
                WHERE id = 'pd-001'
            `);

            await service.syncToDify('pd-001');

            const updated = await dataRepo.findById('pd-001');
            expect(updated.used_in_rag).toBe(true);
            expect(updated.rag_imported_at).toBeDefined();
            expect(updated.ready_for_rag).toBe(true);
        });

        it('应该处理 Dify API 错误', async () => {
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
                title: '测试文档',
                content: '这是测试内容'
            });

            await dataRepo.approve('pd-001', 'system');
            await client.query(`
                UPDATE processed_data
                SET cooling_until = NOW() - INTERVAL '25 hours'
                WHERE id = 'pd-001'
            `);

            // 创建一个总是失败的 service
            const failingService = new DifySyncService(pool, {
                async importDocument() {
                    throw new Error('Dify API unavailable');
                }
            }, 'default-dataset');

            const result = await failingService.syncToDify('pd-001');

            expect(result.success).toBe(false);
            expect(result.error).toContain('Dify API unavailable');
        });
    });

    describe('syncBatch', () => {
        it('应该批量同步所有待同步的数据', async () => {
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

            await dataRepo.create({
                id: 'pd-001',
                rawDataId: 'raw-001',
                type: '教训案例',
                category: '职场',
                title: '文档 1',
                content: '内容 1'
            });
            await dataRepo.create({
                id: 'pd-002',
                rawDataId: 'raw-002',
                type: '教训案例',
                category: '职场',
                title: '文档 2',
                content: '内容 2'
            });

            // 批准并设置冷却期已过
            await dataRepo.approve('pd-001', 'system');
            await dataRepo.approve('pd-002', 'system');
            await client.query(`
                UPDATE processed_data
                SET cooling_until = NOW() - INTERVAL '25 hours'
                WHERE id IN ('pd-001', 'pd-002')
            `);

            const result = await service.syncBatch();

            expect(result.synced).toBe(2);
            expect(result.failed).toBe(0);
            expect(mockDifyApi.importedDocs.length).toBe(2);
        });

        it('应该返回同步统计信息', async () => {
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
                title: '文档 1',
                content: '内容 1'
            });

            await dataRepo.approve('pd-001', 'system');
            await client.query(`
                UPDATE processed_data
                SET cooling_until = NOW() - INTERVAL '25 hours'
                WHERE id = 'pd-001'
            `);

            const result = await service.syncBatch();

            expect(result).toHaveProperty('synced');
            expect(result).toHaveProperty('failed');
            expect(result).toHaveProperty('details');
        });
    });

    describe('formatDocument', () => {
        it('应该正确格式化文档', async () => {
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
                title: '测试文档',
                content: '这是测试内容',
                tags: ['tag1', 'tag2']
            });

            const doc = await service.formatDocument('pd-001');

            expect(doc.title).toBe('测试文档');
            expect(doc.content).toBe('这是测试内容');
            expect(doc.metadata.type).toBe('教训案例');
            expect(doc.metadata.category).toBe('职场');
        });
    });
});
