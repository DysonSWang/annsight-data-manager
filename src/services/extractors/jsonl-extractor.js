/**
 * JSONL 提取器
 * 支持 JSONL 格式文件（每行一个 JSON 对象）
 * 特别适用于微调数据集导入
 */

const fs = require('fs');

class JsonlExtractor {
    /**
     * 支持的 MIME 类型
     */
    static get supportedTypes() {
        return ['application/jsonl', 'application/x-jsonlines'];
    }

    /**
     * 检测是否支持此文件类型
     */
    static supports(contentType, filePath = '') {
        if (filePath) {
            const ext = filePath.split('.').pop().toLowerCase();
            return ext === 'jsonl';
        }
        return false;
    }

    /**
     * 提取 JSONL 内容
     * @param {string} filePath - 文件路径
     * @param {object} options - 配置选项
     * @returns {Promise<{text: string, metadata: object, items: array}>}
     */
    async extract(filePath, options = {}) {
        console.log(`[JSONL 提取器] 提取文件：${filePath}`);

        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split(/\r?\n/).filter(line => line.trim());

        const items = [];
        const textRows = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            try {
                const json = JSON.parse(line);
                const extracted = this.extractItem(json, options);

                if (extracted.text) {
                    items.push({
                        ...extracted,
                        lineNumber: i + 1
                    });
                    textRows.push(extracted.text);
                }
            } catch (error) {
                console.warn(`[JSONL 提取器] 第 ${i + 1} 行解析失败：${error.message}`);
            }
        }

        return {
            text: textRows.join('\n\n---\n\n'),
            metadata: {
                format: 'jsonl',
                totalLines: lines.length,
                validItems: items.length,
                failedLines: lines.length - items.length
            },
            items
        };
    }

    /**
     * 提取单个 JSONL 项目
     *
     * 支持多种格式：
     * 1. { messages: [{role, content}, ...] } - OpenAI 格式
     * 2. { input: '', output: '' } - 对话格式
     * 3. { text: '' } - 纯文本格式
     * 4. { content: '' } - 内容格式
     */
    extractItem(json, options = {}) {
        // 格式 1: OpenAI 消息格式 { messages: [...] }
        if (json.messages && Array.isArray(json.messages)) {
            return this.extractMessagesFormat(json, options);
        }

        // 格式 2: 输入输出格式 { input, output }
        if (json.input !== undefined && json.output !== undefined) {
            return {
                text: `用户：${json.input}\n\n助手：${json.output}`,
                metadata: {
                    format: 'input_output',
                    inputLength: json.input?.length || 0,
                    outputLength: json.output?.length || 0
                },
                conversation: [
                    { role: 'user', content: json.input },
                    { role: 'assistant', content: json.output }
                ]
            };
        }

        // 格式 3: 纯文本格式 { text }
        if (json.text) {
            return {
                text: json.text,
                metadata: { format: 'text' }
            };
        }

        // 格式 4: 内容格式 { content }
        if (json.content) {
            return {
                text: json.content,
                metadata: { format: 'content' }
            };
        }

        // 格式 5: 问答格式 { question, answer }
        if (json.question && json.answer) {
            return {
                text: `问题：${json.question}\n\n回答：${json.answer}`,
                metadata: { format: 'qa' },
                conversation: [
                    { role: 'user', content: json.question },
                    { role: 'assistant', content: json.answer }
                ]
            };
        }

        // 兜底：提取所有字符串值
        const strings = this.extractAllStrings(json);
        return {
            text: strings.join('\n'),
            metadata: { format: 'auto', fields: Object.keys(json) }
        };
    }

    /**
     * 提取 OpenAI 消息格式
     */
    extractMessagesFormat(json, options = {}) {
        const messages = json.messages;
        const texts = [];
        const conversation = [];

        for (const msg of messages) {
            if (msg.content) {
                const role = msg.role || 'unknown';
                texts.push(`${this.getRoleName(role)}: ${msg.content}`);
                conversation.push({
                    role: role === 'human' ? 'user' : role,
                    content: msg.content
                });
            }
        }

        // 提取系统提示（如果有）
        const systemMessage = messages.find(m => m.role === 'system');
        const userMessage = messages.find(m => m.role === 'user');

        return {
            text: texts.join('\n\n'),
            metadata: {
                format: 'openai_messages',
                messageCount: messages.length,
                systemPrompt: systemMessage?.content,
                userPrompt: userMessage?.content
            },
            conversation,
            // 提取用户问题作为标题
            title: this.generateTitle(userMessage?.content)
        };
    }

    /**
     * 获取角色名称（中文）
     */
    getRoleName(role) {
        const names = {
            'system': '系统',
            'user': '用户',
            'assistant': '助手',
            'human': '用户'
        };
        return names[role] || role;
    }

    /**
     * 生成标题
     */
    generateTitle(text) {
        if (!text) return '无标题';
        // 截取前 50 个字符作为标题
        return text.slice(0, 50) + (text.length > 50 ? '...' : '');
    }

    /**
     * 提取对象中的所有字符串
     */
    extractAllStrings(obj, depth = 0) {
        const results = [];

        if (depth > 10) return results;

        if (typeof obj === 'string') {
            results.push(obj);
        } else if (Array.isArray(obj)) {
            for (const item of obj) {
                results.push(...this.extractAllStrings(item, depth + 1));
            }
        } else if (typeof obj === 'object' && obj !== null) {
            for (const value of Object.values(obj)) {
                results.push(...this.extractAllStrings(value, depth + 1));
            }
        }

        return results.filter(s => s.trim().length > 0);
    }
}

module.exports = { JsonlExtractor };
