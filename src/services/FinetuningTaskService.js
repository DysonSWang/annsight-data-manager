const { v4: uuidv4 } = require('uuid');
const FinetuningTaskRepository = require('../repository/FinetuningTaskRepository');
const ReviewRoundRepository = require('../repository/ReviewRoundRepository');
const ProcessedDataRepository = require('../repository/ProcessedDataRepository');
const AiReviewService = require('./AiReviewService');
const AiOptimizeService = require('./AiOptimizeService');

/**
 * 微调任务管理服务
 * 编排整个微调数据的 AI 审核→AI 优化→人工审核流程
 */
class FinetuningTaskService {
    constructor(pool, options = {}) {
        this.pool = pool;
        this.taskRepo = new FinetuningTaskRepository(pool);
        this.roundRepo = new ReviewRoundRepository(pool);
        this.dataRepo = new ProcessedDataRepository(pool);
        this.aiReviewService = new AiReviewService(options);
        this.aiOptimizeService = new AiOptimizeService(options);
    }

    /**
     * 创建微调任务
     */
    async createTask(taskConfig) {
        const task = await this.taskRepo.create({
            id: `ft-${uuidv4()}`,
            name: taskConfig.name,
            purpose: taskConfig.purpose,
            pass_threshold: taskConfig.pass_threshold || 0.90,
            max_review_rounds: taskConfig.max_review_rounds || 2,
            manual_review_enabled: taskConfig.manual_review_enabled || false,
            manual_review_scope: taskConfig.manual_review_scope || 'failed',
            batch_id: taskConfig.batch_id,
            created_by: taskConfig.created_by || 'admin'
        });

        console.log('[FinetuningTaskService] 任务创建成功:', task.id);
        return task;
    }

    /**
     * 导入数据到任务（将批次数据关联到任务）
     */
    async importData(taskId, sourceBatchId) {
        const task = await this.taskRepo.findById(taskId);
        if (!task) {
            throw new Error('任务不存在');
        }

        // 查询源批次的所有 processed_data
        const query = `
            SELECT id, type, category, title, content, conversation
            FROM processed_data
            WHERE batch_id = $1 AND deleted_at IS NULL
        `;
        const result = await this.pool.query(query, [sourceBatchId]);

        if (result.rows.length === 0) {
            return { success: false, message: '批次中没有数据', count: 0 };
        }

        // 更新任务的 batch_id 为源批次 ID
        await this.taskRepo.update(taskId, { batch_id: sourceBatchId });

        console.log(`[FinetuningTaskService] 导入 ${result.rows.length} 条数据到任务 ${taskId}`);
        return {
            success: true,
            message: '数据导入成功',
            count: result.rows.length,
            dataIds: result.rows.map(r => r.id)
        };
    }

    /**
     * 启动 AI 审核流程
     * 并行处理所有数据，高效审核
     */
    async startAiReview(taskId, options = {}) {
        const task = await this.taskRepo.findById(taskId);
        if (!task) {
            throw new Error('任务不存在');
        }

        // 检查是否可以开始审核
        const canStart = await this.taskRepo.canStartReview(taskId);
        if (!canStart.can) {
            throw new Error(canStart.reason);
        }

        // 更新任务状态
        await this.taskRepo.updateStatus(taskId, 'reviewing');

        // 获取任务关联批次的所有数据
        const dataQuery = `
            SELECT id, type, category, title, content, conversation
            FROM processed_data
            WHERE batch_id = $1 AND deleted_at IS NULL
        `;
        const dataResult = await this.pool.query(dataQuery, [task.batch_id]);
        const dataList = dataResult.rows;

        console.log(`[FinetuningTaskService] 开始 AI 审核，共 ${dataList.length} 条数据`);

        // 获取需要审核的数据（跳过已完成的）
        const needReviewData = await this._getDataNeedReview(taskId, dataList, task.max_review_rounds);
        console.log(`[FinetuningTaskService] 需要审核的数据：${needReviewData.length} 条`);

        if (needReviewData.length === 0) {
            return {
                success: true,
                message: '所有数据已完成审核',
                reviewed: 0
            };
        }

        // 并发执行 AI 审核（高效模式）
        const concurrency = options.concurrency || 10;  // 默认 10 并发
        const results = await this._batchAiReview(taskId, needReviewData, task.purpose, concurrency);

        // 统计结果
        const passedCount = results.filter(r => r.success && r.ai_passed).length;
        const failedCount = results.filter(r => r.success && !r.ai_passed).length;
        const errorCount = results.filter(r => !r.success).length;

        console.log(`[FinetuningTaskService] AI 审核完成：通过 ${passedCount}, 失败 ${failedCount}, 错误 ${errorCount}`);

        // 检查是否需要进入优化流程
        const needOptimize = results.filter(r => r.success && !r.ai_passed);
        if (needOptimize.length > 0) {
            // 检查是否还有剩余审核轮次
            const canOptimize = needOptimize.filter(r => r.current_round < task.max_review_rounds);
            if (canOptimize.length > 0) {
                console.log(`[FinetuningTaskService] 有 ${canOptimize.length} 条数据需要优化并重新审核`);
                // 这里可以先记录，后续调用 startAiOptimize
            }
        }

        return {
            success: true,
            message: 'AI 审核完成',
            reviewed: results.length,
            passed: passedCount,
            failed: failedCount,
            errors: errorCount,
            needOptimize: needOptimize.length
        };
    }

