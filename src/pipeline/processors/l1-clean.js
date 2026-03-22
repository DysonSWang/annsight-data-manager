const { BaseProcessor } = require('../base');

/**
 * L1 文本清洗处理器
 * 负责基础文本清洗：移除 HTML、emoji、水印等
 */
class L1CleanProcessor extends BaseProcessor {
    getName() {
        return 'l1-clean';
    }

    async process(context) {
        const { rawText, transcript } = context;

        const text = transcript || rawText;
        if (!text) {
            throw new Error('没有可处理的文本内容');
        }

        // L1: 移除 HTML 标签
        const noHtml = this.removeHtml(text);

        // L2: 移除 emoji
        const noEmoji = this.removeEmoji(noHtml);

        // L3: 移除常见水印
        const noWatermark = this.removeWatermark(noEmoji);

        // L4: 标准化空白字符
        const normalized = this.normalizeWhitespace(noWatermark);

        // L5: 修正特殊格式
        const cleaned = this.fixSpecialFormats(normalized);

        return {
            cleanedText: cleaned,
            cleanStats: {
                originalLength: text.length,
                cleanedLength: cleaned.length,
                removedLength: text.length - cleaned.length
            }
        };
    }

    /**
     * 移除 HTML 标签
     */
    removeHtml(text) {
        return text.replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
    }

    /**
     * 移除 emoji
     */
    removeEmoji(text) {
        // 匹配大多数 emoji 的正则
        const emojiRegex = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;
        return text.replace(emojiRegex, '');
    }

    /**
     * 移除常见水印
     */
    removeWatermark(text) {
        const watermarks = [
            // 小红书水印
            /小红书 ID：\w+/gi,
            /小红书号：\w+/gi,
            /@[^\s]+\s*$/gm,
            // 抖音水印
            /抖音号：\w+/gi,
            /抖音 ID：\w+/gi,
            // 通用水印
            /来自\s+\S+/gi,
            /via\s+\S+/gi,
            /#?\w+ 话题 #/gi
        ];

        let result = text;
        for (const regex of watermarks) {
            result = result.replace(regex, '');
        }
        return result.trim();
    }

    /**
     * 标准化空白字符
     */
    normalizeWhitespace(text) {
        return text
            // 多个空格合并为一个
            .replace(/[ \t]+/g, ' ')
            // 标准化换行符
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            // 移除行首尾空格
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join('\n');
    }

    /**
     * 修正特殊格式
     */
    fixSpecialFormats(text) {
        return text
            // 修正中英文混排空格
            .replace(/([a-zA-Z])([\u4e00-\u9fa5])/g, '$1 $2')
            .replace(/([\u4e00-\u9fa5])([a-zA-Z])/g, '$1 $2')
            // 修正标点符号
            .replace(/,,/g, '，')
            .replace(/\.\./g, '。')
            .replace(/;;/g, '；')
            .replace(/""/g, '"')
            .replace(/''/g, "'");
    }

    isRequired() {
        return true;
    }
}

module.exports = { L1CleanProcessor };
