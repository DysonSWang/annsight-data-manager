const axios = require('axios');
const { SYSTEM_PROMPT, createUserPrompt, parseResponse } = require('../prompts/finetuning-optimize');

/**
 * AI 优化服务 - 根据审核意见优化微调数据
 */
class AiOptimizeService {
    constructor(options = {}) {
        this.apiKey = options.apiKey || process.env.ZHIPU_API_KEY;
        this.model = options.model || process.env.ZHIPU_MODEL || 'glm-4';
        this.baseUrl = 'https://open.bigmodel.cn/api/paas/v4';
    }

    /**
     * 优化单条数据
     * @param {Object} originalData - 原始数据
     * @param {string} aiFeedback - AI 审核反馈
     * @param {Array} suggestions - AI 审核建议列表
     * @returns {Promise<Object>} 优化结果
     */
    async optimize(originalData, aiFeedback = '', suggestions = []) {
        const messages = [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: createUserPrompt(originalData, aiFeedback, suggestions) }
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
            return this._convertToInternalFormat(parsed.data, originalData);

        } catch (error) {
            return {
                success: false,
                error: `AI 优化失败：${error.message}`,
                rawResponse: null
            };
        }
    }

    /**
     * 批量优化数据
     * @param {Array} dataList - 待优化的数据列表（每项包含 originalData, aiFeedback, suggestions）
     * @param {number} concurrency - 并发数（默认 3）
     * @returns {Promise<Array>} 优化结果列表
     */
    async batchOptimize(dataList, concurrency = 3) {
        const results = [];

        // 并发控制
        const chunks = this._chunkArray(dataList, concurrency);

        for (const chunk of chunks) {
            const chunkResults = await Promise.all(
                chunk.map(item => this.optimize(item.originalData, item.aiFeedback, item.suggestions))
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
            console.log('[AiOptimize] 未配置 API Key，返回 Mock 结果');
            return this._getMockResponse();
        }

        try {
            const response = await axios.post(
                `${this.baseUrl}/chat/completions`,
                {
                    model: this.model,
                    messages: messages,
                    temperature: 0.7,  // 中等温度保持创造性
                    top_p: 0.9,
                    max_tokens: 2048
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 90000
                }
            );

            console.log('[AiOptimize] API 调用成功');
            return response.data.choices[0].message.content;

        } catch (error) {
            console.error('[AiOptimize] API 调用失败:', error.message);
            if (error.response) {
                console.error('响应状态:', error.response.status);
                console.error('响应数据:', JSON.stringify(error.response.data).slice(0, 500));
            }

            // 降级使用 Mock 响应
            console.log('[AiOptimize] 降级使用 Mock 响应');
            return this._getMockResponse();
        }
    }

    /**
     * 获取 Mock 响应（用于测试或 API 不可用时）
     * @private
     */
    _getMockResponse() {
        return JSON.stringify({
            title: '优化后的标题（Mock）',
            content: '这是优化后的内容。根据审核意见，我对以下内容进行了改进：\n\n1. 增强了表达的准确性和专业性\n2. 优化了结构和逻辑\n3. 增加了必要的细节说明\n\n（注：由于 LLM API 不可用，返回 Mock 结果）',
            conversation: null,
            optimization_note: '根据审核建议进行了优化：提升了内容完整性、改进了指令遵循度、增强了输出质量。具体包括：修正了可能的表述不清、增加了相关细节、优化了整体结构。'
        });
    }

    /**
     * 转换为内部格式
     * @private
     */
    _convertToInternalFormat(parsedData, originalData) {
        const { title, content, conversation, optimization_note } = parsedData;

        return {
            success: true,
            original: {
                title: originalData.title,
                content: originalData.content,
                conversation: originalData.conversation
            },
            optimized: {
                title: title || originalData.title,
                content: content || originalData.content,
                conversation: conversation || originalData.conversation
            },
            optimization_note: optimization_note,
            hasChanged: (title !== originalData.title) ||
                        (content !== originalData.content) ||
                        JSON.stringify(conversation) !== JSON.stringify(originalData.conversation)
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

module.exports = AiOptimizeService;
