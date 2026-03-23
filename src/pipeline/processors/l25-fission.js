const { BaseProcessor } = require('../base');

/**
 * L2.5 多用途裂变处理器
 * 根据配置的用途方向，将源数据裂变成多条不同用途的数据
 *
 * 支持的用途：
 * - rag: RAG 知识库素材（知识点、案例、技巧）
 * - finetuning: 微调数据（多轮对话、问答对）
 * - content_creation: 内容创作素材（选题、大纲、素材片段）
 */
class L25FissionProcessor extends BaseProcessor {
    /**
     * @param {object} llmService - LLM 服务实例
     * @param {object} options - 选项配置
     * @param {string[]} options.purposes - 支持的用途列表 ['rag', 'finetuning', 'content_creation']
     */
    constructor(llmService, options = {}) {
        super();
        this.llmService = llmService;
        this.options = options;
    }

    getName() {
        return 'l25-fission';
    }

    async process(context) {
        const { cleanedText, sourceType, purposes: contextPurposes, fissionConfig, batchId, source } = context;

        if (!cleanedText) {
            throw new Error('没有可处理的文本内容');
        }

        // 优先使用上下文中的 purposes，否则使用构造函数中的配置
        const purposes = contextPurposes || this.options.purposes || ['rag', 'finetuning', 'content_creation'];

        // 调用 LLM 进行多用途裂变分析（传入裂变配置）
        const fissionResult = await this.llmService.analyzeForFission(cleanedText, {
            purposes,
            sourceType,
            fissionConfig // 传递裂变配置（每种用途的数量和要求）
        });

        // fissionResult.items 应该是一个数组，每个元素代表一条加工数据
        // 格式：{type, category, title, content, purposes, tags, ...}

        // 确保每条 item 都有 purposes 字段
        const enhancedItems = (fissionResult.items || []).map(item => ({
            ...item,
            // 如果 item 没有 purposes，使用配置的 purposes
            purposes: item.purposes || purposes,
            batchId,
            source: source || sourceType
        }));

        return {
            items: enhancedItems,
            fissionCount: enhancedItems.length || 1,
            fissionNote: `裂变 ${enhancedItems.length || 1} 条数据`,
            purposes // 传递 purposes 到下游
        };
    }

    isRequired() {
        return false; // 可选处理器
    }
}

/**
 * 简化的 LLM 服务（用于测试）
 * 实际使用时替换为真实的 LLM API 调用
 */
class MockLlmServiceForFission {
    /**
     * 分析文本并裂变出多条不同用途的数据
     * @param {string} text - 输入文本
     * @param {object} options - 选项
     * @param {string[]} options.purposes - 用途列表
     * @param {string} options.sourceType - 来源类型
     * @param {object} options.fissionConfig - 裂变配置 { rag: { count: 3, requirement: '...' }, ... }
     */
    async analyzeForFission(text, options = {}) {
        const { purposes = ['rag'], sourceType = 'unknown', fissionConfig = {} } = options;
        const items = [];

        // 遍历每种用途，根据配置生成对应数量的数据
        for (const purpose of purposes) {
            const config = fissionConfig[purpose] || {};
            const count = config.count || 1; // 默认生成 1 条
            const requirement = config.requirement || ''; // 用户要求说明

            // 根据配置的数量生成多条数据
            for (let i = 0; i < count; i++) {
                if (purpose === 'rag') {
                    // 生成 RAG 知识点
                    items.push({
                        type: '知识卡片',
                        category: '职场',
                        title: `RAG 知识点示例 ${i + 1}${requirement ? ` - ${requirement.slice(0, 20)}` : ''}`,
                        content: text.slice(0, 200),
                        purposes: ['rag'],
                        tags: ['知识点', 'RAG'],
                        aiConfidenceScore: 0.85
                    });
                } else if (purpose === 'finetuning') {
                    // 生成微调对话数据
                    items.push({
                        type: '多轮对话',
                        category: '职场',
                        title: `微调对话示例 ${i + 1}${requirement ? ` - ${requirement.slice(0, 20)}` : ''}`,
                        content: text.slice(0, 200),
                        purposes: ['finetuning'],
                        conversation: [
                            {role: 'user', content: '如何提高沟通能力？'},
                            {role: 'assistant', content: text.slice(0, 100)}
                        ],
                        tags: ['对话', '微调'],
                        aiConfidenceScore: 0.8
                    });
                } else if (purpose === 'content_creation') {
                    // 生成内容创作素材
                    items.push({
                        type: '创作素材',
                        category: '通用',
                        title: `内容素材片段 ${i + 1}${requirement ? ` - ${requirement.slice(0, 20)}` : ''}`,
                        content: text.slice(0, 150),
                        purposes: ['content_creation'],
                        tags: ['素材', '创作'],
                        aiConfidenceScore: 0.75
                    });
                } else if (purpose === 'other') {
                    // 生成其他用途数据
                    items.push({
                        type: '其他素材',
                        category: '通用',
                        title: `其他素材 ${i + 1}${requirement ? ` - ${requirement.slice(0, 20)}` : ''}`,
                        content: text.slice(0, 180),
                        purposes: ['other'],
                        tags: ['其他'],
                        aiConfidenceScore: 0.7
                    });
                }
            }
        }

        return { items };
    }
}

module.exports = { L25FissionProcessor, MockLlmServiceForFission };