    /**
     * 获取需要审核的数据
     * @private
     */
    async _getDataNeedReview(taskId, allData, maxRounds) {
        const needReview = [];

        for (const data of allData) {
            const latestRound = await this.roundRepo.findLatestForData(taskId, data.id);

            if (!latestRound) {
                // 还未审核
                needReview.push({ ...data, current_round: 0 });
            } else if (latestRound.round_type === 'ai_optimize' && latestRound.round_number < maxRounds) {
                // 优化后需要重新审核
                needReview.push({ ...data, current_round: latestRound.round_number });
            }
            // 其他情况：已完成审核或已达到最大轮次
        }

        return needReview;
    }

    /**
     * 批量 AI 审核
     * @private
     */
    async _batchAiReview(taskId, dataList, purpose, concurrency) {
        const results = [];
        const chunks = this._chunkArray(dataList, concurrency);

        for (const chunk of chunks) {
            const chunkPromises = chunk.map(async (data) => {
                const roundNumber = (data.current_round || 0) + 1;
                console.log(`[AiReview] 审核数据 ${data.id} (第 ${roundNumber} 轮)`);

                try {
                    // 调用 AI 审核
                    const reviewResult = await this.aiReviewService.review(data, purpose);

                    if (!reviewResult.success) {
                        // 记录失败
                        await this.roundRepo.create({
                            task_id: taskId,
                            data_id: data.id,
                            round_number: roundNumber,
                            round_type: 'ai_review',
                            ai_score: null,
                            ai_passed: false,
                            status: 'failed',
                            error_message: reviewResult.error
                        });
                        return { success: false, error: reviewResult.error, data_id: data.id };
                    }

                    // 记录审核结果
                    const round = await this.roundRepo.create({
                        task_id: taskId,
                        data_id: data.id,
                        round_number: roundNumber,
                        round_type: 'ai_review',
                        ai_score: reviewResult.ai_score,
                        ai_dimension_scores: reviewResult.ai_dimension_scores,
                        ai_feedback: reviewResult.ai_feedback,
                        ai_suggestions: reviewResult.ai_suggestions,
                        ai_passed: reviewResult.ai_passed,
                        status: 'completed'
                    });

                    return {
                        success: true,
                        ai_passed: reviewResult.ai_passed,
                        ai_score: reviewResult.ai_score,
                        data_id: data.id,
                        current_round: roundNumber
                    };

                } catch (error) {
                    console.error(`[AiReview] 审核数据 ${data.id} 失败:`, error.message);
                    await this.roundRepo.create({
                        task_id: taskId,
                        data_id: data.id,
                        round_number: roundNumber,
                        round_type: 'ai_review',
                        status: 'failed',
                        error_message: error.message
                    });
                    return { success: false, error: error.message, data_id: data.id };
                }
            });

            const chunkResults = await Promise.all(chunkPromises);
            results.push(...chunkResults);
        }

        return results;
    }

