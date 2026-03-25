const ProcessedDataRepository = require('../repository/ProcessedDataRepository');

/**
 * 微调数据导出服务
 * 负责将审核通过的数据导出为阿里百炼微调数据集格式 (JSONL)
 * 支持两种格式：
 * 1. SFT 格式：包含 system + 多轮 user/assistant(含<think>思考) 对话
 * 2. 标准 messages 格式：多轮对话
 */
class FinetuningExportService {
    constructor(pool) {
        this.pool = pool;
        this.repo = new ProcessedDataRepository(pool);
        // SFT 格式配置
        this.sftConfig = {
            systemPrompt: 'You are a helpful assistant.',
            thinkingTag: true  // 是否启用<think>思考标签
        };
    }

    /**
     * 导出为 JSONL 格式
     * @param {string[]} dataIds - 数据 ID 列表，为空则导出所有已审核数据
     * @param {string} format - 导出格式：'sft' (带思考标签) | 'messages' (标准对话) | 'instruction' (指令)
     * @returns {Promise<Object>} JSONL 行数和内容
     */
    async exportToJsonl(dataIds = null, format = 'sft') {
        let data;

        if (dataIds) {
            data = await Promise.all(dataIds.map(id => this.repo.findById(id)));
        } else {
            data = await this.repo.exportForFinetuning();
        }

        const lines = [];

        for (const item of data) {
            let jsonLine;

            // 根据指定格式选择转换器
            if (format === 'sft') {
                jsonLine = this.formatAsSFT(item);
            } else if (item.conversation && Array.isArray(item.conversation) && item.conversation.length > 0) {
                jsonLine = this.formatAsMessages(item);
            } else {
                jsonLine = this.formatAsInstruction(item);
            }

            lines.push(JSON.stringify(jsonLine, this.ensureAscii));
        }

        return {
            lines,
            count: lines.length
        };
    }

