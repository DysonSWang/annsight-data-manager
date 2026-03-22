const { BaseProcessor } = require('../base');

/**
 * L2 结构化处理器
 * 使用 LLM 进行自动分类和结构化提取
 */
class L2StructureProcessor extends BaseProcessor {
    /**
     * @param {object} llmService - LLM 服务实例
     */
    constructor(llmService) {
        super();
        this.llmService = llmService;
    }

    getName() {
        return 'l2-structure';
    }

    async process(context) {
        const { cleanedText, sourceType, items, purposes } = context;

        // 如果裂变已经产生了 items，直接使用裂变结果
        // 裂变处理器已经包含了 type, category, title, content 等字段
        if (items && Array.isArray(items) && items.length > 0) {
            // 裂变模式：补充缺失字段
            const enhancedItems = items.map(item => ({
                ...item,
                aiConfidenceScore: item.aiConfidenceScore || 0.8,
                aiModelVersion: item.aiModelVersion || 'fission-v1.0',
                structureNote: item.structureNote || '裂变生成'
            }));

            // 返回第一条作为当前上下文（后续会通过 saveProcessedData 的 items 数组处理所有）
            // 实际上裂变模式下，L2 不需要再做结构化，直接传递裂变结果
            return {
                items: enhancedItems,
                fissionMode: true,
                ...enhancedItems[0] // 解包第一条供下游兼容
            };
        }

        // 传统模式：单条数据处理
        if (!cleanedText) {
            throw new Error('没有可处理的文本内容');
        }

        // 调用 LLM 进行结构化分析
        const structured = await this.llmService.analyze(cleanedText, {
            withLogprobs: true,  // 获取置信度
            withReasoning: true,  // 获取推理过程
            purposes // 传入用途选项
        });

        return {
            structured,
            type: structured.type,
            category: structured.category,
            subcategory: structured.subcategory,
            targetUser: structured.target_user,
            title: structured.title,
            content: structured.content,
            tags: structured.tags || [],
            conversation: structured.conversation || null,
            aiConfidenceScore: structured.confidence || 0.5,
            aiModelVersion: structured.model_version || 'v1.0',
            structureNote: structured.reasoning || ''
        };
    }

    isRequired() {
        return true;
    }
}

/**
 * 简化的 LLM 服务（用于测试）
 * 实际使用时替换为真实的 LLM API 调用
 */
class MockLlmService {
    async analyze(text, options = {}) {
        // 模拟 LLM 分析结果
        const typeKeywords = {
            '教训案例': ['教训', '案例', '错误', '后悔', '明白'],
            '战术方法': ['方法', '技巧', '策略', ' approach'],
            '沟通技巧': ['沟通', '话术', '表达', '说话'],
            '职场智慧': ['职场', '工作', '同事', '领导'],
            '情感': ['恋爱', '婚姻', '感情', '分手'],
            '家庭': ['家庭', '父母', '孩子', '夫妻'],
            '社交': ['社交', '朋友', '邻居', '聚会']
        };

        // 简单的关键词匹配
        let detectedType = '职场智慧';
        let maxCount = 0;

        for (const [type, keywords] of Object.entries(typeKeywords)) {
            const count = keywords.filter(k => text.includes(k)).length;
            if (count > maxCount) {
                maxCount = count;
                detectedType = type;
            }
        }

        const categoryMap = {
            '职场智慧': ['职场', '向上管理', '平级协作', '晋升谈判'],
            '教训案例': ['职场', '情感', '家庭', '社交'],
            '战术方法': ['职场', '情感', '家庭', '社交'],
            '沟通技巧': ['职场', '情感', '家庭', '社交'],
            '情感': ['恋爱', '婚姻', '相亲', '异地恋'],
            '家庭': ['夫妻', '亲子', '婆媳', '代际'],
            '社交': ['聚会', '邻里', '社区', '朋友']
        };

        const categories = categoryMap[detectedType] || ['通用'];
        const detectedCategory = categories[0];

        // 提取标题（第一行或前 30 字）
        const firstLine = text.split('\n')[0].slice(0, 50);
        const title = firstLine || '未命名文档';

        // 提取内容（剩余部分）
        const content = text.slice(firstLine.length).trim() || text;

        return {
            type: detectedType,
            category: detectedCategory,
            subcategory: categories[1] || null,
            target_user: '通用',
            title,
            content,
            tags: this.extractTags(text),
            confidence: Math.min(0.95, 0.5 + maxCount * 0.1),
            model_version: 'mock-v1.0',
            reasoning: `基于关键词匹配，检测到 ${maxCount} 个${detectedType}相关词汇`
        };
    }

    extractTags(text) {
        // 简单提取#话题标签
        const hashtags = text.match(/#\w+/g) || [];
        return [...new Set(hashtags)].slice(0, 5);
    }
}

module.exports = { L2StructureProcessor, MockLlmService };
