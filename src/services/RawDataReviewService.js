const { v4: uuidv4 } = require('uuid');
const RawDataIndexRepository = require('../repository/RawDataIndexRepository');
const AiReviewService = require('./AiReviewService');
const AiOptimizeService = require('./AiOptimizeService');
const notificationService = require('./notificationService');
const { SYSTEM_PROMPT: REVIEW_SYSTEM_PROMPT, createUserPrompt: createReviewPrompt, parseResponse: parseReviewResponse } = require('../prompts/raw-data-review');
const { SYSTEM_PROMPT: OPTIMIZE_SYSTEM_PROMPT, createUserPrompt: createOptimizePrompt, parseResponse: parseOptimizeResponse } = require('../prompts/raw-data-optimize');

/**
 * 源数据审核服务
 * 负责 raw_data_index 表的 AI 审核 + 优化 + 人工审核流程
 */
class RawDataReviewService {
    constructor(pool, options = {}) {
        this.pool = pool;
        this.repo = new RawDataIndexRepository(pool);
        this.aiReviewService = new AiReviewService(options);
        this.aiOptimizeService = new AiOptimizeService(options);
    }

    /**
     * 启动 AI 审核流程（支持多轮审核 + 优化循环）
     * @param {string} batchId - 批次 ID
     * @param {Object} config - 审核配置
     * @param {number} config.maxRounds - 最大审核轮次（默认 2）
     * @param {number} config.passThreshold - 通过阈值（默认 0.75）
     * @param {boolean} config.autoOptimize - 是否自动优化（默认 true）
     * @param {string} config.reviewPrompt - 审核提示词（可选）
     * @param {boolean} config.notifyOnComplete - 审核完成后是否发送通知（默认 false）
     * @param {string} config.taskName - 任务名称（用于通知）
     * @param {string} config.baseUrl - 平台基础 URL（用于通知链接）
     * @returns {Promise<Object>} 审核结果
     */
    async startAiReview(batchId, config = {}) {
        const {
            maxRounds = 2,
            passThreshold = 0.75,
            autoOptimize = true,
            reviewPrompt = '',
            notifyOnComplete = false,
            taskName = '',
            baseUrl = process.env.BASE_URL || 'http://localhost:3000'
        } = config;

        console.log(`[RawDataReviewService] 开始 AI 审核，配置：maxRounds=${maxRounds}, passThreshold=${passThreshold}, autoOptimize=${autoOptimize}`);

        // 获取批次下所有需要审核的数据
        const dataQuery = `
            SELECT id, oss_url, content_type, source, batch_id,
                   metadata, transcript_text,
                   ai_review_enabled, ai_review_prompt, ai_pass_threshold::numeric, ai_max_rounds
            FROM raw_data_index
            WHERE batch_id = $1
              AND status != 'duplicate'
              AND (ai_review_status IS NULL OR ai_review_status = 'pending' OR ai_review_status = 'failed')
            ORDER BY created_at DESC
        `;
        const dataResult = await this.pool.query(dataQuery, [batchId]);
        const dataList = dataResult.rows;

        if (dataList.length === 0) {
            return {
                success: true,
                message: '没有需要审核的数据',
                summary: { total: 0, approved: 0, failed: 0, optimized: 0 },
                rounds: []
            };
        }

        console.log(`[RawDataReviewService] 开始 AI 审核，共 ${dataList.length} 条数据`);

        // 执行多轮审核 + 优化循环
        const roundStats = [];
        let currentRound = 1;
        let remainingData = dataList;

        while (currentRound <= maxRounds && remainingData.length > 0) {
            console.log(`\n[RawDataReviewService] 第 ${currentRound} 轮审核开始，数据量：${remainingData.length}`);

            // 并发执行 AI 审核
            const concurrency = 10;
            const results = await this._batchAiReviewWithThreshold(
                batchId,
                remainingData,
                concurrency,
                passThreshold,
                reviewPrompt
            );

            // 统计本轮结果
            const passedCount = results.filter(r => r.success && r.ai_passed).length;
            const failedCount = results.filter(r => r.success && !r.ai_passed).length;
            const errorCount = results.filter(r => !r.success).length;
            const optimizedCount = results.filter(r => r.optimized).length;

            roundStats.push({
                round: currentRound,
                total: results.length,
                passed: passedCount,
                failed: failedCount,
                errors: errorCount,
                optimized: optimizedCount
            });

            console.log(`[RawDataReviewService] 第 ${currentRound} 轮完成：通过 ${passedCount}, 失败 ${failedCount}, 优化 ${optimizedCount}`);

            // 检查是否需要进入优化流程
            const needOptimize = results.filter(r => r.success && !r.ai_passed);
            if (needOptimize.length > 0 && autoOptimize && currentRound < maxRounds) {
                console.log(`[RawDataReviewService] 有 ${needOptimize.length} 条数据需要优化并重新审核`);

                // 执行优化
                await this._batchOptimizeAndReReview(batchId, needOptimize, currentRound);

                // 优化后数据会在下一轮重新审核，remainingData 会在下面更新
            }

            currentRound++;

            // 更新 remainingData 为未完成的数据
            const unfinishedDataIds = results.filter(r => !r.ai_passed && !r.optimized).map(r => r.data_id);
            remainingData = dataList.filter(d => unfinishedDataIds.includes(d.id));
        }

        // 汇总所有轮次的结果
        const totalPassed = roundStats.reduce((sum, r) => sum + r.passed, 0);
        const totalFailed = roundStats.reduce((sum, r) => sum + r.failed, 0);
        const totalOptimized = roundStats.reduce((sum, r) => sum + r.optimized, 0);

        // 获取最终审核通过的数据量
        const finalApprovedQuery = `
            SELECT COUNT(*) as count
            FROM raw_data_index
            WHERE batch_id = $1
              AND ai_review_status = 'approved'
        `;
        const finalApprovedResult = await this.pool.query(finalApprovedQuery, [batchId]);
        const finalApprovedCount = parseInt(finalApprovedResult.rows[0].count);

        console.log(`\n[RawDataReviewService] AI 审核全部完成：最终通过 ${finalApprovedCount}/${dataList.length}`);

        // 发送审核完成通知
        if (notifyOnComplete) {
            try {
                await notificationService.sendReviewComplete(
                    {
                        taskName: taskName || `批次 ${batchId}`,
                        batchId,
                        baseUrl
                    },
                    {
                        total: dataList.length,
                        approved: finalApprovedCount,
                        failed: dataList.length - finalApprovedCount,
                        optimized: totalOptimized
                    }
                );
                console.log('[RawDataReviewService] 审核完成通知已发送');
            } catch (error) {
                console.error('[RawDataReviewService] 发送通知失败:', error.message);
            }
        }

        return {
            success: true,
            message: 'AI 审核完成',
            summary: {
                total: dataList.length,
                approved: finalApprovedCount,
                failed: dataList.length - finalApprovedCount,
                optimized: totalOptimized
            },
            rounds: roundStats,
            totalPassed,
            totalFailed,
            totalOptimized
        };
    }

