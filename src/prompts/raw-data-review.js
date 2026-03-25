/**
 * 源数据 AI 审核专家 Prompt 模板
 */

/**
 * 系统 Prompt - 定义 AI 审核专家角色
 */
const SYSTEM_PROMPT = `你是一位专业内容质量审核专家，擅长评估文本内容的完整性、准确性和可用性。

你的任务是审核原始数据的质量，判断其是否适合用于后续的 RAG 检索、微调训练或内容创作。

【评审标准】
1. 内容完整性 (completeness): 内容是否完整、无缺失、无乱码
2. 语言流畅度 (fluency): 语言是否流畅、自然、符合表达习惯
3. 信息准确性 (accuracy): 信息是否准确、无明显错误
4. 内容价值度 (value): 内容是否有价值、有意义、值得保留
5. 后续适用性 (suitability): 是否适合用于 RAG 检索或微调训练

【评分标准】
- 90-100 分：优秀，内容完整、表达精良，可直接使用
- 80-89 分：良好，质量较高，小幅优化后使用
- 70-79 分：合格，内容基本完整，需要适当优化
- 60-69 分：勉强合格，需要明显修改
- 0-59 分：不合格，内容质量差，建议丢弃

【输出要求】
你必须返回标准 JSON 格式，不包含任何 markdown 标记或额外说明。`;

/**
 * 用户 Prompt 模板
 */
function createUserPrompt(data, customPrompt = '') {
    // 从多种可能的位置提取内容
    const content = data.content ||
                   (data.metadata?.text) ||
                   data.oss_url ||
                   '无内容';

    let prompt = `请评审以下内容：

【待评审内容】
${content.length > 3000 ? content.slice(0, 3000) + '...(内容过长，已截断)' : content}

【内容长度】${content.length} 字

`;

    if (customPrompt) {
        prompt += `【审核要求】
${customPrompt}

`;
    }

    prompt += `【评审维度】
请对以下维度分别评分 (0-100) 并给出评语：
1. 内容完整性 (completeness)
2. 语言流畅度 (fluency)
3. 信息准确性 (accuracy)
4. 内容价值度 (value)
5. 后续适用性 (suitability)

【输出格式】
返回严格的 JSON 格式：
{
  "overall_score": 85,
  "dimension_scores": {
    "completeness": 90,
    "fluency": 85,
    "accuracy": 80,
    "value": 85,
    "suitability": 85
  },
  "feedback": "总体评价，50-200 字",
  "suggestions": [
    "具体修改建议 1",
    "具体修改建议 2"
  ],
  "passed": true,
  "reason": "通过/未通过的原因说明"
}`;

    return prompt;
}

/**
 * 解析 AI 响应
 */
function parseResponse(responseText) {
    try {
        // 尝试提取 JSON
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch ? jsonMatch[0] : responseText;
        const parsed = JSON.parse(jsonStr);

        return {
            success: true,
            data: {
                overall_score: parsed.overall_score || 0,
                dimension_scores: parsed.dimension_scores || {},
                feedback: parsed.feedback || '',
                suggestions: parsed.suggestions || [],
                passed: parsed.passed || false,
                reason: parsed.reason || ''
            }
        };
    } catch (error) {
        return {
            success: false,
            error: `解析 AI 响应失败：${error.message}`,
            rawResponse: responseText
        };
    }
}

module.exports = {
    SYSTEM_PROMPT,
    createUserPrompt,
    parseResponse
};
