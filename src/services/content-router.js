/**
 * 内容路由层
 * 根据输入类型路由到对应的提取器
 */

const fs = require('fs');
const path = require('path');
const { TextExtractor } = require('./extractors/text-extractor');
const { JsonExtractor } = require('./extractors/json-extractor');
const { JsonlExtractor } = require('./extractors/jsonl-extractor');
const { AudioExtractor } = require('./extractors/audio-extractor');
const { ImageExtractor } = require('./extractors/image-extractor');
const { AIVisionExtractor } = require('./extractors/ai-vision-extractor');
const { UrlExtractor } = require('./extractors/url-extractor');

/**
 * 内容类型枚举
 */
const ContentType = {
    TEXT: 'text',
    JSON: 'json',
    JSONL: 'jsonl',
    AUDIO: 'audio',
    VIDEO: 'video',
    IMAGE: 'image',
    URL: 'url'
};

/**
 * 图片识别模式
 */
const ImageMode = {
    OCR: 'ocr',           // 仅 OCR
    VISION: 'vision',     // 仅 AI 视觉
    HYBRID: 'hybrid'      // OCR + AI 视觉
};

/**
 * 内容路由类
 */
class ContentRouter {
    /**
     * 构造函数
     * @param {object} options - 配置选项
     * @param {'ocr' | 'vision' | 'hybrid'} options.imageMode - 图片识别模式
     */
    constructor(options = {}) {
        this.options = options;
        this.extractors = {
            [ContentType.TEXT]: new TextExtractor(),
            [ContentType.JSON]: new JsonExtractor(),
            [ContentType.JSONL]: new JsonlExtractor(),
            [ContentType.AUDIO]: new AudioExtractor(),
            [ContentType.IMAGE]: options.imageMode === 'vision' || options.imageMode === 'hybrid'
                ? new AIVisionExtractor()
                : new ImageExtractor(),
            [ContentType.URL]: new UrlExtractor()
        };
    }

    /**
     * 检测文件的内容类型
     * @param {string} filePath - 文件路径
     * @param {string} contentType - MIME 类型（可选）
     * @returns {string} 内容类型
     */
    detectType(filePath, contentType = '') {
        // 如果有 MIME 类型，优先使用
        if (contentType) {
            if (contentType.startsWith('image/')) return ContentType.IMAGE;
            if (contentType.startsWith('video/')) return ContentType.VIDEO;
            if (contentType.startsWith('audio/')) return ContentType.AUDIO;
            if (contentType === 'application/json') return ContentType.JSON;
            if (contentType.startsWith('text/')) return ContentType.TEXT;
        }

        // 通过扩展名判断
        const ext = filePath.split('.').pop().toLowerCase();

        const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
        const videoExts = ['mp4', 'mov', 'webm', 'avi', 'mkv'];
        const audioExts = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'];
        const jsonExts = ['json'];
        const jsonlExts = ['jsonl'];
        const textExts = ['txt', 'csv', 'md', 'html', 'htm'];

        if (imageExts.includes(ext)) return ContentType.IMAGE;
        if (videoExts.includes(ext)) return ContentType.VIDEO;
        if (audioExts.includes(ext)) return ContentType.AUDIO;
        if (jsonlExts.includes(ext)) return ContentType.JSONL;
        if (jsonExts.includes(ext)) return ContentType.JSON;
        if (textExts.includes(ext)) return ContentType.TEXT;

        return ContentType.TEXT; // 默认
    }

    /**
     * 路由到对应的提取器
     * @param {object} input - 输入对象
     * @param {string} input.type - 输入类型：'file', 'url', 'text'
     * @param {string} input.path - 文件路径（type=file 时）
     * @param {string} input.url - URL 链接（type=url 时）
     * @param {string} input.text - 文本内容（type=text 时）
     * @param {string} input.contentType - MIME 类型（可选）
     * @param {object} options - 配置选项
     * @returns {Promise<{text: string, metadata: object, items?: array}>}
     */
    async route(input, options = {}) {
        console.log('[ContentRouter] 路由输入:', JSON.stringify(input));

        const { type } = input;

        // URL 类型
        if (type === 'url' || (type === 'text' && this.isUrl(input.text))) {
            const url = input.url || input.text;
            const extractor = this.extractors[ContentType.URL];
            return await extractor.extract(url, options);
        }

        // 文件类型
        if (type === 'file') {
            const filePath = input.path || input.filePath;
            const contentType = input.contentType;

            if (!fs.existsSync(filePath)) {
                throw new Error(`文件不存在：${filePath}`);
            }

            const detectedType = this.detectType(filePath, contentType);

            // 视频和音频都使用音频提取器（转录）
            if (detectedType === ContentType.VIDEO || detectedType === ContentType.AUDIO) {
                const extractor = this.extractors[ContentType.AUDIO];
                return await extractor.extract(filePath, options);
            }

            // 图片使用 OCR 提取器
            if (detectedType === ContentType.IMAGE) {
                const extractor = this.extractors[ContentType.IMAGE];
                return await extractor.extract(filePath, options);
            }

            // JSON 使用 JSON 提取器
            if (detectedType === ContentType.JSON) {
                const extractor = this.extractors[ContentType.JSON];
                return await extractor.extract(filePath, options);
            }

            // JSONL 使用 JSONL 提取器
            if (detectedType === ContentType.JSONL) {
                const extractor = this.extractors[ContentType.JSONL];
                return await extractor.extract(filePath, options);
            }

            // 其他使用文本提取器
            const extractor = this.extractors[ContentType.TEXT];
            return await extractor.extract(filePath, options);
        }

        // 纯文本类型
        if (type === 'text') {
            return {
                text: input.text,
                metadata: {
                    format: 'text',
                    charCount: input.text.length,
                    lineCount: input.text.split('\n').length
                }
            };
        }

        throw new Error(`不支持的输入类型：${type}`);
    }

    /**
     * 判断是否是 URL
     */
    isUrl(text) {
        if (!text || typeof text !== 'string') return false;

        const urlPattern = /^(https?:\/\/)?([\w-]+\.)+[\w-]+(\/[\w-./?%&=]*)?$/i;
        return urlPattern.test(text.trim());
    }

    /**
     * 批量处理
     * @param {array} inputs - 输入列表
     * @param {object} options - 配置选项
     * @returns {Promise<array>} 提取结果列表
     */
    async batchRoute(inputs, options = {}) {
        console.log(`[ContentRouter] 批量处理 ${inputs.length} 条输入`);

        const results = [];

        for (const input of inputs) {
            try {
                const result = await this.route(input, options);
                results.push({
                    success: true,
                    input,
                    result
                });
            } catch (error) {
                results.push({
                    success: false,
                    input,
                    error: error.message
                });
            }
        }

        return results;
    }
}

module.exports = { ContentRouter, ContentType };