    /**
     * 启动 AI 优化流程
     */
    async startAiOptimize(taskId, options = {}) {
        const task = await this.taskRepo.findById(taskId);
        if (!task) {
            throw new Error('任务不存在');
        }

        // 获取需要优化的数据（AI 审核未通过且还有剩余轮次）
        const needOptimizeData = await this._getDataNeedOptimize(taskId, task.max_review_rounds);
        console.log(`[FinetuningTaskService] 需要优化的数据：${needOptimizeData.length} 条`);

        if (needOptimizeData.length === 0) {
            return {
                success: true,
                message: '没有数据需要优化',
                optimized: 0
            };
        }

        // 更新任务状态
        await this.taskRepo.updateStatus(taskId, 'optimizing');

        // 并发执行 AI 优化
        const concurrency = options.concurrency || 5;  // 优化并发度低一些，因为 token 更多
        const results = await this._batchAiOptimize(taskId, needOptimizeData, concurrency);

        const successCount = results.filter(r => r.success).length;
        console.log(`[FinetuningTaskService] AI 优化完成：成功 ${successCount}/${results.length}`);

        return {
            success: true,
            message: 'AI 优化完成',
            optimized: successCount,
            total: results.length
        };
    }

    /**
     * 获取需要优化的数据
     * @private
     */
    async _getDataNeedOptimize(taskId, maxRounds) {
        const query = `
            SELECT DISTINCT ON (rr.data_id)
                rr.data_id,
                rr.ai_score,
                rr.ai_feedback,
                rr.ai_suggestions,
                rr.round_number as current_round,
                pd.type, pd.category, pd.title, pd.content, pd.conversation
            FROM review_rounds rr
            JOIN processed_data pd ON rr.data_id = pd.id
            WHERE rr.task_id = $1
              AND rr.round_type = 'ai_review'
              AND rr.ai_score < (SELECT pass_threshold FROM finetuning_tasks WHERE id = $1)
              AND rr.round_number < $2
              AND rr.optimized = FALSE
            ORDER BY rr.data_id, rr.round_number DESC
        `;
        const result = await this.pool.query(query, [taskId, maxRounds]);
        return result.rows;
    }

    /**
     * 批量 AI 优化
     * @private
     */
    async _batchAiOptimize(taskId, dataList, concurrency) {
        const results = [];
        const chunks = this._chunkArray(dataList, concurrency);

        for (const chunk of chunks) {
            const chunkPromises = chunk.map(async (data) => {
                console.log(`[AiOptimize] 优化数据 ${data.data_id}`);

                try {
                    // 调用 AI 优化
                    const optimizeResult = await this.aiOptimizeService.optimize(
                        {
                            type: data.type,
                            category: data.category,
                            title: data.title,
                            content: data.content,
                            conversation: data.conversation
                        },
                        data.ai_feedback || '',
                        data.ai_suggestions || []
                    );

                    if (!optimizeResult.success) {
                        return { success: false, error: optimizeResult.error, data_id: data.data_id };
                    }

                    // 更新审核轮次记录（标记已优化）
                    await this.roundRepo.create({
                        task_id: taskId,
                        data_id: data.data_id,
                        round_number: data.current_round,
                        round_type: 'ai_optimize',
                        optimized: true,
                        optimization_result: optimizeResult.optimized,
                        optimization_applied: false,  // 需要后续确认是否应用
                        status: 'completed'
                    });

                    // 如果优化后有变化，更新 processed_data
                    if (optimizeResult.hasChanged) {
                        await this.dataRepo.update(data.data_id, {
                            title: optimizeResult.optimized.title,
                            content: optimizeResult.optimized.content,
                            conversation: optimizeResult.optimized.conversation
                        });
                    }

                    return {
                        success: true,
                        data_id: data.data_id,
                        hasChanged: optimizeResult.hasChanged
                    };

                } catch (error) {
                    console.error(`[AiOptimize] 优化数据 ${data.data_id} 失败:`, error.message);
                    return { success: false, error: error.message, data_id: data.data_id };
                }
            });

            const chunkResults = await Promise.all(chunkPromises);
            results.push(...chunkResults);
        }

        return results;
    }

