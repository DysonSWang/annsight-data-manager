/**
 * 源数据 AI 优化专家 Prompt 模板
 */

/**
 * 系统 Prompt - 定义 AI 优化专家角色
 */
const SYSTEM_PROMPT = `你是一位专业内容优化专家，擅长根据反馈意见改进文本内容。

你的任务是根据审核意见和优化要求，对原始内容进行优化，使其更加完整、准确、有价值。

【核心原则】
1. 保持原意：优化时保持原文的核心信息和意图不变
2. 补充细节：在原文基础上补充缺失的细节和背景
3. 改进表达：优化语言表达，使其更加流畅自然
4. 修正错误：修正事实性错误、语法错误、错别字等
5. 增强价值：增加有价值的信息、案例、例子等

【输出要求】
你必须返回标准 JSON 格式，不包含任何 markdown 标记或额外说明。`;

/**
 * 用户 Prompt 模板
 */
function createUserPrompt(originalData, userPrompt = '') {
    const originalContent = originalData.content ||
                           (originalData.metadata?.text) ||
                           originalData.oss_url ||
                           '无内容';

    let prompt = `请优化以下内容：

【原始内容】
${originalContent.length > 2000 ? originalContent.slice(0, 2000) + '...(内容过长，已截断)' : originalContent}

`;

    if (userPrompt) {
        prompt += `【优化要求】
${userPrompt}

`;
    }

    prompt += `【输出格式】
返回严格的 JSON 格式：
{
  "optimized_content": "优化后的完整内容",
  "changes": [
    "补充了...内容",
    "优化了...表达",
    "修正了...错误"
  ],
  "explanation": "优化说明，50-100 字"
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
                optimized_content: parsed.optimized_content || '',
                changes: parsed.changes || [],
                explanation: parsed.explanation || ''
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
