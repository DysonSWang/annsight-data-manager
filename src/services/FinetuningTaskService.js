const { v4: uuidv4 } = require('uuid');
const FinetuningTaskRepository = require('../repository/FinetuningTaskRepository');
const ReviewRoundRepository = require('../repository/ReviewRoundRepository');
const ProcessedDataRepository = require('../repository/ProcessedDataRepository');
const ReviewFeedbackLogRepository = require('../repository/ReviewFeedbackLogRepository');
const AiReviewService = require('./AiReviewService');
const AiOptimizeService = require('./AiOptimizeService');
const { EtlService } = require('../pipeline/etl-service');

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
        this.feedbackLogRepo = new ReviewFeedbackLogRepository(pool);
        this.aiReviewService = new AiReviewService(options);
        this.aiOptimizeService = new AiOptimizeService(options);
        this.etlService = new EtlService(pool, options);
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
     * 导入数据到任务
     * 核心逻辑：
     * 1. 只允许导入 review_status = 'approved' 的数据
     * 2. 复制数据到任务专属批次，而非简单关联
     * 3. 记录来源追踪信息（source_data_id, source_task_id）
     * 4. 审核状态始终重置为 pending，进入微调审核新阶段
     * 5. 支持传入 AI 审核配置和人工审核配置
     */
    async importData(taskId, sourceBatchId, options = {}) {
        const task = await this.taskRepo.findById(taskId);
        if (!task) {
            throw new Error('任务不存在');
        }

        const {
            fissionConfig = null,
            aiReviewConfig = null,
            manualReviewConfig = null
        } = options;

        console.log('[FinetuningTaskService] 开始导入数据:', {
            taskId,
            sourceBatchId,
            hasAiReviewConfig: !!aiReviewConfig,
            hasManualReviewConfig: !!manualReviewConfig,
            hasFissionConfig: !!fissionConfig,
            sourceDataCount: 0  // 待查询
        });

        // 1. 只查询审核通过的数据
        const sourceQuery = `
            SELECT id, type, category, title, content, conversation, tags, review_status
            FROM processed_data
            WHERE batch_id = $1
              AND review_status = 'approved'
              AND deleted_at IS NULL
        `;
        const sourceResult = await this.pool.query(sourceQuery, [sourceBatchId]);

        if (sourceResult.rows.length === 0) {
            throw new Error('该批次没有审核通过的数据');
        }

        console.log('[FinetuningTaskService] 查询到源数据:', sourceResult.rows.length, '条');

        // 2. 为任务生成专属批次 ID（缩短格式以适应 varchar(32) 限制）
        // 格式：ft-{timestamp}-{8 位随机数} = 3+1+13+1+8 = 26 字符
        const taskBatchId = `ft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

        // 3. 复制数据到任务专属批次
        const copiedDataIds = [];
        const taskContext = {
            purpose: task.purpose,
            importedFrom: sourceBatchId,
            importedAt: new Date().toISOString()
        };

        for (const row of sourceResult.rows) {
            const newId = `pd-${uuidv4()}`;

            // 显式序列化所有 JSONB 字段为 JSON 字符串
            const tagsValue = row.tags ? JSON.stringify(row.tags) : null;
            const conversationValue = row.conversation ? JSON.stringify(row.conversation) : null;

            await this.pool.query(`
                INSERT INTO processed_data (
                    id, batch_id, source_data_id, source_task_id,
                    type, category, title, content, conversation,
                    review_status, tags, created_at, task_context,
                    fission_config
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::jsonb, NOW(), $12::jsonb, $13::jsonb)
            `, [
                newId,
                taskBatchId,
                row.id,                    // source_data_id
                taskId,                    // source_task_id
                row.type,
                row.category,
                row.title,
                row.content,
                conversationValue,
                'pending',                 // 始终重置为 pending
                tagsValue,
                JSON.stringify(taskContext),
                fissionConfig ? JSON.stringify(fissionConfig) : null
            ]);
            copiedDataIds.push(newId);
        }

        // 4. 更新任务的 batch_id 为专属批次，并保存审核配置
        const taskUpdateData = {
            batch_id: taskBatchId
        };

        // 保存 AI 审核配置
        if (aiReviewConfig) {
            taskUpdateData.ai_review_enabled = aiReviewConfig.enabled !== false;  // 默认启用
            taskUpdateData.ai_review_max_rounds = aiReviewConfig.maxRounds || 2;
            taskUpdateData.ai_review_pass_threshold = aiReviewConfig.passThreshold || 0.85;
            taskUpdateData.ai_auto_optimize_enabled = aiReviewConfig.autoOptimize !== false;
        }

        // 保存人工审核配置
        if (manualReviewConfig) {
            taskUpdateData.manual_review_enabled = manualReviewConfig.enabled !== false;
            taskUpdateData.manual_review_scope = manualReviewConfig.scope || 'failed';
            taskUpdateData.manual_review_optimization_enabled = manualReviewConfig.optimizationEnabled !== false;
        }

        // 保存裂变配置
        if (fissionConfig) {
            taskUpdateData.fission_enabled = fissionConfig.enabled === true;
            taskUpdateData.fission_count = fissionConfig.count || 6;
            taskUpdateData.fission_requirement = fissionConfig.requirement || '';
        }

        await this.taskRepo.update(taskId, taskUpdateData);

        console.log(`[FinetuningTaskService] 导入 ${copiedDataIds.length} 条数据到任务 ${taskId}`);
        console.log(`  源批次：${sourceBatchId}`);
        console.log(`  任务批次：${taskBatchId}`);
        console.log(`  审核状态：重置为 pending`);
        console.log(`  AI 审核配置：`, aiReviewConfig ? '已保存' : '无');
        console.log(`  人工审核配置：`, manualReviewConfig ? '已保存' : '无');

        return {
            success: true,
            message: '数据导入成功',
            count: copiedDataIds.length,
            dataIds: copiedDataIds,
            taskBatchId,
            sourceBatchId,
            aiReviewConfig: aiReviewConfig ? {
                enabled: taskUpdateData.ai_review_enabled,
                maxRounds: taskUpdateData.ai_review_max_rounds,
                autoOptimize: taskUpdateData.ai_auto_optimize_enabled
            } : null,
            manualReviewConfig: manualReviewConfig ? {
                enabled: taskUpdateData.manual_review_enabled,
                scope: taskUpdateData.manual_review_scope
            } : null
        };
    }

    /**
     * 启动 AI 审核流程（支持多轮审核 + 优化循环）
     * 根据任务配置的 ai_review_max_rounds 和 ai_auto_optimize_enabled 执行
     */
    async startAiReview(taskId, options = {}) {
        const task = await this.taskRepo.findById(taskId);
        if (!task) {
            throw new Error('任务不存在');
        }

        // 检查 AI 审核是否启用
        if (task.ai_review_enabled === false) {
            return {
                success: true,
                message: 'AI 审核未启用，跳过',
                skipped: true
            };
        }

        // 使用任务配置的参数
        const maxRounds = task.ai_review_max_rounds || 2;
        const passThreshold = task.ai_review_pass_threshold || 0.85;
        const autoOptimize = task.ai_auto_optimize_enabled !== false;

        console.log(`[FinetuningTaskService] 开始 AI 审核，配置：maxRounds=${maxRounds}, passThreshold=${passThreshold}, autoOptimize=${autoOptimize}`);

        // 获取任务关联批次的所有数据
        const dataQuery = `
            SELECT id, type, category, title, content, conversation
            FROM processed_data
            WHERE batch_id = $1 AND deleted_at IS NULL
        `;
        const dataResult = await this.pool.query(dataQuery, [task.batch_id]);
        const dataList = dataResult.rows;

        console.log(`[FinetuningTaskService] 开始 AI 审核，共 ${dataList.length} 条数据`);

        // 执行多轮审核 + 优化循环
        const roundStats = [];
        let currentRound = 1;
        let remainingData = dataList;

        while (currentRound <= maxRounds && remainingData.length > 0) {
            console.log(`\n[FinetuningTaskService] 第 ${currentRound} 轮审核开始，数据量：${remainingData.length}`);

            // 获取需要审核的数据（跳过已完成的）
            const needReviewData = await this._getDataNeedReviewForRound(taskId, remainingData, currentRound);
            console.log(`[FinetuningTaskService] 需要审核的数据：${needReviewData.length} 条`);

            if (needReviewData.length === 0) {
                currentRound++;
                continue;
            }

            // 并发执行 AI 审核
            const concurrency = options.concurrency || 10;
            const results = await this._batchAiReviewWithThreshold(taskId, needReviewData, task.purpose, concurrency, passThreshold);

            // 统计本轮结果
            const passedCount = results.filter(r => r.success && r.ai_passed).length;
            const failedCount = results.filter(r => r.success && !r.ai_passed).length;
            const errorCount = results.filter(r => !r.success).length;

            roundStats.push({
                round: currentRound,
                total: results.length,
                passed: passedCount,
                failed: failedCount,
                errors: errorCount
            });

            console.log(`[FinetuningTaskService] 第 ${currentRound} 轮完成：通过 ${passedCount}, 失败 ${failedCount}, 错误 ${errorCount}`);

            // 检查是否需要进入优化流程
            const needOptimize = results.filter(r => r.success && !r.ai_passed);
            if (needOptimize.length > 0 && autoOptimize && currentRound < maxRounds) {
                console.log(`[FinetuningTaskService] 有 ${needOptimize.length} 条数据需要优化并重新审核`);

                // 执行优化
                await this._batchOptimizeAndMarkForReReview(taskId, needOptimize, currentRound);

                // 优化后数据会在下一轮重新审核
            }

            currentRound++;

            // 更新 remainingData 为未完成的数据
            const unfinishedDataIds = results.filter(r => !r.ai_passed).map(r => r.data_id);
            remainingData = dataList.filter(d => unfinishedDataIds.includes(d.id));
        }

        // 汇总所有轮次的结果
        const totalPassed = roundStats.reduce((sum, r) => sum + r.passed, 0);
        const totalFailed = roundStats.reduce((sum, r) => sum + r.failed, 0);
        const totalErrors = roundStats.reduce((sum, r) => sum + r.errors, 0);

        // 获取最终审核通过的数据量
        const finalApprovedQuery = `
            SELECT COUNT(DISTINCT data_id) as count
            FROM review_rounds
            WHERE task_id = $1
              AND round_type = 'ai_review'
              AND ai_passed = TRUE
        `;
        const finalApprovedResult = await this.pool.query(finalApprovedQuery, [taskId]);
        const finalApprovedCount = parseInt(finalApprovedResult.rows[0].count);

        console.log(`\n[FinetuningTaskService] AI 审核全部完成：最终通过 ${finalApprovedCount}/${dataList.length}`);

        return {
            success: true,
            message: 'AI 审核完成',
            summary: {
                total: dataList.length,
                finalApproved: finalApprovedCount,
                finalFailed: dataList.length - finalApprovedCount
            },
            rounds: roundStats,
            totalPassed: totalPassed,
            totalFailed: totalFailed,
            totalErrors: totalErrors
        };
    }

    /**
     * 获取指定轮次需要审核的数据
     * @private
     */
    async _getDataNeedReviewForRound(taskId, allData, targetRound) {
        const needReview = [];

        for (const data of allData) {
            const latestRound = await this.roundRepo.findLatestForData(taskId, data.id);

            if (!latestRound) {
                // 还未审核
                needReview.push({ ...data, current_round: 0 });
            } else if (latestRound.round_type === 'ai_optimize' && latestRound.round_number < targetRound) {
                // 优化后需要重新审核
                needReview.push({ ...data, current_round: latestRound.round_number });
            } else if (latestRound.round_type === 'ai_review' && latestRound.round_number === targetRound - 1 && !latestRound.ai_passed) {
                // 上一轮审核失败，等待重新审核
                needReview.push({ ...data, current_round: targetRound - 1 });
            }
            // 其他情况：已完成审核或已达到最大轮次
        }

        return needReview;
    }

    /**
     * 批量 AI 审核（支持阈值判断）
     * @private
     */
    async _batchAiReviewWithThreshold(taskId, dataList, purpose, concurrency, passThreshold) {
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

                    // 使用传入的阈值判断是否通过
                    const aiPassed = reviewResult.ai_score >= passThreshold;

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
                        ai_passed: aiPassed,
                        status: 'completed'
                    });

                    return {
                        success: true,
                        ai_passed: aiPassed,
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
     * 批量优化并标记为需要重新审核
     * @private
     */
    async _batchOptimizeAndMarkForReReview(taskId, needOptimizeData, currentRound) {
        const concurrency = 5;  // 优化并发度低一些
        const results = [];
        const chunks = this._chunkArray(needOptimizeData, concurrency);

        for (const chunk of chunks) {
            const chunkPromises = chunk.map(async (item) => {
                console.log(`[AiOptimize] 优化数据 ${item.data_id} (第 ${currentRound} 轮后)`);

                try {
                    // 获取完整数据
                    const dataQuery = `
                        SELECT type, category, title, content, conversation
                        FROM processed_data
                        WHERE id = $1
                    `;
                    const dataResult = await this.pool.query(dataQuery, [item.data_id]);
                    const data = dataResult.rows[0];

                    // 调用 AI 优化
                    const optimizeResult = await this.aiOptimizeService.optimize(
                        {
                            type: data.type,
                            category: data.category,
                            title: data.title,
                            content: data.content,
                            conversation: data.conversation
                        },
                        item.ai_feedback || '',
                        item.ai_suggestions || []
                    );

                    if (!optimizeResult.success) {
                        return { success: false, error: optimizeResult.error, data_id: item.data_id };
                    }

                    // 记录优化轮次
                    await this.roundRepo.create({
                        task_id: taskId,
                        data_id: item.data_id,
                        round_number: currentRound,
                        round_type: 'ai_optimize',
                        optimized: true,
                        optimization_result: optimizeResult.optimized,
                        status: 'completed'
                    });

                    // 如果优化后有变化，更新 processed_data
                    if (optimizeResult.hasChanged) {
                        await this.dataRepo.update(item.data_id, {
                            title: optimizeResult.optimized.title,
                            content: optimizeResult.optimized.content,
                            conversation: optimizeResult.optimized.conversation
                        });
                    }

                    return {
                        success: true,
                        data_id: item.data_id,
                        hasChanged: optimizeResult.hasChanged
                    };

                } catch (error) {
                    console.error(`[AiOptimize] 优化数据 ${item.data_id} 失败:`, error.message);
                    return { success: false, error: error.message, data_id: item.data_id };
                }
            });

            const chunkResults = await Promise.all(chunkPromises);
            results.push(...chunkResults);
        }

        console.log(`[FinetuningTaskService] 优化完成：成功 ${results.filter(r => r.success).length}/${results.length}`);
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
     * 人工优化（带提示词，记录反馈日志）
     * @param {string} taskId - 任务 ID
     * @param {string} dataId - 数据 ID
     * @param {string} prompt - 优化提示词
     * @param {boolean} recordFeedback - 是否记录到反馈日志
     * @param {string} reviewer - 审核人
     */
    async optimizeWithPrompt(taskId, dataId, prompt, recordFeedback = true, reviewer = 'admin') {
        const task = await this.taskRepo.findById(taskId);
        if (!task) {
            throw new Error('任务不存在');
        }

        // 获取完整数据
        const dataQuery = `
            SELECT type, category, title, content, conversation
            FROM processed_data
            WHERE id = $1
        `;
        const dataResult = await this.pool.query(dataQuery, [dataId]);
        if (dataResult.rows.length === 0) {
            throw new Error('数据不存在');
        }
        const data = dataResult.rows[0];

        console.log(`[FinetuningTaskService] 人工优化数据 ${dataId}，提示词：${prompt?.slice(0, 50)}...`);

        // 调用 AI 优化服务
        const optimizeResult = await this.aiOptimizeService.optimize(
            {
                type: data.type,
                category: data.category,
                title: data.title,
                content: data.content,
                conversation: data.conversation
            },
            prompt,
            []  // 人工优化时不使用 AI 建议
        );

        if (!optimizeResult.success) {
            throw new Error(optimizeResult.error || '优化失败');
        }

        // 如果优化后有变化，更新 processed_data
        if (optimizeResult.hasChanged) {
            await this.dataRepo.update(dataId, {
                title: optimizeResult.optimized.title,
                content: optimizeResult.optimized.content,
                conversation: optimizeResult.optimized.conversation
            });
        }

        // 记录人工审核轮次
        const latestRound = await this.roundRepo.findLatestForData(taskId, dataId);
        const roundNumber = latestRound ? latestRound.round_number : 0;
        await this.roundRepo.create({
            task_id: taskId,
            data_id: dataId,
            round_number: roundNumber,
            round_type: 'manual_review',
            manual_optimization_prompt: prompt,
            optimized: true,
            optimization_result: optimizeResult.optimized,
            status: 'completed'
        });

        // 记录反馈日志（如果启用）
        let feedbackRecorded = false;
        if (recordFeedback) {
            const feedback = await this.feedbackLogRepo.create({
                task_id: taskId,
                data_id: dataId,
                suggestion_type: 'human_optimization',
                original_prompt: '辅助审核',
                user_feedback: prompt,
                optimization_result: {
                    before: {
                        title: data.title,
                        content: data.content,
                        conversation: data.conversation
                    },
                    after: optimizeResult.optimized,
                    changes: optimizeResult.optimized?.changes || []
                },
                created_by: reviewer
            });
            feedbackRecorded = !!feedback;
            console.log(`[FinetuningTaskService] 反馈日志已记录：${dataId}`);
        }

        console.log(`[FinetuningTaskService] 人工优化完成：${dataId}`);
        return {
            success: true,
            optimizedContent: optimizeResult.optimized,
            changes: optimizeResult.optimized?.changes || [],
            feedbackRecorded
        };
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
     * 对任务数据执行裂变
     * 在微调环节，根据任务目的进行场景裂变
     * @param {string} taskId - 任务 ID
     * @param {object} fissionConfig - 裂变配置 { count, requirement }
     */
    async runFission(taskId, fissionConfig) {
        const task = await this.taskRepo.findById(taskId);
        if (!task) {
            throw new Error('任务不存在');
        }

        // 获取任务下的所有数据（专属批次）
        const dataQuery = `
            SELECT id, type, category, title, content, conversation, task_context, fission_config
            FROM processed_data
            WHERE batch_id = $1 AND deleted_at IS NULL
        `;
        const dataResult = await this.pool.query(dataQuery, [task.batch_id]);
        const dataList = dataResult.rows;

        if (dataList.length === 0) {
            throw new Error('任务中没有数据');
        }

        // 合并裂变配置：优先级为 传入配置 > 任务配置 > 数据配置 > 默认配置
        const mergedConfig = this._mergeFissionConfig(
            fissionConfig,
            task.fission_config,
            dataList[0].fission_config
        );

        console.log('[FinetuningTaskService] 开始执行裂变，任务:', taskId);
        console.log('  数据量:', dataList.length);
        console.log('  裂变配置:', mergedConfig);

        const fissionResults = [];
        for (const data of dataList) {
            try {
                // 调用 ETL 服务的裂变方法
                const result = await this.etlService.runPrincipleBasedFission(data, {
                    count: mergedConfig.count || 6,
                    requirement: mergedConfig.requirement || '同一理念，不同场景',
                    purpose: task.purpose
                });
                fissionResults.push(result);
            } catch (error) {
                console.error(`[FinetuningTaskService] 裂变数据 ${data.id} 失败:`, error.message);
                fissionResults.push({
                    success: false,
                    error: error.message,
                    data_id: data.id
                });
            }
        }

        // 更新任务的裂变状态
        await this.taskRepo.update(taskId, {
            fission_enabled: true,
            fission_count: mergedConfig.count || 6,
            fission_requirement: mergedConfig.requirement || ''
        });

        const totalFissionCount = fissionResults
            .filter(r => r.success)
            .reduce((sum, r) => sum + (r.count || 0), 0);
        const errorCount = fissionResults.filter(r => !r.success).length;

        console.log('[FinetuningTaskService] 裂变完成:');
        console.log('  总裂变数:', totalFissionCount);
        console.log('  失败数:', errorCount);

        return {
            success: true,
            fissionCount: totalFissionCount,
            results: fissionResults,
            errorCount
        };
    }

    /**
     * 合并裂变配置
     * 优先级：传入配置 > 任务配置 > 数据配置 > 默认配置
     * @private
     */
    _mergeFissionConfig(inputConfig, taskConfig, dataConfig) {
        // 优先使用传入的配置
        if (inputConfig) {
            return inputConfig;
        }

        // 尝试从任务配置中获取
        if (taskConfig) {
            try {
                const parsed = typeof taskConfig === 'string' ? JSON.parse(taskConfig) : taskConfig;
                if (parsed.finetuning) {
                    return parsed.finetuning;
                }
            } catch (e) {
                console.warn('[FinetuningTaskService] 解析任务裂变配置失败:', e.message);
            }
        }

        // 尝试从数据配置中获取
        if (dataConfig) {
            try {
                const parsed = typeof dataConfig === 'string' ? JSON.parse(dataConfig) : dataConfig;
                if (parsed.finetuning) {
                    return parsed.finetuning;
                }
            } catch (e) {
                console.warn('[FinetuningTaskService] 解析数据裂变配置失败:', e.message);
            }
        }

        // 默认配置
        return {
            count: 6,
            requirement: '同一理念，不同场景。从故事抽象出理念，应用到职场、社交、家庭、情感、自我、亲子等不同场景。'
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
