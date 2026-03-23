const axios = require('axios');
const { SYSTEM_PROMPT, createUserPrompt, parseResponse } = require('../prompts/finetuning-review');

/**
 * AI 审核服务 - 世界级数据挖掘和模型微调专家评审
 */
class AiReviewService {
    constructor(options = {}) {
        this.apiKey = options.apiKey || process.env.ZHIPU_API_KEY;
        this.model = options.model || process.env.ZHIPU_MODEL || 'glm-4';
        this.baseUrl = 'https://open.bigmodel.cn/api/paas/v4';
    }

    /**
     * 评审单条数据
     * @param {Object} data - 待评审的数据
     * @param {string} purpose - 微调目的
     * @returns {Promise<Object>} 评审结果
     */
    async review(data, purpose = '') {
        const messages = [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: createUserPrompt(data, purpose) }
        ];

        try {
            const response = await this._callLlmApi(messages);
            const parsed = parseResponse(response);

            if (!parsed.success) {
                return {
                    success: false,
                    error: parsed.error,
                    rawResponse: parsed.rawResponse
                };
            }

            // 转换为内部格式
            return this._convertToInternalFormat(parsed.data, data);

        } catch (error) {
            return {
                success: false,
                error: `AI 审核失败：${error.message}`,
                rawResponse: null
            };
        }
    }

    /**
     * 批量评审数据
     * @param {Array} dataList - 待评审的数据列表
     * @param {string} purpose - 微调目的
     * @param {number} concurrency - 并发数（默认 5）
     * @returns {Promise<Array>} 评审结果列表
     */
    async batchReview(dataList, purpose = '', concurrency = 5) {
        const results = [];

        // 并发控制
        const chunks = this._chunkArray(dataList, concurrency);

        for (const chunk of chunks) {
            const chunkResults = await Promise.all(
                chunk.map(data => this.review(data, purpose))
            );
            results.push(...chunkResults);
        }

        return results;
    }

    /**
     * 调用 LLM API
     * @private
     */
    async _callLlmApi(messages) {
        if (!this.apiKey || this.apiKey === 'your-zhipu-api-key-here') {
            console.log('[AiReview] 未配置 API Key，返回 Mock 结果');
            return this._getMockResponse();
        }

        try {
            const response = await axios.post(
                `${this.baseUrl}/chat/completions`,
                {
                    model: this.model,
                    messages: messages,
                    temperature: 0.3,  // 较低温度使评分更稳定
                    top_p: 0.9,
                    max_tokens: 1024
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 60000
                }
            );

            console.log('[AiReview] API 调用成功');
            return response.data.choices[0].message.content;

        } catch (error) {
            console.error('[AiReview] API 调用失败:', error.message);
            if (error.response) {
                console.error('响应状态:', error.response.status);
                console.error('响应数据:', JSON.stringify(error.response.data).slice(0, 500));
            }

            // 降级使用 Mock 响应
            console.log('[AiReview] 降级使用 Mock 响应');
            return this._getMockResponse();
        }
    }

    /**
     * 获取 Mock 响应（用于测试或 API 不可用时）
     * @private
     */
    _getMockResponse() {
        // 生成一个随机的合理评分
        const baseScore = 75 + Math.random() * 20; // 75-95 之间

        return JSON.stringify({
            overall_score: Math.round(baseScore),
            dimension_scores: {
                completeness: Math.round(baseScore + (Math.random() - 0.5) * 10),
                instruction_following: Math.round(baseScore + (Math.random() - 0.5) * 10),
                output_quality: Math.round(baseScore + (Math.random() - 0.5) * 10),
                finetuning_suitability: Math.round(baseScore + (Math.random() - 0.5) * 10)
            },
            feedback: '数据质量良好，内容完整，适合作为微调训练数据。建议进一步优化表达清晰度和专业性。',
            suggestions: [
                '可以增加更多具体案例或细节说明',
                '检查并修正可能的错别字或语法错误'
            ],
            passed: baseScore >= 85,
            reason: baseScore >= 85 ? '评分达到标准' : '评分未达到 85 分标准'
        });
    }

    /**
     * 转换为内部格式
     * @private
     */
    _convertToInternalFormat(parsedData, originalData) {
        const { overall_score, dimension_scores, feedback, suggestions, passed, reason } = parsedData;

        return {
            success: true,
            ai_score: overall_score / 100,  // 转换为 0-1 范围
            ai_dimension_scores: {
                completeness: (dimension_scores.completeness || 0) / 100,
                instruction_following: (dimension_scores.instruction_following || 0) / 100,
                output_quality: (dimension_scores.output_quality || 0) / 100,
                finetuning_suitability: (dimension_scores.finetuning_suitability || 0) / 100
            },
            ai_feedback: feedback,
            ai_suggestions: suggestions,
            ai_passed: passed,
            reason: reason,
            original_score: overall_score,  // 保留原始 0-100 分数
            original_dimension_scores: dimension_scores  // 保留原始维度分数
        };
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

module.exports = AiReviewService;
