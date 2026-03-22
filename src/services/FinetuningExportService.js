const ProcessedDataRepository = require('../repository/ProcessedDataRepository');

/**
 * 微调数据导出服务
 * 负责将审核通过的数据导出为阿里百炼微调数据集格式 (JSONL)
 */
class FinetuningExportService {
    constructor(pool) {
        this.pool = pool;
        this.repo = new ProcessedDataRepository(pool);
    }

    /**
     * 导出为 JSONL 格式
     * @param {string[]} dataIds - 数据 ID 列表，为空则导出所有已审核数据
     * @returns {Promise<Object>} JSONL 行数和内容
     */
    async exportToJsonl(dataIds = null) {
        let data;

        if (dataIds) {
            data = await Promise.all(dataIds.map(id => this.repo.findById(id)));
        } else {
            data = await this.repo.exportForFinetuning();
        }

        const lines = [];

        for (const item of data) {
            let jsonLine;

            // 如果有对话数据，使用 messages 格式 (适用于多轮对话微调)
            if (item.conversation && Array.isArray(item.conversation) && item.conversation.length > 0) {
                jsonLine = this.formatAsMessages(item);
            } else {
                // 否则使用 instruction-input-output 格式
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
