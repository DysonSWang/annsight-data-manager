const express = require('express');
const multer = require('multer');
const RawDataIndexRepository = require('../repository/RawDataIndexRepository');
const { EtlService } = require('../pipeline/etl-service');
const { ContentRouter } = require('../services/content-router');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const router = express.Router();

// 配置 multer 内存存储
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB 限制
    }
});

/**
 * 源数据管理 API
 */

/**
 * 获取源数据列表（支持筛选和分页）
 * GET /api/raw-data/list
 */
async function listRawData(req, res) {
    try {
        const {
            page = 1,
            pageSize = 20,
            source,
            status,
            batchId,
            startDate,
            endDate
        } = req.query;

        const repo = new RawDataIndexRepository(req.app.locals.pool);
        const offset = (parseInt(page) - 1) * parseInt(pageSize);

        // 构建筛选条件
        const whereClauses = [];
        const params = [];
        let paramIndex = 1;

        if (source) {
            whereClauses.push(`source = $${paramIndex++}`);
            params.push(source);
        }
        if (status) {
            whereClauses.push(`status = $${paramIndex++}`);
            params.push(status);
        }
        if (batchId) {
            whereClauses.push(`batch_id = $${paramIndex++}`);
            params.push(batchId);
        }
        if (startDate) {
            whereClauses.push(`created_at >= $${paramIndex++}`);
            params.push(startDate);
        }
        if (endDate) {
            whereClauses.push(`created_at <= $${paramIndex++}`);
            params.push(endDate);
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // 查询总数
        const countQuery = `SELECT COUNT(*) FROM raw_data_index ${whereSql}`;
        const countResult = await req.app.locals.pool.query(countQuery, params);
        const total = parseInt(countResult.rows[0].count);

        // 查询数据
        const query = `
            SELECT * FROM raw_data_index ${whereSql}
            ORDER BY created_at DESC
            LIMIT $${paramIndex++} OFFSET $${paramIndex++}
        `;
        params.push(parseInt(pageSize), offset);

        const result = await req.app.locals.pool.query(query, params);

        res.json({
            data: result.rows,
            pagination: {
                page: parseInt(page),
                pageSize: parseInt(pageSize),
                total,
                totalPages: Math.ceil(total / parseInt(pageSize))
            }
        });
    } catch (error) {
        console.error('Error listing raw data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * 获取源数据详情
 * GET /api/raw-data/:id
 */
async function getRawData(req, res) {
    try {
        const { id } = req.params;
        const repo = new RawDataIndexRepository(req.app.locals.pool);
        const data = await repo.findById(id);

        if (!data) {
            return res.status(404).json({ error: '源数据不存在' });
        }

        // 查询关联的加工数据
        const processedQuery = `
            SELECT id, type, category, ai_confidence_score, review_status, created_at
            FROM processed_data
            WHERE raw_data_id = $1
        `;
        const processedResult = await req.app.locals.pool.query(processedQuery, [id]);

        res.json({
            data,
            processedData: processedResult.rows
        });
    } catch (error) {
        console.error('Error getting raw data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * 批量上传源数据（文本形式）
 * POST /api/raw-data/batch-upload
 */
async function batchUpload(req, res) {
    try {
        const { items, batchId, source } = req.body;

        if (!items || !Array.isArray(items)) {
            return res.status(400).json({ error: 'items 必须是数组' });
        }
        if (!batchId || !source) {
            return res.status(400).json({ error: 'batchId 和 source 是必填字段' });
        }

        const repo = new RawDataIndexRepository(req.app.locals.pool);
        const results = [];

        for (const item of items) {
            const id = `rd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

            try {
                const record = await repo.create({
                    id,
                    ossUrl: item.ossUrl || '',
                    contentType: item.contentType || 'text/plain',
                    source,
                    batchId,
                    contentMd5: item.contentMd5,
                    metadata: item.metadata || {}
                });

                results.push({
                    success: true,
                    id,
                    data: record
                });
            } catch (error) {
                results.push({
                    success: false,
                    id,
                    error: error.message
                });
            }
        }

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;

        res.json({
            success: true,
            total: items.length,
            successCount,
            failCount,
            results
        });
    } catch (error) {
        console.error('Error batch upload:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * 直接提交文本数据（简化版批量上传）
 * POST /api/raw-data/batch-text
 */
async function batchTextUpload(req, res) {
    try {
        const { texts, batchId, source, purposes, fissionConfig } = req.body;

        if (!texts || !Array.isArray(texts)) {
            return res.status(400).json({ error: 'texts 必须是数组' });
        }
        if (!batchId || !source) {
            return res.status(400).json({ error: 'batchId 和 source 是必填字段' });
        }

        // 默认支持所有用途
        const selectedPurposes = purposes && purposes.length > 0
            ? purposes
            : ['rag', 'finetuning', 'content_creation'];

        const repo = new RawDataIndexRepository(req.app.locals.pool);
        const etlService = new EtlService(req.app.locals.pool, {
            purposes: selectedPurposes,
            fissionConfig // 传递裂变配置
        });
        const results = [];
        let totalFissionCount = 0; // 裂变总数统计

        for (const text of texts) {
            const id = `rd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

            try {
                // 1. 创建原始数据记录
                await repo.create({
                    id,
                    ossUrl: '',
                    contentType: 'text/plain',
                    source,
                    batchId,
                    contentMd5: require('crypto').createHash('md5').update(text).digest('hex'),
                    metadata: { text }
                });

                // 1.5 设置 processing_status 为处理中
                await repo.updateProcessingStatus(id, 'processing_l1_clean');

                // 2. 直接处理文本（跳过原始数据流程）
                const processResult = await etlService.processText(text, {
                    source,
                    batchId,
                    purposes: selectedPurposes,
                    fissionConfig, // 传递裂变配置
                    rawDataId: id // 传递 rawDataId 用于更新 processing_status
                });

                // 2.5 处理完成后更新状态
                if (processResult.success) {
                    await repo.updateStatus(id, 'processed');
                    await repo.updateProcessingStatus(id, 'processed');
                } else {
                    await repo.updateProcessingStatus(id, 'failed');
                }

                // 计算裂变数量
                let fissionCount = 1;
                if (processResult.success) {
                    if (Array.isArray(processResult.processedDataIds)) {
                        fissionCount = processResult.processedDataIds.length;
                    }
                    totalFissionCount += fissionCount;
                }

                results.push({
                    success: processResult.success,
                    id,
                    processedDataIds: processResult.processedDataIds,
                    fissionCount,
                    error: processResult.error
                });
            } catch (error) {
                results.push({
                    success: false,
                    id,
                    error: error.message
                });
            }
        }

        const successCount = results.filter(r => r.success).length;

        res.json({
            success: true,
            total: texts.length,
            successCount,
            failCount: texts.length - successCount,
            totalFissionCount, // 裂变总数
            results
        });
    } catch (error) {
        console.error('Error batch text upload:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * 多格式内容上传（支持文件、URL、文本）
 * POST /api/raw-data/upload
 */
async function uploadHandler(req, res) {
    try {
        const { batchId, source, jsonPath, keepTempFiles = false } = req.body;
        const purposes = req.body.purposes || ['rag', 'finetuning', 'content_creation'];

        if (!batchId || !source) {
            return res.status(400).json({ error: 'batchId 和 source 是必填字段' });
        }

        const repo = new RawDataIndexRepository(req.app.locals.pool);
        const etlService = new EtlService(req.app.locals.pool, { purposes });
        const contentRouter = new ContentRouter();
        const results = [];
        let totalFissionCount = 0;

        // 处理 URL 列表
        const urls = req.body.urls || [];
        if (urls.length > 0) {
            console.log(`[Upload] 处理 ${urls.length} 个 URL`);

            for (const url of urls) {
                const id = `rd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

                try {
                    // 1. 使用 ContentRouter 提取内容
                    const extractResult = await contentRouter.route(
                        { type: 'url', url },
                        { batchId, jsonPath, keepTempFiles }
                    );

                    // 2. 创建原始数据记录
                    await repo.create({
                        id,
                        ossUrl: extractResult.metadata?.sourceUrl || '',
                        contentType: 'text/plain',
                        source,
                        batchId,
                        contentMd5: crypto.createHash('md5').update(extractResult.text).digest('hex'),
                        metadata: {
                            text: extractResult.text,
                            platform: extractResult.metadata?.platform,
                            originalUrl: extractResult.metadata?.sourceUrl
                        },
                        platform: extractResult.metadata?.platform
                    });

                    // 3. 处理提取的文本
                    const processResult = await etlService.processText(extractResult.text, {
                        source,
                        batchId,
                        purposes,
                        fissionConfig: req.body.fissionConfig
                    });

                    if (processResult.success) {
                        const fissionCount = Array.isArray(processResult.processedDataIds)
                            ? processResult.processedDataIds.length
                            : 1;
                        totalFissionCount += fissionCount;

                        results.push({
                            success: true,
                            id,
                            url,
                            extractedText: extractResult.text.slice(0, 100) + '...',
                            processedDataIds: processResult.processedDataIds,
                            fissionCount
                        });
                    } else {
                        results.push({
                            success: false,
                            id,
                            url,
                            error: processResult.error
                        });
                    }
                } catch (error) {
                    results.push({
                        success: false,
                        id,
                        url,
                        error: error.message
                    });
                }
            }
        }

        // 处理文件上传（multipart/form-data）
        const files = req.files || [];
        if (files.length > 0) {
            console.log(`[Upload] 处理 ${files.length} 个文件`);

            const uploadDir = process.env.UPLOAD_TEMP_DIR || '/tmp/annsight-uploads';
            await fs.promises.mkdir(uploadDir, { recursive: true });

            for (const file of files) {
                const id = `rd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                const filePath = path.join(uploadDir, `${id}_${file.originalname}`);

                try {
                    // 1. 保存上传文件
                    await fs.promises.writeFile(filePath, file.buffer);

                    // 2. 使用 ContentRouter 提取内容
                    const extractResult = await contentRouter.route(
                        { type: 'file', path: filePath, contentType: file.mimetype },
                        { batchId, jsonPath, keepTempFiles }
                    );

                    // 3. 创建原始数据记录
                    await repo.create({
                        id,
                        ossUrl: '',
                        contentType: file.mimetype || 'application/octet-stream',
                        source,
                        batchId,
                        contentMd5: crypto.createHash('md5').update(file.buffer).digest('hex'),
                        metadata: {
                            originalFilename: file.originalname,
                            fileSize: file.buffer.length
                        },
                        originalFilePath: filePath
                    });

                    // 4. 处理提取的文本
                    const processResult = await etlService.processText(extractResult.text, {
                        source,
                        batchId,
                        purposes,
                        fissionConfig: req.body.fissionConfig
                    });

                    if (processResult.success) {
                        const fissionCount = Array.isArray(processResult.processedDataIds)
                            ? processResult.processedDataIds.length
                            : 1;
                        totalFissionCount += fissionCount;

                        results.push({
                            success: true,
                            id,
                            filename: file.originalname,
                            extractedText: extractResult.text.slice(0, 100) + '...',
                            processedDataIds: processResult.processedDataIds,
                            fissionCount
                        });
                    } else {
                        results.push({
                            success: false,
                            id,
                            filename: file.originalname,
                            error: processResult.error
                        });
                    }

                    // 清理临时文件
                    if (!keepTempFiles) {
                        await fs.promises.unlink(filePath).catch(() => {});
                    }
                } catch (error) {
                    results.push({
                        success: false,
                        id,
                        filename: file.originalname,
                        error: error.message
                    });

                    // 清理临时文件
                    try { await fs.promises.unlink(filePath); } catch (e) {}
                }
            }
        }

        // 处理纯文本（向后兼容）
        const texts = req.body.texts || [];
        if (texts.length > 0) {
            for (const text of texts) {
                const id = `rd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

                try {
                    await repo.create({
                        id,
                        ossUrl: '',
                        contentType: 'text/plain',
                        source,
                        batchId,
                        contentMd5: crypto.createHash('md5').update(text).digest('hex'),
                        metadata: { text }
                    });

                    const processResult = await etlService.processText(text, {
                        source,
                        batchId,
                        purposes,
                        fissionConfig: req.body.fissionConfig
                    });

                    if (processResult.success) {
                        const fissionCount = Array.isArray(processResult.processedDataIds)
                            ? processResult.processedDataIds.length
                            : 1;
                        totalFissionCount += fissionCount;

                        results.push({
                            success: processResult.success,
                            id,
                            processedDataIds: processResult.processedDataIds,
                            fissionCount
                        });
                    } else {
                        results.push({
                            success: false,
                            id,
                            error: processResult.error
                        });
                    }
                } catch (error) {
                    results.push({
                        success: false,
                        id,
                        error: error.message
                    });
                }
            }
        }

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;

        res.json({
            success: successCount > 0,
            total: results.length,
            successCount,
            failCount,
            totalFissionCount,
            results
        });
    } catch (error) {
        console.error('Error upload handler:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * 删除源数据
 * DELETE /api/raw-data/:id
 */
async function deleteRawData(req, res) {
    try {
        const { id } = req.params;

        // 检查是否有关联的加工数据
        const checkQuery = `
            SELECT COUNT(*) FROM processed_data WHERE raw_data_id = $1
        `;
        const checkResult = await req.app.locals.pool.query(checkQuery, [id]);
        const count = parseInt(checkResult.rows[0].count);

        if (count > 0) {
            return res.status(400).json({
                error: `无法删除：已有 ${count} 条加工数据关联到此源数据`
            });
        }

        const query = `DELETE FROM raw_data_index WHERE id = $1 RETURNING id`;
        const result = await req.app.locals.pool.query(query, [id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: '源数据不存在' });
        }

        res.json({ success: true, deletedId: id });
    } catch (error) {
        console.error('Error deleting raw data:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * 更新源数据状态
 * PATCH /api/raw-data/:id/status
 */
async function updateStatus(req, res) {
    try {
        const { id } = req.params;
        const { status, duplicateOf, rejectReason } = req.body;

        const repo = new RawDataIndexRepository(req.app.locals.pool);

        if (status === 'duplicate') {
            if (!duplicateOf) {
                return res.status(400).json({ error: '重复数据需要指定 duplicateOf' });
            }
            await repo.markAsDuplicate(id, duplicateOf, rejectReason || '');
        } else {
            await repo.updateStatus(id, status);
        }

        const data = await repo.findById(id);
        res.json({ success: true, data });
    } catch (error) {
        console.error('Error updating status:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * 更新第一级审核状态
 * POST /api/raw-data/:id/review
 */
async function updateReview(req, res) {
    try {
        const { id } = req.params;
        const { action, rejectReason } = req.body;

        if (!action || !['approved', 'rejected'].includes(action)) {
            return res.status(400).json({ error: 'action 必须是 approved 或 rejected' });
        }

        const repo = new RawDataIndexRepository(req.app.locals.pool);
        const reviewerId = 'admin'; // 开发模式

        await repo.updateReviewStatusRaw(id, {
            status: action,
            reviewedBy: reviewerId,
            rejectReason: action === 'rejected' ? (rejectReason || '无原因') : null
        });

        // 如果是批准，触发 ETL 处理
        if (action === 'approved') {
            const rawData = await repo.findById(id);
            if (rawData && rawData.transcript_text) {
                const etlService = new EtlService(req.app.locals.pool);
                await etlService.processText(rawData.transcript_text, {
                    source: rawData.source,
                    batchId: rawData.batch_id
                });
            }
            // 更新状态为 processed
            await repo.updateStatus(id, 'processed');
        } else if (action === 'rejected') {
            // 拒绝时更新状态为 rejected
            await repo.updateStatus(id, 'rejected');
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating review:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * 获取批次列表
 * GET /api/raw-data/batches
 */
async function listBatches(req, res) {
    try {
        const query = `
            SELECT
                batch_id as batchId,
                source,
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'processed') as processed,
                COUNT(*) FILTER (WHERE status = 'pending') as pending,
                COUNT(*) FILTER (WHERE status = 'duplicate') as duplicate,
                MIN(created_at) as createdAt
            FROM raw_data_index
            GROUP BY batch_id, source
            ORDER BY createdAt DESC
        `;
        const result = await req.app.locals.pool.query(query);
        res.json({ data: result.rows });
    } catch (error) {
        console.error('Error listing batches:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * 获取统计信息
 * GET /api/raw-data/stats
 */
async function getStats(req, res) {
    try {
        // 禁用缓存，确保前端获取最新数据
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        // 基础统计
        const baseQuery = `
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'pending') as pending,
                COUNT(*) FILTER (WHERE status = 'processed') as processed,
                COUNT(*) FILTER (WHERE status = 'duplicate') as duplicate,
                COUNT(DISTINCT batch_id) as batchCount,
                COUNT(DISTINCT source) as sources
            FROM raw_data_index
        `;
        const baseResult = await req.app.locals.pool.query(baseQuery);

        // 批次详情
        const batchesQuery = `
            SELECT
                batch_id,
                source,
                COUNT(*) as count,
                COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
                COUNT(*) FILTER (WHERE status = 'processed') as processed_count,
                MIN(created_at) as created_at
            FROM raw_data_index
            GROUP BY batch_id, source
            ORDER BY created_at DESC
            LIMIT 10
        `;
        const batchesResult = await req.app.locals.pool.query(batchesQuery);

        // 合并结果
        const stats = baseResult.rows[0];
        res.json({
            total: stats.total,
            pending: stats.pending,
            processed: stats.processed,
            duplicate: stats.duplicate,
            batches: batchesResult.rows,
            sources: stats.sources
        });
    } catch (error) {
        console.error('Error getting stats:', error);
        res.status(500).json({ error: error.message });
    }
}

// 注册路由
router.get('/list', listRawData);
router.get('/batches', listBatches);
router.get('/stats', getStats);
router.get('/:id', getRawData);
router.post('/batch-upload', batchUpload);
router.post('/batch-text', batchTextUpload);
router.post('/upload', upload.array('files', 10), uploadHandler);
router.delete('/:id', deleteRawData);
router.patch('/:id/status', updateStatus);
router.post('/:id/review', updateReview);

module.exports = router;
