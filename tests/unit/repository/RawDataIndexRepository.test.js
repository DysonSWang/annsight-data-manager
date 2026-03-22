const { getTestPool, truncateAllTables } = require('../../db');
const RawDataIndexRepository = require('../../../src/repository/RawDataIndexRepository');

describe('RawDataIndexRepository', () => {
    let repo;
    let pool;
    let client;

    beforeAll(async () => {
        pool = getTestPool();
        repo = new RawDataIndexRepository(pool);
        client = await pool.connect();
    });

    afterAll(async () => {
        if (client) {
            client.release();
        }
    });

    beforeEach(async () => {
        await truncateAllTables(client);
    });

    describe('create', () => {
        it('应该成功创建原始数据记录', async () => {
            const rawData = {
                id: 'raw-001',
                ossUrl: 'https://oss.example.com/test.txt',
                contentType: 'text/plain',
                source: 'zhihu',
                batchId: 'batch-001',
                contentMd5: 'abc123'
            };

            const result = await repo.create(rawData);

            expect(result).toBeDefined();
            expect(result.id).toBe('raw-001');
            expect(result.oss_url).toBe('https://oss.example.com/test.txt');
            expect(result.source).toBe('zhihu');
            expect(result.status).toBe('pending');
        });

        it('应该拒绝重复的 ID', async () => {
            const rawData = {
                id: 'raw-001',
                ossUrl: 'https://oss.example.com/test.txt',
                contentType: 'text/plain',
                source: 'zhihu',
                batchId: 'batch-001'
            };

            await repo.create(rawData);

            await expect(repo.create({
                ...rawData,
                ossUrl: 'https://oss.example.com/test2.txt'
            })).rejects.toThrow();
        });

        it('应该要求必填字段', async () => {
            await expect(repo.create({
                id: 'raw-001'
                // 缺少其他必填字段
            })).rejects.toThrow();
        });

        it('应该保存 JSONB 元数据', async () => {
            const rawData = {
                id: 'raw-001',
                ossUrl: 'https://oss.example.com/test.json',
                contentType: 'application/json',
                source: 'submission',
                batchId: 'batch-001',
                metadata: { author: 'test', extra: { key: 'value' } }
            };

            const result = await repo.create(rawData);
            const found = await repo.findById('raw-001');

            expect(found.metadata).toEqual({ author: 'test', extra: { key: 'value' } });
        });
    });

    describe('findById', () => {
        it('应该通过 ID 找到记录', async () => {
            await repo.create({
                id: 'raw-001',
                ossUrl: 'https://oss.example.com/test.txt',
                contentType: 'text/plain',
                source: 'zhihu',
                batchId: 'batch-001'
            });

            const found = await repo.findById('raw-001');

            expect(found).toBeDefined();
            expect(found.source).toBe('zhihu');
        });

        it('应该返回 undefined 当记录不存在', async () => {
            const found = await repo.findById('non-existent');
            expect(found).toBeUndefined();
        });
    });

    describe('findByMd5', () => {
        it('应该通过 MD5 找到记录', async () => {
            await repo.create({
                id: 'raw-001',
                ossUrl: 'https://oss.example.com/test.txt',
                contentType: 'text/plain',
                source: 'zhihu',
                batchId: 'batch-001',
                contentMd5: 'abc123def456'
            });

            const found = await repo.findByMd5('abc123def456');

            expect(found).toBeDefined();
            expect(found.id).toBe('raw-001');
        });

        it('应该返回 undefined 当 MD5 不存在', async () => {
            const found = await repo.findByMd5('non-existent-md5');
            expect(found).toBeUndefined();
        });
    });

    describe('markAsDuplicate', () => {
        it('应该标记为重复', async () => {
            await repo.create({
                id: 'raw-001',
                ossUrl: 'https://oss.example.com/test.txt',
                contentType: 'text/plain',
                source: 'zhihu',
                batchId: 'batch-001'
            });

            await repo.markAsDuplicate('raw-001', 'raw-original', 'Same content MD5');

            const found = await repo.findById('raw-001');
            expect(found.status).toBe('duplicate');
            expect(found.duplicate_of).toBe('raw-original');
            expect(found.duplicate_reason).toBe('Same content MD5');
        });
    });

    describe('updateTranscript', () => {
        it('应该更新转录信息', async () => {
            await repo.create({
                id: 'raw-001',
                ossUrl: 'https://oss.example.com/audio.mp3',
                contentType: 'audio/mp3',
                source: 'interview',
                batchId: 'batch-001'
            });

            await repo.updateTranscript('raw-001', {
                status: 'completed',
                ossUrl: 'https://oss.example.com/transcript.txt',
                text: '这是转录文本'
            });

            const found = await repo.findById('raw-001');
            expect(found.transcript_status).toBe('completed');
            expect(found.transcript_oss_url).toBe('https://oss.example.com/transcript.txt');
            expect(found.transcript_text).toBe('这是转录文本');
        });
    });

    describe('updateReviewStatusRaw', () => {
        it('应该更新第一级审核状态', async () => {
            await repo.create({
                id: 'raw-001',
                ossUrl: 'https://oss.example.com/test.txt',
                contentType: 'text/plain',
                source: 'zhihu',
                batchId: 'batch-001'
            });

            await repo.updateReviewStatusRaw('raw-001', {
                status: 'approved',
                reviewedBy: 'reviewer-001'
            });

            const found = await repo.findById('raw-001');
            expect(found.review_status_raw).toBe('approved');
            expect(found.reviewed_by_raw).toBe('reviewer-001');
        });

        it('应该记录拒绝原因', async () => {
            await repo.create({
                id: 'raw-001',
                ossUrl: 'https://oss.example.com/test.txt',
                contentType: 'text/plain',
                source: 'zhihu',
                batchId: 'batch-001'
            });

            await repo.updateReviewStatusRaw('raw-001', {
                status: 'rejected',
                reviewedBy: 'reviewer-001',
                rejectReason: '内容不相关'
            });

            const found = await repo.findById('raw-001');
            expect(found.review_status_raw).toBe('rejected');
            expect(found.reject_reason_raw).toBe('内容不相关');
        });
    });

    describe('listByBatch', () => {
        it('应该按批次列出记录', async () => {
            await repo.create({
                id: 'raw-001',
                ossUrl: 'https://oss.example.com/test1.txt',
                contentType: 'text/plain',
                source: 'zhihu',
                batchId: 'batch-001'
            });
            await repo.create({
                id: 'raw-002',
                ossUrl: 'https://oss.example.com/test2.txt',
                contentType: 'text/plain',
                source: 'zhihu',
                batchId: 'batch-001'
            });
            await repo.create({
                id: 'raw-003',
                ossUrl: 'https://oss.example.com/test3.txt',
                contentType: 'text/plain',
                source: 'xiaohongshu',
                batchId: 'batch-002'
            });

            const batch1Records = await repo.listByBatch('batch-001');
            expect(batch1Records.length).toBe(2);
            expect(batch1Records.map(r => r.id)).toEqual(expect.arrayContaining(['raw-001', 'raw-002']));
        });
    });

    describe('listByStatus', () => {
        it('应该按状态列出记录', async () => {
            await repo.create({
                id: 'raw-001',
                ossUrl: 'https://oss.example.com/test1.txt',
                contentType: 'text/plain',
                source: 'zhihu',
                batchId: 'batch-001'
            });
            await repo.create({
                id: 'raw-002',
                ossUrl: 'https://oss.example.com/test2.txt',
                contentType: 'text/plain',
                source: 'zhihu',
                batchId: 'batch-001',
                status: 'duplicate'
            });

            const pendingRecords = await repo.listByStatus('pending');
            expect(pendingRecords.length).toBe(1);
            expect(pendingRecords[0].id).toBe('raw-001');

            const duplicateRecords = await repo.listByStatus('duplicate');
            expect(duplicateRecords.length).toBe(1);
            expect(duplicateRecords[0].id).toBe('raw-002');
        });
    });
});
