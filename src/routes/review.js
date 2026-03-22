const express = require('express');
const ProcessedDataRepository = require('../repository/ProcessedDataRepository');
const axios = require('axios');

const router = express.Router();

/**
 * 审核平台 API 路由
 */

/**
 * 优化数据（LLM 提供反馈）
 * POST /api/review/processed/:id/optimize
 */
async function optimizeData(req, res) {
    try {
        const { id } = req.params;
        const { requirements } = req.body;

        if (!id || !requirements) {
            return res.status(400).json({ error: '缺少必要参数：id, requirements' });
        }

        const repo = new ProcessedDataRepository(req.app.locals.pool);
        const data = await repo.findById(id);

        if (!data) {
            return res.status(404).json({ error: '数据不存在' });
        }

        // 使用 Dify API 进行优化（如果没有配置 Dify，使用 Mock 响应）
        const difyApiKey = process.env.DIFY_API_KEY || 'test-key';
        const difyBaseUrl = process.env.DIFY_API_BASE_URL || 'http://localhost:5001';

        const userPrompt = `请优化以下数据：

【原始数据】
- 类型：${data.type}
- 分类：${data.category}
- 标题：${data.title}
- 内容：${data.content?.slice(0, 500)}
${data.conversation ? `- 对话：${JSON.stringify(data.conversation)}` : ''}

【优化要求】
${requirements}

请直接返回优化后的 JSON 数据，格式如下：
{
  "type": "优化后的类型",
  "category": "优化后的分类",
  "title": "优化后的标题",
  "content": "优化后的内容",
  "conversation": null,
  "optimizationNote": "优化说明"
}`;

        let optimizedData;

        try {
            // 尝试调用 Dify API
            const difyResponse = await axios.post(
                `${difyBaseUrl}/v1/chat-messages`,
                {
                    inputs: {},
                    query: userPrompt,
                    response_mode: 'blocking',
                    user: 'admin'
                },
                {
                    headers: {
                        'Authorization': `Bearer ${difyApiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );

            const llmResponse = difyResponse.data.answer;
            const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
            optimizedData = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(llmResponse);
        } catch (difyError) {
            console.log('Dify API 调用失败，使用 Mock 响应:', difyError.message);

            // Mock 响应（用于测试环境）
            optimizedData = {
                type: data.type,
                category: data.category,
                title: data.title + '（优化版）',
                content: data.content + '\n\n【优化内容】根据要求：' + requirements,
                conversation: null,
                optimizationNote: '由于 LLM 服务不可用，返回 Mock 优化结果。实际使用时请配置有效的 LLM API。'
            };
        }

        res.json({
            success: true,
            original: {
                type: data.type,
                category: data.category,
                title: data.title,
                content: data.content,
                conversation: data.conversation
            },
            optimized: optimizedData,
            optimizationNote: optimizedData.optimizationNote || '优化完成'
        });

    } catch (error) {
        console.error('Error optimizing data:', error);
        res.status(500).json({ error: '优化失败：' + error.message });
    }
}

/**
 * 应用优化到数据库
 * POST /api/review/processed/:id/apply-optimization
 */
async function applyOptimization(req, res) {
    try {
        const { id } = req.params;
        const { optimizedData } = req.body;

        if (!id || !optimizedData) {
            return res.status(400).json({ error: '缺少必要参数：id, optimizedData' });
        }

        const repo = new ProcessedDataRepository(req.app.locals.pool);
        const reviewerId = 'admin';

        // 更新数据
        await repo.update(id, {
            type: optimizedData.type,
            category: optimizedData.category,
            title: optimizedData.title,
            content: optimizedData.content,
            conversation: optimizedData.conversation || null
        });

        // 记录日志
        await req.app.locals.pool.query(`
            INSERT INTO review_logs (data_id, reviewer_id, action, old_value, new_value, result)
            VALUES ($1, $2, 'optimize', $3, $4, 'applied')
        `, [
            id,
            reviewerId,
            JSON.stringify({ action: 'optimize' }),
            JSON.stringify(optimizedData)
        ]);

        res.json({ success: true });

    } catch (error) {
        console.error('Error applying optimization:', error);
        res.status(500).json({ error: '应用优化失败：' + error.message });
    }
}

/**
 * 获取低置信度待审核数据
 * GET /api/review/processed/low-confidence
 */
async function getLowConfidence(req, res) {
    try {
        const { page = 1, pageSize = 20 } = req.query;
        const threshold = 0.8; // 默认阈值

        const repo = new ProcessedDataRepository(req.app.locals.pool);
        const offset = (parseInt(page) - 1) * parseInt(pageSize);

        const data = await repo.findLowConfidence(threshold, parseInt(pageSize), offset);

        res.json({ data });
    } catch (error) {
        console.error('Error fetching low confidence data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * AI 自动批准高置信度数据
 * POST /api/review/processed/auto-approve
 */
async function autoApprove(req, res) {
    try {
        const { minConfidence = 0.8 } = req.body;
        const coolingHours = 24; // 默认 24 小时

        const repo = new ProcessedDataRepository(req.app.locals.pool);

        // 获取所有高于阈值的数据
        const query = `
            SELECT id FROM processed_data
            WHERE review_status = 'pending'
              AND ai_confidence_score >= $1
        `;
        const result = await req.app.locals.pool.query(query, [minConfidence]);

        let updated = 0;
        for (const row of result.rows) {
            await repo.autoApprove(row.id, coolingHours);
            updated++;
        }

        res.json({ success: true, updated });
    } catch (error) {
        console.error('Error auto-approving data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * 人工审核决定（批准/拒绝）
 * POST /api/review/processed/decide
 */
async function decide(req, res) {
    try {
        const { id, action, rejectReason, corrections } = req.body;

        if (!id || !action) {
            return res.status(400).json({ error: 'Missing required fields: id, action' });
        }

        const repo = new ProcessedDataRepository(req.app.locals.pool);
        const reviewerId = 'admin'; // 开发模式使用 admin 用户（迁移脚本创建的默认用户）

        if (action === 'approve') {
            await repo.approve(id, reviewerId);
            if (corrections) {
                await repo.update(id, corrections);
            }
        } else if (action === 'reject') {
            await repo.reject(id, reviewerId, rejectReason || '无原因');
        } else {
            return res.status(400).json({ error: 'Invalid action. Must be "approve" or "reject"' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error making decision:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * 分层抽检查询
 * GET /api/review/processed/spot-check/stratified
 */
async function getSpotCheckSamples(req, res) {
    try {
        const { minPerType = 3, minPerCategory = 2 } = req.query;

        const repo = new ProcessedDataRepository(req.app.locals.pool);
        const samples = await repo.getSpotCheckSamples({
            minPerType: parseInt(minPerType)
        });

        res.json({ data: samples });
    } catch (error) {
        console.error('Error fetching spot check samples:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * 抽检修正
 * POST /api/review/processed/spot-check/correct
 */
async function correctSpotCheck(req, res) {
    try {
        const { id, corrections } = req.body;

        if (!id || !corrections) {
            return res.status(400).json({ error: 'Missing required fields: id, corrections' });
        }

        const repo = new ProcessedDataRepository(req.app.locals.pool);
        await repo.update(id, corrections);

        // 记录日志（这里简化处理，实际应该用 ReviewLogRepository）
        res.json({ success: true });
    } catch (error) {
        console.error('Error correcting spot check:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * AI 准确率统计
 * GET /api/review/stats/ai-accuracy
 */
async function getAiAccuracy(req, res) {
    try {
        const repo = new ProcessedDataRepository(req.app.locals.pool);
        const stats = await repo.getAiAccuracyStats();

        res.json({
            total_spot_checks: Number(stats?.total_spot_checks) || 0,
            corrections: Number(stats?.corrections) || 0,
            accuracy: stats?.accuracy ? Number(stats.accuracy) : 1.0
        });
    } catch (error) {
        console.error('Error fetching AI accuracy stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * 阈值动态调整建议
 * GET /api/review/stats/threshold-recommendation
 */
async function getThresholdRecommendation(req, res) {
    try {
        const currentThreshold = parseFloat(req.query.currentThreshold) || 0.8;

        const repo = new ProcessedDataRepository(req.app.locals.pool);
        const recommendation = await repo.getThresholdRecommendation(currentThreshold);

        res.json(recommendation);
    } catch (error) {
        console.error('Error fetching threshold recommendation:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * 批量修正
 * POST /api/review/processed/batch-correct
 */
async function batchCorrect(req, res) {
    try {
        const { conditions, corrections } = req.body;

        if (!conditions || !corrections) {
            return res.status(400).json({ error: 'Missing required fields: conditions, corrections' });
        }

        const repo = new ProcessedDataRepository(req.app.locals.pool);
        const updated = await repo.batchCorrect(conditions, corrections);

        res.json({ success: true, updated });
    } catch (error) {
        console.error('Error batch correcting:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * 获取可以同步到 Dify 的数据
 * GET /api/review/processed/ready-for-rag
 */
async function getReadyForRag(req, res) {
    try {
        const repo = new ProcessedDataRepository(req.app.locals.pool);
        const data = await repo.findReadyForRag();

        res.json({ data, count: data.length });
    } catch (error) {
        console.error('Error fetching ready for rag data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * 获取数据分布统计
 * GET /api/review/stats/distribution?type=type|category|source&purposes=rag,finetuning
 */
async function getDistribution(req, res) {
    try {
        const { type: field = 'type', purposes } = req.query;
        const repo = new ProcessedDataRepository(req.app.locals.pool);
        const distribution = await repo.getDistribution(field, purposes ? purposes.split(',') : null);

        res.json(distribution);
    } catch (error) {
        console.error('Error fetching distribution:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * 获取详细统计
 * GET /api/review/stats/detailed
 */
async function getDetailedStats(req, res) {
    try {
        const repo = new ProcessedDataRepository(req.app.locals.pool);
        const stats = await repo.getDetailedStats();

        res.json(stats);
    } catch (error) {
        console.error('Error fetching detailed stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

// 注册路由
router.get('/processed/low-confidence', getLowConfidence);
router.post('/processed/auto-approve', autoApprove);
router.post('/processed/decide', decide);
router.get('/processed/spot-check/stratified', getSpotCheckSamples);
router.post('/processed/spot-check/correct', correctSpotCheck);
router.get('/stats/ai-accuracy', getAiAccuracy);
router.get('/stats/threshold-recommendation', getThresholdRecommendation);
router.post('/processed/batch-correct', batchCorrect);
router.get('/processed/ready-for-rag', getReadyForRag);
router.get('/stats/distribution', getDistribution);
router.get('/stats/detailed', getDetailedStats);
// 优化功能路由
router.post('/processed/:id/optimize', optimizeData);
router.post('/processed/:id/apply-optimization', applyOptimization);

module.exports = router;
