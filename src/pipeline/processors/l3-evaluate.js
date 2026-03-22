const { BaseProcessor } = require('../base');

/**
 * L3 质量评估处理器
 * 评估数据质量，计算完整性评分和真实性评分
 */
class L3EvaluateProcessor extends BaseProcessor {
    getName() {
        return 'l3-evaluate';
    }

    async process(context) {
        const { cleanedText, structured, type, category, items, fissionMode } = context;

        // 裂变模式：如果已经有 items，则补充质量评分
        if (fissionMode && items && Array.isArray(items)) {
            const enhancedItems = items.map(item => ({
                ...item,
                completenessScore: item.completenessScore || this.evaluateCompletenessSimple(item),
                authenticityScore: item.authenticityScore || 3,
                qualityScore: item.qualityScore || 0.75,
                qualityNote: item.qualityNote || '裂变生成'
            }));

            return {
                items: enhancedItems,
                fissionMode: true,
                // 返回第一条供下游兼容
                completenessScore: enhancedItems[0].completenessScore,
                authenticityScore: enhancedItems[0].authenticityScore,
                qualityScore: enhancedItems[0].qualityScore,
                qualityNote: enhancedItems[0].qualityNote
            };
        }

        // 传统模式：单条数据处理
        if (!cleanedText) {
            throw new Error('没有可评估的内容');
        }

        // L1: 完整性评分
        const completenessScore = this.evaluateCompleteness(context);

        // L2: 真实性评分（需要人工审核，AI 只做初步判断）
        const authenticityScore = this.evaluateAuthenticity(context);

        // L3: 综合质量评分
        const qualityScore = this.calculateQualityScore(completenessScore, authenticityScore);

        // 评估备注
        const note = this.generateNote(context, completenessScore, authenticityScore);

        return {
            completenessScore,
            authenticityScore,
            qualityScore,
            qualityNote: note
        };
    }

    /**
     * 简化版完整性评估（用于裂变数据）
     */
    evaluateCompletenessSimple(item) {
        const { content, title } = item;
        let score = 0;

        // 内容长度评分
        if (content && content.length > 50) {
            score += 0.5 * Math.min(1, content.length / 200);
        }

        // 标题评分
        if (title && title.length > 5) {
            score += 0.3;
        }

        // 标签评分
        if (item.tags && item.tags.length > 0) {
            score += 0.2;
        }

        return Math.min(1.0, score);
    }

    /**
     * 评估完整性
     */
    evaluateCompleteness(context) {
        const { structured, cleanedText, title, content, type, category } = context;
        let score = 0;
        let maxScore = 0;

        // 基础内容完整性 (30 分)
        maxScore += 30;
        if (cleanedText && cleanedText.length > 100) {
            score += 30 * Math.min(1, cleanedText.length / 500);
        }

        // 标题完整性 (15 分)
        maxScore += 15;
        if (title && title.length > 5) {
            score += 15;
        }

        // 内容完整性 (25 分)
        maxScore += 25;
        if (content && content.length > 50) {
            score += 25;
        }

        // 分类完整性 (20 分)
        maxScore += 20;
        if (type) score += 10;
        if (category) score += 10;

        // 结构化完整性 (10 分)
        maxScore += 10;
        if (structured) {
            if (structured.subcategory) score += 5;
            if (structured.target_user) score += 3;
            if (structured.tags && structured.tags.length > 0) score += 2;
        }

        return Math.round((score / maxScore) * 10000) / 10000;
    }

    /**
     * 评估真实性（AI 初步判断）
     * 返回 1-5 分
     */
    evaluateAuthenticity(context) {
        const { cleanedText, type } = context;
        let score = 3; // 默认 3 分

        // 有具体场景描述的加分
        const sceneKeywords = ['有一次', '那天', '当时', '记得', '场景', '会议', '办公室', '家里'];
        const sceneCount = sceneKeywords.filter(k => cleanedText.includes(k)).length;
        if (sceneCount > 0) {
            score += Math.min(1, sceneCount * 0.2);
        }

        // 有情绪表达的加分
        const emotionKeywords = ['后悔', '难过', '生气', '开心', '委屈', '感动', '震惊', '失望'];
        const emotionCount = emotionKeywords.filter(k => cleanedText.includes(k)).length;
        if (emotionCount > 0) {
            score += Math.min(0.5, emotionCount * 0.1);
        }

        // 有具体数字的加分（时间、数量等）
        const numberRegex = /\d+/g;
        const numbers = cleanedText.match(numberRegex);
        if (numbers && numbers.length > 0) {
            score += Math.min(0.5, numbers.length * 0.1);
        }

        // 教训案例类型要求有后果描述
        if (type === '教训案例') {
            const consequenceKeywords = ['结果', '后来', '之后', '从此', '然后', '后果', '代价'];
            const hasConsequence = consequenceKeywords.some(k => cleanedText.includes(k));
            if (hasConsequence) {
                score += 0.5;
            }
        }

        return Math.min(5, Math.max(1, Math.round(score)));
    }

    /**
     * 计算综合质量评分
     */
    calculateQualityScore(completeness, authenticity) {
        // 完整性占 60%，真实性占 40%
        const normalizedAuthenticity = (authenticity - 1) / 4; // 转换为 0-1
        const score = completeness * 0.6 + normalizedAuthenticity * 0.4;
        return Math.round(score * 10000) / 10000;
    }

    /**
     * 生成评估备注
     */
    generateNote(context, completeness, authenticity) {
        const notes = [];

        if (completeness < 0.6) {
            notes.push('内容完整性不足，建议补充更多细节');
        }

        if (authenticity <= 2) {
            notes.push('真实性评分较低，需要人工审核确认');
        } else if (authenticity >= 4) {
            notes.push('真实性评分高，包含具体场景和情绪描述');
        }

        if (context.cleanedText?.length < 200) {
            notes.push('内容较短，建议扩展至 200 字以上');
        }

        return notes.join('；') || '质量评估通过';
    }

    isRequired() {
        return true;
    }
}

module.exports = { L3EvaluateProcessor };
