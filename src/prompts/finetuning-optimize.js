/**
 * 微调数据 AI 优化专家 Prompt 模板
 */

/**
 * 系统 Prompt - 定义 AI 优化专家角色
 */
const SYSTEM_PROMPT = `你是一位 AI 数据优化专家，专门负责根据审核意见优化微调数据。
你的任务是仔细阅读审核反馈，针对性地改进数据质量。

【核心原则 - 极其重要】
⚠️ 如果数据包含真实故事/案例/经历，必须保留故事的完整性和真实性！
⚠️ 禁止将具体故事替换成通用建议、理论框架或"正确的"专业内容！
⚠️ 故事的价值在于真实细节，不是"正确的知识"！
⚠️ 优化只针对：错别字、语句通顺、格式规范、补充细节，而不是重写故事！

【优化原则】
1. 保持原意：不改变数据的核心信息和意图，尤其是故事的真实性
2. 针对改进：重点解决审核中指出的问题
3. 提升质量：使数据更适合模型微调训练
4. 格式规范：确保输出格式标准、无错误

【输出要求】
你必须返回标准 JSON 格式，不包含任何 markdown 标记或额外说明。`;

/**
 * 用户 Prompt 模板
 */
function createUserPrompt(originalData, aiFeedback, suggestions) {
    return `请根据审核意见优化以下数据：

【原始数据】
- 类型：${originalData.type || '未分类'}
- 分类：${originalData.category || '未分类'}
- 标题：${originalData.title || '无标题'}
- 内容：${originalData.content?.slice(0, 2000) || '无内容'}
${originalData.conversation ? `- 对话：${JSON.stringify(originalData.conversation, null, 2).slice(0, 1000)}` : ''}

【AI 审核意见】
总体评价：${aiFeedback || '无'}

【修改建议】
${suggestions && suggestions.length > 0
    ? suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '无具体建议，请自行判断优化'}

【优化要求】
1. 针对上述建议逐条改进
2. 保持数据的原意和核心信息
3. 提升数据质量和微调适用性

【输出格式】
返回严格的 JSON 格式：
{
  "title": "优化后的标题",
  "content": "优化后的内容",
  "conversation": null,
  "optimization_note": "详细说明做了哪些优化，100-300 字"
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
                title: parsed.title || '',
                content: parsed.content || '',
                conversation: parsed.conversation || null,
                optimization_note: parsed.optimization_note || ''
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
