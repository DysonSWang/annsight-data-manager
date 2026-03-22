/**
 * URL 提取器
 * 整合下载器和各类提取器，处理 URL 输入
 */

const fs = require('fs');
const path = require('path');
const {
    identifyPlatform,
    downloadResource,
    initDownloaders
} = require('../downloaders/registry');
const { AudioExtractor } = require('./audio-extractor');
const { TextExtractor } = require('./text-extractor');
const { GenericDownloader } = require('../downloaders/generic');

class UrlExtractor {
    /**
     * 初始化下载器
     */
    constructor() {
        this.tempDir = process.env.DOWNLOAD_TEMP_DIR || '/tmp/annsight-downloads';
        initDownloaders();
    }

    /**
     * 提取 URL 内容
     * @param {string} url - URL 链接
     * @param {object} options - 配置选项
     * @returns {Promise<{text: string, metadata: object}>}
     */
    async extract(url, options = {}) {
        console.log(`[URL 提取器] 提取 URL: ${url}`);

        // 识别平台
        const platform = identifyPlatform(url);
        console.log(`[URL 提取器] 识别平台：${platform}`);

        // 创建临时目录
        const batchId = options.batchId || `batch-${Date.now()}`;
        const tempPath = path.join(this.tempDir, batchId, path.basename(url).split('?')[0]);
        await fs.promises.mkdir(tempPath, { recursive: true });

        try {
            // 根据平台选择处理策略
            if (['zhihu', 'xiaohongshu', 'bilibili', 'douyin'].includes(platform)) {
                // 视频平台：下载 + 转录
                return await this.handleVideoPlatform(url, platform, tempPath, options);
            } else if (platform === 'url') {
                // 直接文件链接：下载后根据类型处理
                return await this.handleDirectUrl(url, tempPath, options);
            } else {
                // 通用网页：抓取内容
                return await this.handleGenericUrl(url, tempPath, options);
            }

        } finally {
            // 清理临时文件（可选）
            if (!options.keepTempFiles) {
                try {
                    await fs.promises.rm(tempPath, { recursive: true, force: true });
                } catch (e) {
                    console.log('[URL 提取器] 清理临时文件失败:', e.message);
                }
            }
        }
    }

    /**
     * 处理视频平台
     */
    async handleVideoPlatform(url, platform, tempPath, options) {
        console.log(`[URL 提取器] 处理视频平台：${platform}`);

        // 下载视频
        const downloadResult = await downloadResource(platform, url, null, tempPath, options);

        // 调用音频提取器进行转录
        const audioExtractor = new AudioExtractor();
        const transcript = await audioExtractor.extract(downloadResult.videoPath || downloadResult.filePath, {
            model: options.whisperModel || 'base',
            language: 'zh'
        });

        return {
            text: transcript.text,
            metadata: {
                format: 'url_transcript',
                platform,
                sourceUrl: url,
                videoPath: downloadResult.videoPath,
                ...transcript.metadata,
                ...downloadResult.extra
            }
        };
    }

    /**
     * 处理直接文件 URL
     */
    async handleDirectUrl(url, tempPath, options) {
        console.log(`[URL 提取器] 处理直接文件 URL`);

        // 下载文件
        const { UrlDownloader } = require('../downloaders/url');
        const downloader = new UrlDownloader();
        const downloadResult = await downloader.download(url, null, tempPath);

        const filePath = downloadResult.filePath;
        const fileType = downloadResult.extra.fileType;

        // 根据文件类型选择提取器
        if (fileType === 'video' || fileType === 'audio') {
            const audioExtractor = new AudioExtractor();
            return await audioExtractor.extract(filePath, options);
        } else if (fileType === 'image') {
            const imageExtractor = new ImageExtractor();
            return await imageExtractor.extract(filePath, options);
        } else {
            // 文本文件
            const textExtractor = new TextExtractor();
            return await textExtractor.extract(filePath, options);
        }
    }

    /**
     * 处理通用网页
     */
    async handleGenericUrl(url, tempPath, options) {
        console.log(`[URL 提取器] 处理通用网页`);

        const genericDownloader = new GenericDownloader();
        const downloadResult = await genericDownloader.download(url, null, tempPath);

        // 读取 Markdown 内容
        const markdownContent = fs.readFileSync(downloadResult.filePath, 'utf-8');

        // 提取纯文本（去除 Markdown 格式）
        const text = this.markdownToText(markdownContent);

        return {
            text: text,
            metadata: {
                format: 'web',
                platform: downloadResult.extra.platform,
                sourceUrl: url,
                title: downloadResult.extra.title,
                author: downloadResult.extra.author,
                publishDate: downloadResult.extra.publishDate
            }
        };
    }

    /**
     * Markdown 转纯文本
     */
    markdownToText(markdown) {
        return markdown
            // 移除代码块
            .replace(/```[\s\S]*?```/g, '')
            // 移除行内代码
            .replace(/`[^`]+`/g, '')
            // 移除图片
            .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
            // 移除链接，保留文本
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            // 移除标题标记
            .replace(/^#+\s+/gm, '')
            // 移除粗体/斜体
            .replace(/\*\*([^*]+)\*\*/g, '$1')
            .replace(/\*([^*]+)\*/g, '$1')
            // 移除引用
            .replace(/^>\s+/gm, '')
            // 移除列表
            .replace(/^[-*+]\s+/gm, '')
            // 清理空白行
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }
}

module.exports = { UrlExtractor };
