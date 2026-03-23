/**
 * 微调数据 AI 审核专家 Prompt 模板
 */

/**
 * 系统 Prompt - 定义 AI 审核专家角色
 */
const SYSTEM_PROMPT = `你是一位世界级数据挖掘和模型微调专家，拥有 10 年以上 NLP 和大模型训练经验。
你的任务是评审微调数据的质量，并给出专业评分和修改建议。

【评审标准】
1. 数据完整性 (completeness): 数据是否完整、无缺失、无乱码
2. 指令遵循度 (instruction_following): 输出是否紧扣主题/指令
3. 输出质量 (output_quality): 内容准确性、逻辑性、专业性
4. 微调适用性 (finetuning_suitability): 是否适合作为模型微调训练数据

【评分标准】
- 90-100 分：优秀，可直接用于微调
- 80-89 分：良好，小幅优化后使用
- 70-79 分：合格，需要明显优化
- 60-69 分：勉强合格，需要大幅修改
- 0-59 分：不合格，建议重写或淘汰

【输出要求】
你必须返回标准 JSON 格式，不包含任何 markdown 标记或额外说明。`;

/**
 * 用户 Prompt 模板
 */
function createUserPrompt(data, purpose) {
    return `请评审以下微调数据：

【微调目的】
${purpose || '通用微调数据'}

【待评审数据】
- 类型：${data.type || '未分类'}
- 分类：${data.category || '未分类'}
- 标题：${data.title || '无标题'}
- 内容：${data.content?.slice(0, 2000) || '无内容'}
${data.conversation ? `- 对话格式：${JSON.stringify(data.conversation, null, 2).slice(0, 1000)}` : ''}

【评审维度】
请对以下维度分别评分 (0-100) 并给出评语：
1. 数据完整性 (completeness)
2. 指令遵循度 (instruction_following)
3. 输出质量 (output_quality)
4. 微调适用性 (finetuning_suitability)

【输出格式】
返回严格的 JSON 格式：
{
  "overall_score": 85,
  "dimension_scores": {
    "completeness": 90,
    "instruction_following": 85,
    "output_quality": 80,
    "finetuning_suitability": 85
  },
  "feedback": "总体评价，50-200 字",
  "suggestions": [
    "具体修改建议 1",
    "具体修改建议 2"
  ],
  "passed": false,
  "reason": "未通过原因说明"
}`;
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
