const express = require('express');
const MaterialRepository = require('../repository/MaterialRepository');
const MaterialExtractionService = require('../services/MaterialExtractionService');
const { EtlService } = require('../pipeline/etl-service');
const ProcessedDataRepository = require('../repository/ProcessedDataRepository');

const router = express.Router();

/**
 * V9 素材管理 API
 */

/**
 * 获取素材列表（支持筛选）
 * GET /api/materials/list
 */
async function listMaterials(req, res) {
    try {
        const {
            page = 1,
            pageSize = 50,
            type,
            contentType,
            status
        } = req.query;

        const repo = new MaterialRepository(req.app.locals.pool);
        const offset = (parseInt(page) - 1) * parseInt(pageSize);

        const materials = await repo.findList({
            type,
            contentType,
            status,
            limit: parseInt(pageSize),
            offset
        });

        // 获取总数
        const whereClauses = [];
        const params = [];
        let paramIndex = 1;

        if (type) {
            whereClauses.push(`material_type = $${paramIndex++}`);
            params.push(type);
        }
        if (contentType) {
            whereClauses.push(`content_type = $${paramIndex++}`);
            params.push(contentType);
        }
        if (status) {
            whereClauses.push(`review_status = $${paramIndex++}`);
            params.push(status);
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
        const countQuery = `SELECT COUNT(*) FROM processed_data ${whereSql}`;
        const countResult = await req.app.locals.pool.query(countQuery, params);
        const total = parseInt(countResult.rows[0].count);

        res.json({
            success: true,
            data: materials,
            pagination: {
                page: parseInt(page),
                pageSize: parseInt(pageSize),
                total,
                totalPages: Math.ceil(total / parseInt(pageSize))
            }
        });
    } catch (error) {
        console.error('获取素材列表失败:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * 获取素材统计
 * GET /api/materials/stats
 */
async function getMaterialStats(req, res) {
    try {
        const repo = new MaterialRepository(req.app.locals.pool);
        const stats = await repo.getStats();

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('获取素材统计失败:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * 获取可导入微调任务的素材
 * GET /api/finetuning/task/:id/available-materials
 */
async function getAvailableMaterialsForTask(req, res) {
    try {
        const { id } = req.params;
        const { type } = req.query; // sft 或 dpo

        if (!type) {
            return res.status(400).json({
                success: false,
                error: '缺少必要参数：type'
            });
        }

        const repo = new MaterialRepository(req.app.locals.pool);
        const materials = await repo.findAvailableForTask(type);

        res.json({
            success: true,
            data: materials
        });
    } catch (error) {
        console.error('获取可用素材失败:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * 启动 V9 素材提取
 * POST /api/materials/extract
 */
async function extractMaterials(req, res) {
    try {
        const {
            transcriptsRoot,
            pipelines = ['all'],
            dryRun = false
        } = req.body;

        if (!transcriptsRoot) {
            return res.status(400).json({
                success: false,
                error: '缺少必要参数：transcriptsRoot'
            });
        }

        const service = new MaterialExtractionService({
            v9Dir: process.env.V9_DIR || '/home/admin/projects/eq-trainning/t2',
            apiKey: process.env.V9_API_KEY,
            baseUrl: process.env.V9_BASE_URL
        });

        // 检查就绪状态
        const readyCheck = await service.checkReady();
        if (!readyCheck.ready) {
            return res.status(503).json({
                success: false,
                error: 'V9 模块未就绪',
                missing: readyCheck.missing
            });
        }

        // 运行提取
        const result = await service.runShunt({
            transcriptsRoot,
            pipelines,
            dryRun
        });

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: 'V9 提取失败',
                details: result.error,
                stderr: result.stderr
            });
        }

        res.json({
            success: true,
            message: 'V9 提取完成',
            outputDir: result.outputDir,
            stdout: result.stdout
        });
    } catch (error) {
        console.error('启动 V9 提取失败:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * 单个管道提取
 * POST /api/materials/extract/:pipeline
 */
async function extractPipeline(req, res) {
    try {
        const { pipeline } = req.params;
        const { transcriptsRoot } = req.body;

        const validPipelines = ['classifier', 'content', 'rag', 'sft', 'dpo', 'story'];
        if (!validPipelines.includes(pipeline)) {
            return res.status(400).json({
                success: false,
                error: `无效的管道：${pipeline}，支持：${validPipelines.join(', ')}`
            });
        }

        if (!transcriptsRoot) {
            return res.status(400).json({
                success: false,
                error: '缺少必要参数：transcriptsRoot'
            });
        }

        const service = new MaterialExtractionService({
            v9Dir: process.env.V9_DIR || '/home/admin/projects/eq-trainning/t2',
            apiKey: process.env.V9_API_KEY,
            baseUrl: process.env.V9_BASE_URL
        });

        const result = await service.runPipeline(pipeline, { transcriptsRoot });

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: '管道提取失败',
                details: result.error,
                stderr: result.stderr
            });
        }

        res.json({
            success: true,
            message: `${pipeline} 管道提取完成`,
            outputDir: result.outputDir
        });
    } catch (error) {
        console.error('管道提取失败:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * 读取管道输出
 * GET /api/materials/output/:pipeline
 */
async function getPipelineOutput(req, res) {
    try {
        const { pipeline } = req.params;

        const validPipelines = ['classifier', 'content', 'rag', 'sft', 'dpo', 'story'];
        if (!validPipelines.includes(pipeline)) {
            return res.status(400).json({
                success: false,
                error: `无效的管道：${pipeline}`
            });
        }

        const service = new MaterialExtractionService({
            v9Dir: process.env.V9_DIR || '/home/admin/projects/eq-trainning/t2'
        });

        const data = await service.readPipelineOutput(pipeline);

        res.json({
            success: true,
            data
        });
    } catch (error) {
        console.error('读取管道输出失败:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * 获取统计报告
 * GET /api/materials/report
 */
async function getReport(req, res) {
    try {
        const service = new MaterialExtractionService({
            v9Dir: process.env.V9_DIR || '/home/admin/projects/eq-trainning/t2'
        });

        const report = await service.getReport();

        res.json(report);
    } catch (error) {
        console.error('获取统计报告失败:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * 批量导入 V9 素材到 processed_data 表
 * POST /api/materials/import
 */
async function importMaterials(req, res) {
    try {
        const { pipeline, source } = req.body;

        const validPipelines = ['sft', 'rag', 'dpo', 'story', 'content'];
        if (!validPipelines.includes(pipeline)) {
            return res.status(400).json({
                success: false,
                error: `无效的管道：${pipeline}`
            });
        }

        const service = new MaterialExtractionService({
            v9Dir: process.env.V9_DIR || '/home/admin/projects/eq-trainning/t2'
        });

        // 读取管道输出
        const rawData = await service.readPipelineOutput(pipeline);

        if (!Array.isArray(rawData) || rawData.length === 0) {
            return res.status(400).json({
                success: false,
                error: '管道输出为空或格式错误'
            });
        }

        // 转换为 processed_data 格式
        const materials = rawData.map(item => {
            const materialTypeMap = {
                sft: 'sft',
                rag: 'rag',
                dpo: 'dpo',
                story: 'story',
                content: 'content'
            };

            return {
                id: item.id || `v9_${pipeline}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                rawDataId: null,
                materialType: materialTypeMap[pipeline],
                contentType: item.content_type || null,
                sourceVideo: item.source_video || null,
                sourceTimestamp: item.source_timestamp || '未知',
                qualityScore: item.quality_score || null,
                type: item.type || item.category || pipeline,
                category: item.category || item.type || 'unknown',
                title: item.title || '未命名素材',
                content: item.content || '',
                tags: item.tags || null,
                conversation: item.conversation || null
            };
        });

        // 保存到数据库
        const repo = new MaterialRepository(req.app.locals.pool);
        const saved = await repo.saveBatch(materials);

        res.json({
            success: true,
            message: `成功导入 ${saved.length} 条素材`,
            data: saved
        });
    } catch (error) {
        console.error('导入素材失败:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * 获取素材详情
 * GET /api/materials/:id
 */
async function getMaterial(req, res) {
    try {
        const { id } = req.params;

        const repo = new MaterialRepository(req.app.locals.pool);
        const material = await repo.findById(id);

        if (!material) {
            return res.status(404).json({
                success: false,
                error: '素材不存在'
            });
        }

        res.json({
            success: true,
            data: material
        });
    } catch (error) {
        console.error('获取素材详情失败:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * 更新素材
 * PUT /api/materials/:id
 */
async function updateMaterial(req, res) {
    try {
        const { id } = req.params;
        const updates = req.body;

        const repo = new MaterialRepository(req.app.locals.pool);
        const updated = await repo.update(id, updates);

        res.json({
            success: true,
            data: updated
        });
    } catch (error) {
        console.error('更新素材失败:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * 删除素材
 * DELETE /api/materials/:id
 */
async function deleteMaterial(req, res) {
    try {
        const { id } = req.params;

        const repo = new MaterialRepository(req.app.locals.pool);
        await repo.delete(id);

        res.json({
            success: true,
            message: '素材已删除'
        });
    } catch (error) {
        console.error('删除素材失败:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * 批量更新素材
 * POST /api/materials/batch-update
 */
async function batchUpdateMaterials(req, res) {
    try {
        const { ids, updates } = req.body;

        if (!Array.isArray(ids) || !updates) {
            return res.status(400).json({
                success: false,
                error: '参数错误：需要 ids 数组和 updates 对象'
            });
        }

        const repo = new MaterialRepository(req.app.locals.pool);
        const count = await repo.batchUpdate(ids, updates);

        res.json({
            success: true,
            message: `成功更新 ${count} 条素材`,
            count
        });
    } catch (error) {
        console.error('批量更新素材失败:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

// 注册路由 - 注意：动态路由 (/:id) 必须放在静态路由之后
router.get('/list', listMaterials);
router.get('/stats', getMaterialStats);
router.get('/output/:pipeline', getPipelineOutput);
router.get('/report', getReport);
router.get('/grouped-by-raw-data', getGroupedByRawData);
router.get('/by-raw-data/:rawDataId', getByRawDataId);
router.get('/finetuning/task/:id/available-materials', getAvailableMaterialsForTask);
router.get('/:id', getMaterial);
router.put('/:id', updateMaterial);
router.delete('/:id', deleteMaterial);

// 提取和导入
router.post('/extract', extractMaterials);
router.post('/extract/:pipeline', extractPipeline);
router.post('/import', importMaterials);
router.post('/batch-update', batchUpdateMaterials);

/**
 * 按源数据 ID 查看关联素材
 * GET /api/materials/by-raw-data/:rawDataId
 */
async function getByRawDataId(req, res) {
    try {
        const { rawDataId } = req.params;

        const repo = new MaterialRepository(req.app.locals.pool);
        const result = await repo.findByRawDataId(rawDataId);

        if (!result) {
            return res.status(404).json({
                success: false,
                error: '源数据不存在'
            });
        }

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('获取源数据关联素材失败:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * 按源数据聚合查看素材列表
 * GET /api/materials/grouped-by-raw-data
 */
async function getGroupedByRawData(req, res) {
    try {
        const {
            page = 1,
            pageSize = 20,
            materialType,
            contentType
        } = req.query;

        const repo = new MaterialRepository(req.app.locals.pool);
        const result = await repo.findGroupedByRawData({
            materialType,
            contentType,
            limit: parseInt(pageSize),
            offset: (parseInt(page) - 1) * parseInt(pageSize)
        });

        res.json({
            success: true,
            data: result.groups,
            pagination: result.pagination
        });
    } catch (error) {
        console.error('获取聚合素材列表失败:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

module.exports = router;
