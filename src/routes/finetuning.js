const express = require('express');
const FinetuningTaskService = require('../services/FinetuningTaskService');
const FinetuningTaskRepository = require('../repository/FinetuningTaskRepository');
const ReviewRoundRepository = require('../repository/ReviewRoundRepository');
const FinetuningExportService = require('../services/FinetuningExportService');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

/**
 * 微调任务管理 API
 */

/**
 * 创建微调任务
 * POST /api/finetuning/task
 */
async function createTask(req, res) {
    try {
        const { name, purpose, pass_threshold, max_review_rounds, manual_review_enabled, manual_review_scope } = req.body;

        if (!name) {
            return res.status(400).json({ error: '任务名称不能为空' });
        }

        const service = new FinetuningTaskService(req.app.locals.pool);

        // 生成批次 ID（用于关联数据）
        const batchId = `ft-batch-${Date.now()}`;

        const task = await service.createTask({
            name,
            purpose: purpose || '',
            pass_threshold: pass_threshold || 0.90,
            max_review_rounds: max_review_rounds || 2,
            manual_review_enabled: manual_review_enabled || false,
            manual_review_scope: manual_review_scope || 'failed',
            batch_id: batchId,
            created_by: 'admin'
        });

        res.json({
            success: true,
            message: '任务创建成功',
            task
        });

    } catch (error) {
        console.error('创建任务失败:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * 获取任务列表
 * GET /api/finetuning/task
 */
async function listTasks(req, res) {
    try {
        const { status, page = 1, pageSize = 20 } = req.query;

        const repo = new FinetuningTaskRepository(req.app.locals.pool);
        const tasks = await repo.findAll({ status, page, pageSize });

        // 获取每个任务的进度统计
        const tasksWithProgress = await Promise.all(
            tasks.map(async (task) => {
                const stats = await repo.getStats(task.id);
                return {
                    ...task,
                    stats: {
                        total_data: parseInt(stats.total_data) || 0,
                        passed_data: parseInt(stats.passed_data) || 0,
                        failed_data: parseInt(stats.failed_data) || 0,
                        optimized_data: parseInt(stats.optimized_data) || 0,
                        avg_score: parseFloat(stats.avg_score) || 0
                    }
                };
            })
        );

        res.json({
            success: true,
            tasks: tasksWithProgress,
            pagination: {
                page: parseInt(page),
                pageSize: parseInt(pageSize)
            }
        });

    } catch (error) {
        console.error('获取任务列表失败:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * 获取任务详情
 * GET /api/finetuning/task/:id
 */
async function getTask(req, res) {
    try {
        const { id } = req.params;

        const repo = new FinetuningTaskRepository(req.app.locals.pool);
        const task = await repo.findById(id);

        if (!task) {
            return res.status(404).json({ error: '任务不存在' });
        }

        const stats = await repo.getStats(id);

        res.json({
            success: true,
            task,
            stats: {
                total_data: parseInt(stats.total_data) || 0,
                reviewed_data: parseInt(stats.reviewed_data) || 0,
                passed_data: parseInt(stats.passed_data) || 0,
                failed_data: parseInt(stats.failed_data) || 0,
                optimized_data: parseInt(stats.optimized_data) || 0,
                manual_reviewed_data: parseInt(stats.manual_reviewed_data) || 0,
                avg_score: parseFloat(stats.avg_score) || 0
            }
        });

    } catch (error) {
        console.error('获取任务详情失败:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * 导入数据到任务
 * POST /api/finetuning/task/:id/import
 */
async function importData(req, res) {
    try {
        const { id } = req.params;
        const { source_batch_id, options } = req.body;

        if (!source_batch_id) {
            return res.status(400).json({ error: '源批次 ID 不能为空' });
        }

        const service = new FinetuningTaskService(req.app.locals.pool);
        const result = await service.importData(id, source_batch_id, options || {});

        res.json(result);

    } catch (error) {
        console.error('导入数据失败:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * 执行裂变
 * POST /api/finetuning/task/:id/fission
 */
async function runFission(req, res) {
    try {
        const { id } = req.params;
        const { count, requirement, fissionConfig } = req.body;

        const service = new FinetuningTaskService(req.app.locals.pool);
        const result = await service.runFission(id, fissionConfig || { count, requirement });

        res.json(result);

    } catch (error) {
        console.error('执行裂变失败:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * 启动 AI 审核
 * POST /api/finetuning/task/:id/review/start
 */
async function startReview(req, res) {
    try {
        const { id } = req.params;
        const { concurrency = 10 } = req.body;

        const service = new FinetuningTaskService(req.app.locals.pool);
        const result = await service.startAiReview(id, { concurrency });

        res.json(result);

    } catch (error) {
        console.error('启动 AI 审核失败:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * 获取审核进度
 * GET /api/finetuning/task/:id/review/status
 */
async function getReviewStatus(req, res) {
    try {
        const { id } = req.params;

        const service = new FinetuningTaskService(req.app.locals.pool);
        const progress = await service.getTaskProgress(id);

        res.json(progress);

    } catch (error) {
        console.error('获取审核进度失败:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * 启动 AI 优化
 * POST /api/finetuning/task/:id/optimize/start
 */
async function startOptimize(req, res) {
    try {
        const { id } = req.params;
        const { concurrency = 5 } = req.body;

        const service = new FinetuningTaskService(req.app.locals.pool);
        const result = await service.startAiOptimize(id, { concurrency });

        res.json(result);

    } catch (error) {
        console.error('启动 AI 优化失败:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * 启动人工审核
 * POST /api/finetuning/task/:id/manual-review/start
 */
async function startManualReview(req, res) {
    try {
        const { id } = req.params;

        const service = new FinetuningTaskService(req.app.locals.pool);
        const result = await service.startManualReview(id);

        res.json(result);

    } catch (error) {
        console.error('启动人工审核失败:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * 获取任务数据列表
 * GET /api/finetuning/task/:id/data
 */
async function getTaskData(req, res) {
    try {
        const { id } = req.params;
        const { page = 1, pageSize = 50, status } = req.query;

        const task = await new FinetuningTaskRepository(req.app.locals.pool).findById(id);
        if (!task) {
            return res.status(404).json({ error: '任务不存在' });
        }

        // 查询任务关联批次的数据
        let query = `
            SELECT pd.*,
                   (SELECT MAX(rr.ai_score) FROM review_rounds rr WHERE rr.data_id = pd.id AND rr.task_id = $1) as max_ai_score,
                   (SELECT MAX(rr.manual_decision) FROM review_rounds rr WHERE rr.data_id = pd.id AND rr.task_id = $1 AND rr.round_type = 'manual_review') as manual_decision
            FROM processed_data pd
            WHERE pd.batch_id = $1 AND pd.deleted_at IS NULL
        `;

        const offset = (parseInt(page) - 1) * parseInt(pageSize);
        const values = [task.batch_id];

        // 状态筛选
        if (status) {
            if (status === 'passed') {
                query += ` AND pd.review_status = 'approved' `;
            } else if (status === 'failed') {
                query += ` AND pd.review_status = 'rejected' `;
            } else if (status === 'pending') {
                query += ` AND pd.review_status = 'pending' `;
            }
        }

        query += ` ORDER BY pd.created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
        values.push(parseInt(pageSize), offset);

        const result = await req.app.locals.pool.query(query, values);

        // 获取总数
        const countQuery = `SELECT COUNT(*) FROM processed_data WHERE batch_id = $1 AND deleted_at IS NULL`;
        const countResult = await req.app.locals.pool.query(countQuery, [task.batch_id]);

        res.json({
            success: true,
            data: result.rows,
            pagination: {
                page: parseInt(page),
                pageSize: parseInt(pageSize),
                total: parseInt(countResult.rows[0].count)
            }
        });

    } catch (error) {
        console.error('获取任务数据失败:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * 获取单条数据审核详情
 * GET /api/finetuning/task/:id/data/:dataId
 */
async function getDataDetail(req, res) {
    try {
        const { id: taskId, dataId } = req.params;

        const roundRepo = new ReviewRoundRepository(req.app.locals.pool);
        const rounds = await roundRepo.findAllForData(taskId, dataId);

        // 获取数据详情
        const dataResult = await req.app.locals.pool.query(
            `SELECT * FROM processed_data WHERE id = $1`,
            [dataId]
        );

        if (dataResult.rows.length === 0) {
            return res.status(404).json({ error: '数据不存在' });
        }

        res.json({
            success: true,
            data: dataResult.rows[0],
            review_rounds: rounds
        });

    } catch (error) {
        console.error('获取数据详情失败:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * 提交人工审核结果
 * POST /api/finetuning/task/:id/data/:dataId/manual-review
 */
async function submitManualReview(req, res) {
    try {
        const { id: taskId, dataId } = req.params;
        const { decision, reason } = req.body;

        if (!decision || !['approved', 'rejected', 'request_optimization'].includes(decision)) {
            return res.status(400).json({ error: '无效的审核决策' });
        }

        const service = new FinetuningTaskService(req.app.locals.pool);
        const result = await service.submitManualReview(taskId, dataId, decision, reason || '', 'admin');

        res.json(result);

    } catch (error) {
        console.error('提交人工审核失败:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * 人工优化（带提示词）
 * POST /api/finetuning/task/:id/data/:dataId/optimize
 */
async function manualOptimize(req, res) {
    try {
        const { id: taskId, dataId } = req.params;
        const { prompt, recordFeedback = true } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: '优化提示词不能为空' });
        }

        const service = new FinetuningTaskService(req.app.locals.pool);
        const result = await service.optimizeWithPrompt(
            taskId,
            dataId,
            prompt,
            recordFeedback,
            'admin'
        );

        res.json(result);

    } catch (error) {
        console.error('人工优化失败:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * 获取反馈日志
 * GET /api/finetuning/task/:id/feedback-logs
 */
async function getFeedbackLogs(req, res) {
    try {
        const { id: taskId } = req.params;
        const { dataId, suggestionType, notApplied } = req.query;

        const feedbackLogRepo = new (require('../repository/ReviewFeedbackLogRepository'))(req.app.locals.pool);

        let logs;
        if (dataId) {
            logs = await feedbackLogRepo.findByDataId(dataId);
        } else {
            logs = await feedbackLogRepo.findByTaskId(taskId, {
                suggestionType: suggestionType || null,
                notApplied: notApplied === 'true'
            });
        }

        res.json({
            success: true,
            logs,
            count: logs.length
        });

    } catch (error) {
        console.error('获取反馈日志失败:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * 应用反馈到提示词
 * POST /api/finetuning/task/:id/feedback/apply
 */
async function applyFeedback(req, res) {
    try {
        const { id: taskId } = req.params;
        const { logIds } = req.body;  // 日志 ID 数组

        if (!logIds || !Array.isArray(logIds)) {
            return res.status(400).json({ error: '日志 ID 列表不能为空' });
        }

        const feedbackLogRepo = new (require('../repository/ReviewFeedbackLogRepository'))(req.app.locals.pool);
        const count = await feedbackLogRepo.batchMarkAsApplied(logIds.map(id => parseInt(id)));

        res.json({
            success: true,
            count,
            message: `已标记 ${count} 条反馈为已应用`
        });

    } catch (error) {
        console.error('应用反馈失败:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * 获取待人工审核的数据列表
 * GET /api/finetuning/task/:id/manual-review/list
 */
async function getManualReviewList(req, res) {
    try {
        const { id } = req.params;
        const { page = 1, pageSize = 20 } = req.query;

        const taskRepo = new FinetuningTaskRepository(req.app.locals.pool);
        const task = await taskRepo.findById(id);
        if (!task) {
            return res.status(404).json({ error: '任务不存在' });
        }

        // 获取需要人工审核的数据 ID
        const dataIds = await taskRepo.getDataForManualReview(id, task.manual_review_scope);

        if (dataIds.length === 0) {
            return res.json({
                success: true,
                data: [],
                pagination: { page: 1, pageSize: parseInt(pageSize), total: 0 }
            });
        }

        // 分页
        const start = (parseInt(page) - 1) * parseInt(pageSize);
        const end = start + parseInt(pageSize);
        const pageDataIds = dataIds.slice(start, end);

        // 查询数据详情
        const placeholders = pageDataIds.map((_, i) => `$${i + 1}`).join(',');
        const query = `
            SELECT pd.*, rr.ai_score, rr.ai_feedback, rr.manual_decision
            FROM processed_data pd
            LEFT JOIN review_rounds rr ON pd.id = rr.data_id AND rr.task_id = $${pageDataIds.length + 1}
            WHERE pd.id IN (${placeholders})
            ORDER BY pd.created_at DESC
        `;
        const values = [...pageDataIds, id];
        const result = await req.app.locals.pool.query(query, values);

        res.json({
            success: true,
            data: result.rows,
            pagination: {
                page: parseInt(page),
                pageSize: parseInt(pageSize),
                total: dataIds.length
            }
        });

    } catch (error) {
        console.error('获取人工审核列表失败:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * 完成任务
 * POST /api/finetuning/task/:id/complete
 */
async function completeTask(req, res) {
    try {
        const { id } = req.params;

        const service = new FinetuningTaskService(req.app.locals.pool);
        const result = await service.completeTask(id);

        res.json(result);

    } catch (error) {
        console.error('完成任务失败:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * 删除任务
 * DELETE /api/finetuning/task/:id
 */
async function deleteTask(req, res) {
    try {
        const { id } = req.params;

        const repo = new FinetuningTaskRepository(req.app.locals.pool);
        const task = await repo.delete(id);

        if (!task) {
            return res.status(404).json({ error: '任务不存在' });
        }

        res.json({ success: true, message: '任务已删除' });

    } catch (error) {
        console.error('删除任务失败:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * 导出微调数据
 * GET /api/finetuning/task/:id/export
 */
async function exportData(req, res) {
    try {
        const { id } = req.params;
        const { format = 'sft', dataIds } = req.query;

        const task = await new FinetuningTaskRepository(req.app.locals.pool).findById(id);
        if (!task) {
            return res.status(404).json({ error: '任务不存在' });
        }

        const exportService = new FinetuningExportService(req.app.locals.pool);

        // 获取已审核通过的数据 - 按任务批次过滤
        let exportDataIds = null;
        if (dataIds) {
            exportDataIds = Array.isArray(dataIds) ? dataIds : [dataIds];
        } else {
            // 没有指定 dataIds 时，获取当前任务批次的所有已审核数据
            const batchDataQuery = `
                SELECT id FROM processed_data
                WHERE batch_id = $1 AND review_status = 'approved'
            `;
            const batchDataResult = await req.app.locals.pool.query(batchDataQuery, [task.batch_id]);
            exportDataIds = batchDataResult.rows.map(r => r.id);
        }

        const result = await exportService.exportToJsonl(exportDataIds, format);

        // 标记已导出的数据
        if (exportDataIds) {
            await exportService.markAsExported(exportDataIds);
        } else {
            // 导出全部时，标记所有已审核通过的数据
            const allDataQuery = `
                SELECT id FROM processed_data
                WHERE batch_id = $1 AND review_status = 'approved'
            `;
            const allDataResult = await req.app.locals.pool.query(allDataQuery, [task.batch_id]);
            if (allDataResult.rows.length > 0) {
                await exportService.markAsExported(allDataResult.rows.map(r => r.id));
            }
        }

        res.json({
            success: true,
            format,
            count: result.count,
            data: result.lines
        });

    } catch (error) {
        console.error('导出数据失败:', error);
        res.status(500).json({ error: error.message });
    }
}

// 注册路由
router.post('/task', createTask);
router.get('/task', listTasks);
router.get('/task/:id', getTask);
router.post('/task/:id/import', importData);
router.post('/task/:id/fission', runFission);  // 新增裂变 API
router.post('/task/:id/review/start', startReview);
router.get('/task/:id/review/status', getReviewStatus);
router.post('/task/:id/optimize/start', startOptimize);
router.post('/task/:id/manual-review/start', startManualReview);
router.get('/task/:id/data', getTaskData);
router.get('/task/:id/data/:dataId', getDataDetail);
router.post('/task/:id/data/:dataId/manual-review', submitManualReview);
router.post('/task/:id/data/:dataId/optimize', manualOptimize);  // 人工优化 API
router.get('/task/:id/feedback-logs', getFeedbackLogs);  // 反馈日志 API
router.post('/task/:id/feedback/apply', applyFeedback);  // 应用反馈 API
router.get('/task/:id/manual-review/list', getManualReviewList);
router.post('/task/:id/complete', completeTask);
router.delete('/task/:id', deleteTask);
router.get('/task/:id/export', exportData);

module.exports = router;