    /**
     * 启动人工审核流程
     */
    async startManualReview(taskId) {
        const task = await this.taskRepo.findById(taskId);
        if (!task) {
            throw new Error('任务不存在');
        }

        if (!task.manual_review_enabled) {
            return {
                success: false,
                message: '该任务未启用人工审核'
            };
        }

        // 获取需要人工审核的数据
        const dataIds = await this.taskRepo.getDataForManualReview(
            taskId,
            task.manual_review_scope
        );

        console.log(`[FinetuningTaskService] 人工审核数据：${dataIds.length} 条`);

        if (dataIds.length === 0) {
            return {
                success: true,
                message: '没有数据需要人工审核',
                count: 0
            };
        }

        // 更新任务状态
        await this.taskRepo.updateStatus(taskId, 'manual_review');

        return {
            success: true,
            message: '人工审核已启动',
            count: dataIds.length,
            dataIds: dataIds
        };
    }

    /**
     * 提交人工审核结果
     */
    async submitManualReview(taskId, dataId, decision, reason, reviewer = 'admin') {
        const task = await this.taskRepo.findById(taskId);
        if (!task) {
            throw new Error('任务不存在');
        }

        // 获取最新审核轮次
        const latestRound = await this.roundRepo.findLatestForData(taskId, dataId);
        if (!latestRound) {
            throw new Error('数据没有审核记录');
        }

        // 更新或创建人工审核记录
        let round;
        if (latestRound.round_type === 'manual_review') {
            // 更新现有人工审核记录
            round = await this.roundRepo.update(latestRound.id, {
                manual_reviewed: true,
                manual_decision: decision,
                manual_reason: reason,
                manual_reviewer: reviewer,
                manual_reviewed_at: new Date()
            });
        } else {
            // 创建新的人工审核记录
            round = await this.roundRepo.create({
                task_id: taskId,
                data_id: dataId,
                round_number: latestRound.round_number,
                round_type: 'manual_review',
                manual_reviewed: true,
                manual_decision: decision,
                manual_reason: reason,
                manual_reviewer: reviewer
            });
        }

        // 如果是 approved，更新 processed_data 的 review_status
        if (decision === 'approved') {
            await this.dataRepo.approve(dataId, reviewer);
        } else if (decision === 'rejected') {
            await this.dataRepo.reject(dataId, reviewer, reason || '人工审核拒绝');
        }

        console.log(`[FinetuningTaskService] 人工审核完成：${dataId} -> ${decision}`);
        return { success: true, round };
    }

    /**
     * 获取任务进度
     */
    async getTaskProgress(taskId) {
        const task = await this.taskRepo.findById(taskId);
        if (!task) {
            throw new Error('任务不存在');
        }

        const stats = await this.taskRepo.getStats(taskId);
        const progressStats = await this.roundRepo.getProgressStats(taskId);

        return {
            task,
            stats: {
                total_data: parseInt(stats.total_data) || 0,
                reviewed_data: parseInt(stats.reviewed_data) || 0,
                passed_data: parseInt(stats.passed_data) || 0,
                failed_data: parseInt(stats.failed_data) || 0,
                optimized_data: parseInt(stats.optimized_data) || 0,
                manual_reviewed_data: parseInt(stats.manual_reviewed_data) || 0,
                avg_score: parseFloat(stats.avg_score) || 0
            },
            progress: {
                total_records: parseInt(progressStats.total_records) || 0,
                ai_reviewed: parseInt(progressStats.ai_reviewed) || 0,
                ai_passed: parseInt(progressStats.ai_passed) || 0,
                ai_failed: parseInt(progressStats.ai_failed) || 0,
                optimized: parseInt(progressStats.optimized) || 0,
                manual_reviewed: parseInt(progressStats.manual_reviewed) || 0
            }
        };
    }

    /**
     * 完成任务
     */
    async completeTask(taskId) {
        const task = await this.taskRepo.findById(taskId);
        if (!task) {
            throw new Error('任务不存在');
        }

        await this.taskRepo.updateStatus(taskId, 'completed');
        console.log(`[FinetuningTaskService] 任务完成：${taskId}`);
        return { success: true };
    }

    /**
     * 数组分块
     * @private
     */
    _chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }
}

module.exports = FinetuningTaskService;