    /**
     * 格式化为 messages 格式 (多轮对话)
     * @param {Object} data - 数据对象
     * @returns {Object} messages 格式
     */
    formatAsMessages(data) {
        const messages = data.conversation.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content
        }));

        // 添加系统提示（可选）
        const systemPrompt = this.generateSystemPrompt(data);
        if (systemPrompt) {
            messages.unshift({
                role: 'system',
                content: systemPrompt
            });
        }

        return {
            messages,
            metadata: {
                type: data.type,
                category: data.category,
                source: data.source
            }
        };
    }

    /**
     * 格式化为 SFT 格式（带<think>思考标签的多轮对话）
     * 参考格式：
     * {"messages":[{"role": "system", "content": "You are a helpful assistant."},
     *              {"role":"user","content":"你好"},
     *              {"role":"assistant","content":"<think>\n用户思考内容\n</think>\n\n实际回复内容"}]}
     * @param {Object} data - 数据对象
     * @returns {Object} SFT 格式
     */
    formatAsSFT(data) {
        const messages = [];

        // 1. 添加系统提示
        messages.push({
            role: 'system',
            content: this.sftConfig.systemPrompt
        });

        // 2. 处理对话数据
        if (data.conversation && Array.isArray(data.conversation) && data.conversation.length > 0) {
            // 有对话数据：转换为多轮对话格式
            for (const msg of data.conversation) {
                if (msg.role === 'user') {
                    messages.push({
                        role: 'user',
                        content: msg.content
                    });
                } else if (msg.role === 'assistant') {
                    // 检查回复是否已包含<think>标签
                    const hasThinkingTag = msg.content.includes('<think>') && msg.content.includes('</think>');

                    if (hasThinkingTag) {
                        // 已有思考标签，直接使用
                        messages.push({
                            role: 'assistant',
                            content: msg.content
                        });
                    } else {
                        // 没有思考标签，生成默认的
                        const thinkingContent = this.generateThinkingContent(data, msg.content);
                        const assistantContent = `<think>\n${thinkingContent}\n</think>\n\n${msg.content}`;
                        messages.push({
                            role: 'assistant',
                            content: assistantContent
                        });
                    }
                }
            }
        } else {
            // 没有对话数据：创建单轮问答格式
            // user: 标题作为问题
            // assistant: 内容作为回答（带思考）
            const userContent = data.title || '';
            const thinkingContent = this.generateThinkingContent(data, data.content);
            const assistantContent = `<think>\n${thinkingContent}\n</think>\n\n${data.content}`;

            messages.push(
                { role: 'user', content: userContent },
                { role: 'assistant', content: assistantContent }
            );
        }

        return {
            messages,
            metadata: {
                id: data.id,
                type: data.type,
                category: data.category,
                subcategory: data.subcategory,
                source: data.source,
                batch_id: data.batch_id
            }
        };
    }

    /**
     * 生成思考内容（<think>标签内的内容）
     * @param {Object} data - 数据对象
     * @param {string} responseContent - 回复内容
     * @returns {string} 思考内容
     */
    generateThinkingContent(data, responseContent) {
        // 根据数据类型生成不同的思考模式
        const thinkingTemplates = {
            '教训案例': () => {
                return `分析用户问题类型，识别这是一个经验教训类的询问。
需要从案例中提取关键教训点。
组织回答结构：先点明主题，再分条列出教训，最后总结。
确保语言简洁、实用，避免空泛说教。`;
            },
            '战术方法': () => {
                return `理解用户需求，这是一个寻求具体方法的询问。
梳理方法步骤，确保逻辑清晰、可操作性强。
考虑用户可能的应用场景，提供针对性的建议。
检查回答是否完整覆盖了问题要点。`;
            },
            '沟通技巧': () => {
                return `分析沟通场景，理解用户遇到的沟通问题。
提炼核心沟通原则和技巧。
组织回答：先共情，再给方法，最后鼓励。
确保建议实用、可执行。`;
            },
            '职场智慧': () => {
                return `识别职场问题类型，理解用户处境。
结合职场经验和规则，给出专业建议。
回答结构：分析问题→提供方案→注意事项。
语气要专业且温和，体现理解和关怀。`;
            }
        };

        // 根据类型选择思考模板
        const template = thinkingTemplates[data.type] || (() => {
            return `分析用户问题，理解核心需求。
组织回答结构，确保逻辑清晰。
检查内容准确性和完整性。
用简洁明了的语言回复。`;
        });

        return template();
    }

    /**
     * 格式化为 instruction-input-output 格式
     * @param {Object} data - 数据对象
     * @returns {Object} instruction 格式
     */
    formatAsInstruction(data) {
        // 根据类型生成指令
        const instruction = this.generateInstruction(data);

        return {
            instruction,
            input: data.title,
            output: data.content,
            metadata: {
                type: data.type,
                category: data.category,
                source: data.source
            }
        };
    }

    /**
     * 生成系统提示
     * @param {Object} data - 数据对象
     * @returns {string} 系统提示
     */
    generateSystemPrompt(data) {
        const typePrompts = {
            '教训案例': '你是一个经验分享专家，善于从具体案例中总结经验和教训。',
            '战术方法': '你是一个策略顾问，善于提供实用的方法和技巧。',
            '沟通技巧': '你是一个沟通专家，善于提供有效沟通的建议和话术。',
            '职场智慧': '你是一个职场导师，善于解答职场困惑并提供指导。'
        };

        return typePrompts[data.type] || '你是一个专业的 AI 助手，善于提供有用的信息和建议。';
    }

    /**
     * 生成指令
     * @param {Object} data - 数据对象
     * @returns {string} 指令文本
     */
    generateInstruction(data) {
        const typeInstructions = {
            '教训案例': '请分析这个案例并总结经验教训：',
            '战术方法': '请提供关于这个主题的方法论：',
            '沟通技巧': '请给出沟通建议：',
            '职场智慧': '请解答这个职场问题：'
        };

        return typeInstructions[data.type] || '请回答以下问题：';
    }

    /**
     * JSON 序列化时确保 ASCII 安全
     */
    ensureAscii(key, value) {
        if (typeof value === 'string') {
            // 转义特殊字符
            return value
                .replace(/\r\n/g, '\\n')
                .replace(/\r/g, '\\n')
                .replace(/\t/g, '    ');
        }
        return value;
    }

    /**
     * 按 8:1:1 拆分数据集
     * @param {Array} data - 数据列表
     * @returns {Object>} 拆分后的数据集
     */
    async splitDatasets(data = null) {
        if (!data) {
            data = await this.repo.exportForFinetuning();
        }

        // 随机打乱
        const shuffled = [...data].sort(() => Math.random() - 0.5);

        const total = shuffled.length;
        const trainSize = Math.floor(total * 0.8);
        const validationSize = Math.floor(total * 0.1);
        const testSize = total - trainSize - validationSize;

        return {
            train: shuffled.slice(0, trainSize),
            validation: shuffled.slice(trainSize, trainSize + validationSize),
            test: shuffled.slice(trainSize + validationSize),
            stats: {
                total,
                train: trainSize,
                validation: validationSize,
                test: testSize
            }
        };
    }

    /**
     * 导出并拆分数据集
     * @returns {Promise<Object>} 导出结果
     */
    async exportAndSplit() {
        // 导出所有数据
        const exportResult = await this.exportToJsonl();

        // 获取原始数据用于拆分
        const data = await this.repo.exportForFinetuning();

        // 拆分
        const splits = await this.splitDatasets(data);

        // 为每个拆分生成 JSONL
        const trainResult = await this.exportToJsonl(splits.train.map(d => d.id));
        const validationResult = await this.exportToJsonl(splits.validation.map(d => d.id));
        const testResult = await this.exportToJsonl(splits.test.map(d => d.id));

        return {
            total: exportResult.count,
            train: trainResult,
            validation: validationResult,
            test: testResult,
            stats: splits.stats
        };
    }

    /**
     * 标记已导出的数据
     * @param {string[]} dataIds - 数据 ID 列表
     */
    async markAsExported(dataIds) {
        const query = `
            UPDATE processed_data
            SET used_in_finetuning = TRUE,
                finetuning_exported_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ANY($1)
        `;
        await this.pool.query(query, [dataIds]);
    }

    /**
     * 获取导出统计
     * @returns {Promise<Object>} 统计信息
     */
    async getExportStats() {
        const query = `
            SELECT
                COUNT(*) FILTER (WHERE review_status = 'approved') as total_approved,
                COUNT(*) FILTER (WHERE used_in_finetuning = TRUE) as exported,
                COUNT(*) FILTER (WHERE review_status = 'approved' AND used_in_finetuning = FALSE) as pending_export
            FROM processed_data
        `;
        const result = await this.pool.query(query);
        const row = result.rows[0];

        return {
            totalApproved: Number(row.total_approved),
            exported: Number(row.exported),
            pendingExport: Number(row.pending_export)
        };
    }
}

module.exports = FinetuningExportService;