    /**
     * 批量 AI 审核（支持阈值判断）
     * @private
     */
    async _batchAiReviewWithThreshold(batchId, dataList, concurrency, passThreshold, customPrompt) {
        const results = [];
        const chunks = this._chunkArray(dataList, concurrency);

        for (const chunk of chunks) {
            const chunkPromises = chunk.map(async (data) => {
                console.log(`[AiReview] 审核数据 ${data.id}`);

                try {
                    // 构建审核内容
                    const reviewContent = this._buildReviewContent(data);

                    // 调用 AI 审核
                    const reviewResult = await this._callAiReview(reviewContent, customPrompt || data.ai_review_prompt);

                    if (!reviewResult.success) {
                        // 更新状态为 failed
                        await this._updateAiReviewStatus(data.id, 'failed', {
                            error: reviewResult.error
                        });
                        return { success: false, error: reviewResult.error, data_id: data.id };
                    }

                    // 使用传入的阈值判断是否通过
                    const aiPassed = reviewResult.ai_score >= passThreshold;

                    // 更新数据库状态
                    await this._updateAiReviewStatus(data.id, aiPassed ? 'approved' : 'failed', {
                        score: reviewResult.ai_score,
                        feedback: reviewResult.ai_feedback,
                        suggestions: reviewResult.ai_suggestions,
                        dimensionScores: reviewResult.ai_dimension_scores
                    });

                    // 记录审核轮次
                    await this._createReviewRound({
                        batch_id: batchId,
                        data_id: data.id,
                        round_number: 1,
                        round_type: 'ai_review',
                        ai_score: reviewResult.ai_score,
                        ai_dimension_scores: reviewResult.ai_dimension_scores,
                        ai_feedback: reviewResult.ai_feedback,
                        ai_suggestions: reviewResult.ai_suggestions,
                        ai_passed: aiPassed
                    });

                    return {
                        success: true,
                        ai_passed: aiPassed,
                        ai_score: reviewResult.ai_score,
                        data_id: data.id
                    };

                } catch (error) {
                    console.error(`[AiReview] 审核失败 ${data.id}:`, error.message);
                    await this._updateAiReviewStatus(data.id, 'failed', {
                        error: error.message
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
     * 调用 AI 审核
     * @private
     */
    async _callAiReview(content, customPrompt) {
        const axios = require('axios');

        const messages = [
            { role: 'system', content: REVIEW_SYSTEM_PROMPT },
            { role: 'user', content: createReviewPrompt({ content }, customPrompt) }
        ];

        const apiKey = process.env.ZHIPU_API_KEY;
        const model = process.env.ZHIPU_MODEL || 'glm-4';
        const baseUrl = 'https://open.bigmodel.cn/api/paas/v4';

        if (!apiKey || apiKey === 'your-zhipu-api-key-here') {
            console.log('[AiReview] 未配置 API Key，返回 Mock 结果');
            return this._getMockReviewResponse(content);
        }

        try {
            const response = await axios.post(
                `${baseUrl}/chat/completions`,
                {
                    model: model,
                    messages: messages,
                    temperature: 0.3,
                    top_p: 0.9,
                    max_tokens: 1024
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 60000
                }
            );

            console.log('[AiReview] API 调用成功');
            const parsed = parseReviewResponse(response.data.choices[0].message.content);

            if (!parsed.success) {
                return parsed;
            }

            return this._convertToInternalFormat(parsed.data);

        } catch (error) {
            console.error('[AiReview] API 调用失败:', error.message);
            return {
                success: false,
                error: `AI 审核失败：${error.message}`,
                rawResponse: null
            };
        }
    }

    /**
     * 获取 Mock 审核响应
     * @private
     */
    _getMockReviewResponse(content) {
        const baseScore = 70 + Math.random() * 25; // 70-95 之间

        return {
            success: true,
            ai_score: baseScore / 100,
            ai_dimension_scores: {
                completeness: (70 + Math.random() * 20) / 100,
                fluency: (70 + Math.random() * 20) / 100,
                accuracy: (70 + Math.random() * 20) / 100,
                value: (70 + Math.random() * 20) / 100,
                suitability: (70 + Math.random() * 20) / 100
            },
            ai_feedback: '数据质量良好，内容完整，适合用于后续处理。建议进一步优化表达清晰度和专业性。',
            ai_suggestions: [
                '可以增加更多具体案例或细节说明',
                '检查并修正可能的错别字或语法错误'
            ],
            ai_passed: baseScore >= 75,
            original_score: baseScore
        };
    }

    /**
     * 转换为内部格式
     * @private
     */
    _convertToInternalFormat(parsedData) {
        const { overall_score, dimension_scores, feedback, suggestions, passed } = parsedData;

        return {
            success: true,
            ai_score: overall_score / 100,
            ai_dimension_scores: {
                completeness: (dimension_scores.completeness || 0) / 100,
                fluency: (dimension_scores.fluency || 0) / 100,
                accuracy: (dimension_scores.accuracy || 0) / 100,
                value: (dimension_scores.value || 0) / 100,
                suitability: (dimension_scores.suitability || 0) / 100
            },
            ai_feedback: feedback,
            ai_suggestions: suggestions,
            ai_passed: passed,
            original_score: overall_score
        };
    }

    /**
     * 批量优化并重新审核
     * @private
     */
    async _batchOptimizeAndReReview(batchId, failedDataList, currentRound) {
        const results = [];
        const concurrency = 5;
        const chunks = this._chunkArray(failedDataList, concurrency);

        for (const chunk of chunks) {
            const chunkPromises = chunk.map(async (data) => {
                try {
                    // 调用 AI 优化
                    const reviewContent = this._buildReviewContent(data);
                    const optimizeResult = await this._callAiOptimize(
                        { content: reviewContent, metadata: data.metadata },
                        data.ai_review_feedback || ''
                    );

                    if (!optimizeResult.success) {
                        return { success: false, error: optimizeResult.error, data_id: data.id };
                    }

                    // 更新数据库 - 标记为已优化
                    await this._updateOptimizationResult(data.id, optimizeResult);

                    // 记录优化轮次
                    await this._createReviewRound({
                        batch_id: batchId,
                        data_id: data.id,
                        round_number: currentRound,
                        round_type: 'ai_optimize',
                        optimized: true,
                        optimization_result: optimizeResult.optimization_result
                    });

                    // 记录反馈日志
                    await this._createFeedbackLog({
                        batch_id: batchId,
                        data_id: data.id,
                        suggestion_type: 'ai_feedback',
                        optimization_result: optimizeResult.optimization_result
                    });

                    return {
                        success: true,
                        optimized: true,
                        data_id: data.id,
                        optimizationResult: optimizeResult
                    };

                } catch (error) {
                    console.error(`[AiOptimize] 优化失败 ${data.id}:`, error.message);
                    return { success: false, error: error.message, data_id: data.id };
                }
            });

            const chunkResults = await Promise.all(chunkPromises);
            results.push(...chunkResults);
        }

        return results;
    }

    /**
     * 调用 AI 优化
     * @private
     */
    async _callAiOptimize(originalData, userPrompt) {
        const axios = require('axios');

        const messages = [
            { role: 'system', content: OPTIMIZE_SYSTEM_PROMPT },
            { role: 'user', content: createOptimizePrompt(originalData, userPrompt) }
        ];

        const apiKey = process.env.ZHIPU_API_KEY;
        const model = process.env.ZHIPU_MODEL || 'glm-4';
        const baseUrl = 'https://open.bigmodel.cn/api/paas/v4';

        if (!apiKey || apiKey === 'your-zhipu-api-key-here') {
            console.log('[AiOptimize] 未配置 API Key，返回 Mock 结果');
            return this._getMockOptimizeResponse(originalData);
        }

        try {
            const response = await axios.post(
                `${baseUrl}/chat/completions`,
                {
                    model: model,
                    messages: messages,
                    temperature: 0.5,
                    top_p: 0.9,
                    max_tokens: 2048
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 90000
                }
            );

            console.log('[AiOptimize] API 调用成功');
            const parsed = parseOptimizeResponse(response.data.choices[0].message.content);

            if (!parsed.success) {
                return parsed;
            }

            return this._convertOptimizeToInternalFormat(parsed.data, originalData);

        } catch (error) {
            console.error('[AiOptimize] API 调用失败:', error.message);
            return {
                success: false,
                error: `AI 优化失败：${error.message}`,
                rawResponse: null
            };
        }
    }

    /**
     * 获取 Mock 优化响应
     * @private
     */
    _getMockOptimizeResponse(originalData) {
        const content = originalData.content || '';
        const optimizedContent = content + '\n\n【已优化】内容更加完整和详细，补充了相关细节和背景信息。';

        return {
            success: true,
            optimized_content: optimizedContent,
            optimization_result: {
                original_content: content,
                optimized_content: optimizedContent,
                changes: [
                    '补充了相关细节和背景信息',
                    '优化了表达方式和语言流畅度',
                    '增加了有价值的案例和说明'
                ]
            }
        };
    }

    /**
     * 转换为内部格式（优化）
     * @private
     */
    _convertOptimizeToInternalFormat(parsedData, originalData) {
        const { optimized_content, changes, explanation } = parsedData;

        return {
            success: true,
            optimized_content: optimized_content,
            optimization_result: {
                original_content: originalData.content || '',
                optimized_content: optimized_content,
                changes: changes,
                explanation: explanation || ''
            }
        };
    }

    /**
     * 构建审核内容
     * @private
     */
    _buildReviewContent(data) {
        // 优先使用 transcript_text
        if (data.transcript_text) {
            return data.transcript_text;
        }

        // 其次使用 metadata 中的 text 或 content
        if (data.metadata) {
            // 如果 text 是对象，提取其中的 content 字段
            if (typeof data.metadata.text === 'object') {
                return data.metadata.text?.content ||
                       data.metadata.text?.text ||
                       JSON.stringify(data.metadata.text);
            }
            // 如果 text 是字符串，直接使用
            if (typeof data.metadata.text === 'string') {
                return data.metadata.text;
            }
            // 使用 content 字段
            if (data.metadata.content) {
                return data.metadata.content;
            }
        }

        // 最后使用 oss_url
        return data.oss_url || '';
    }

    /**
     * 更新 AI 审核状态
     * @private
     */
    async _updateAiReviewStatus(dataId, status, details = {}) {
        const { score, feedback, suggestions, dimensionScores, error } = details;

        const query = `
            UPDATE raw_data_index
            SET ai_review_status = $2::varchar,
                ai_review_score = $3::numeric,
                ai_review_feedback = $4,
                ai_review_suggestions = $5::jsonb,
                ai_review_rounds = COALESCE(ai_review_rounds, 0) + 1,
                ai_reviewed_at = CASE WHEN $2 IN ('approved', 'failed') THEN CURRENT_TIMESTAMP ELSE ai_reviewed_at END,
                review_flow_status = CASE
                    WHEN $2 = 'approved' THEN 'ai_approved'
                    WHEN $2 = 'failed' THEN 'ai_failed'
                    ELSE review_flow_status
                END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
        `;

        await this.pool.query(query, [
            dataId,
            status,
            score ? parseFloat(score) : null,
            feedback || null,
            suggestions ? JSON.stringify(suggestions) : null
        ]);
    }

    /**
     * 更新优化结果
     * @private
     */
    async _updateOptimizationResult(dataId, optimizeResult) {
        const query = `
            UPDATE raw_data_index
            SET ai_review_rounds = COALESCE(ai_review_rounds, 0) + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
        `;
        await this.pool.query(query, [dataId]);

        // 如果有优化后的内容，更新 transcript_text
        if (optimizeResult.optimized_content) {
            const updateTranscriptQuery = `
                UPDATE raw_data_index
                SET transcript_text = $2,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $1
            `;
            await this.pool.query(updateTranscriptQuery, [dataId, optimizeResult.optimized_content]);
        }
    }

    /**
     * 创建审核轮次记录
     * @private
     */
    async _createReviewRound(roundData) {
        const query = `
            INSERT INTO raw_data_review_rounds (
                batch_id, data_id, round_number, round_type,
                ai_score, ai_dimension_scores, ai_feedback, ai_suggestions, ai_passed,
                optimized, optimization_result, status,
                manual_decision, manual_reason, manual_reviewer
            ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9::boolean, $10, $11::jsonb, $12, $13::varchar, $14, $15)
            RETURNING *
        `;

        const result = await this.pool.query(query, [
            roundData.batch_id,
            roundData.data_id,
            roundData.round_number,
            roundData.round_type,
            roundData.ai_score ? parseFloat(roundData.ai_score) : null,
            roundData.ai_dimension_scores ? JSON.stringify(roundData.ai_dimension_scores) : null,
            roundData.ai_feedback || null,
            roundData.ai_suggestions ? JSON.stringify(roundData.ai_suggestions) : null,
            roundData.ai_passed !== undefined ? roundData.ai_passed : false,
            roundData.optimized || false,
            roundData.optimization_result ? JSON.stringify(roundData.optimization_result) : null,
            roundData.status || 'completed',
            roundData.manual_decision || null,
            roundData.manual_reason || null,
            roundData.manual_reviewer || null
        ]);

        return result.rows[0];
    }

    /**
     * 创建反馈日志
     * @private
     */
    async _createFeedbackLog(logData) {
        const query = `
            INSERT INTO raw_data_review_feedback_logs (
                batch_id, data_id, suggestion_type,
                optimization_result, created_at
            ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
        `;

        await this.pool.query(query, [
            logData.batch_id,
            logData.data_id,
            logData.suggestion_type,
            logData.optimization_result ? JSON.stringify(logData.optimization_result) : null
        ]);
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

    /**
     * 提交人工审核决策
     * @param {string} dataId - 数据 ID
     * @param {Object} decision - 决策信息
     * @param {string} decision.decision - approved | rejected
     * @param {string} decision.reason - 决策原因
     * @param {string} decision.reviewer - 审核人
     * @returns {Promise<Object>} 审核结果
     */
    async submitManualReview(dataId, decision) {
        const { decision: decisionType, reason, reviewer = 'admin' } = decision;

        if (!decisionType || !['approved', 'rejected'].includes(decisionType)) {
            throw new Error('decision 必须是 approved 或 rejected');
        }

        const data = await this.repo.findById(dataId);
        if (!data) {
            throw new Error('数据不存在');
        }

        // 更新人工审核状态
        const query = `
            UPDATE raw_data_index
            SET manual_review_status = $2::varchar,
                manual_review_decision = $3::varchar,
                manual_review_reason = $4,
                manual_reviewer = $5,
                manual_reviewed_at = CURRENT_TIMESTAMP,
                review_flow_status = CASE
                    WHEN $2 = 'approved' THEN 'manually_approved'
                    WHEN $2 = 'rejected' THEN 'manually_rejected'
                    ELSE review_flow_status
                END,
                status = CASE
                    WHEN $2 = 'approved' THEN 'processed'
                    WHEN $2 = 'rejected' THEN 'rejected'
                    ELSE status
                END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
        `;

        await this.pool.query(query, [
            dataId,
            decisionType === 'approved' ? 'completed' : 'rejected',
            decisionType,
            reason || null,
            reviewer
        ]);

        // 记录审核轮次
        await this._createReviewRound({
            batch_id: data.batch_id,
            data_id: dataId,
            round_number: 1,
            round_type: 'manual_review',
            manual_decision: decisionType,
            manual_reason: reason,
            manual_reviewer: reviewer
        });

        // 如果是批准且之前 AI 审核失败，触发 ETL 处理
        if (decisionType === 'approved' && data.ai_review_status === 'failed') {
            console.log(`[RawDataReviewService] 人工批准 AI 失败数据 ${dataId}，将触发后续处理`);
            // 这里可以调用 ETL 服务进行处理
        }

        return {
            success: true,
            message: '人工审核完成',
            decision: decisionType
        };
    }

    /**
     * 人工优化（带提示词）
     * @param {string} dataId - 数据 ID
     * @param {Object} options - 选项
     * @param {string} options.prompt - 优化提示词
     * @param {boolean} options.recordFeedback - 是否记录反馈（默认 true）
     * @returns {Promise<Object>} 优化结果
     */
    async manualOptimize(dataId, options = {}) {
        const { prompt, recordFeedback = true } = options;

        if (!prompt) {
            throw new Error('优化提示词不能为空');
        }

        const data = await this.repo.findById(dataId);
        if (!data) {
            throw new Error('数据不存在');
        }

        // 构建优化内容
        const content = this._buildReviewContent(data);

        // 调用 AI 优化
        const optimizeResult = await this.aiOptimizeService.optimize(
            { content, metadata: data.metadata },
            prompt
        );

        if (!optimizeResult.success) {
            return {
                success: false,
                error: optimizeResult.error
            };
        }

        // 更新数据库
        if (optimizeResult.optimized_content) {
            const updateQuery = `
                UPDATE raw_data_index
                SET transcript_text = $2,
                    ai_review_rounds = COALESCE(ai_review_rounds, 0) + 1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $1
            `;
            await this.pool.query(updateQuery, [dataId, optimizeResult.optimized_content]);
        }

        // 记录优化轮次
        await this._createReviewRound({
            batch_id: data.batch_id,
            data_id: dataId,
            round_number: 1,
            round_type: 'manual_optimize',
            optimized: true,
            optimization_result: optimizeResult.optimization_result
        });

        // 记录反馈日志
        if (recordFeedback) {
            await this._createFeedbackLog({
                batch_id: data.batch_id,
                data_id: dataId,
                suggestion_type: 'human_optimization',
                user_feedback: prompt,
                optimization_result: optimizeResult.optimization_result
            });
        }

        return {
            success: true,
            optimizedContent: optimizeResult.optimized_content,
            changes: optimizeResult.optimization_result?.changes || [],
            feedbackRecorded: recordFeedback
        };
    }

    /**
     * 获取待人工审核的数据列表
     * @param {string} batchId - 批次 ID
     * @param {Object} options - 选项
     * @param {string} options.scope - 审核范围：all | approved | failed
     * @param {number} options.limit - 限制数量
     * @returns {Promise<Array>} 数据列表
     */
    async getManualReviewList(batchId, options = {}) {
        const { scope = 'failed', limit = 100 } = options;

        let statusCondition = '';
        if (scope === 'approved') {
            statusCondition = "AND ai_review_status = 'approved'";
        } else if (scope === 'failed') {
            statusCondition = "AND ai_review_status = 'failed'";
        }
        // scope === 'all' 时不加条件

        const query = `
            SELECT id, oss_url, content_type, source, batch_id,
                   transcript_text, metadata,
                   ai_review_status, ai_review_score, ai_review_feedback, ai_review_suggestions,
                   manual_review_status, manual_review_decision,
                   review_flow_status, created_at
            FROM raw_data_index
            WHERE batch_id = $1
              AND status != 'duplicate'
              ${statusCondition}
              AND (manual_review_status IS NULL OR manual_review_status = 'pending')
            ORDER BY created_at DESC
            LIMIT $2
        `;

        const result = await this.pool.query(query, [batchId, limit]);
        return result.rows;
    }
}

module.exports = RawDataReviewService;
