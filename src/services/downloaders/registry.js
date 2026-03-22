/**
 * 下载器注册表
 * 管理所有平台的下载器，提供统一的下载接口
 */

const { ZhihuDownloader } = require('./zhihu');
const { UrlDownloader } = require('./url');
const { GenericDownloader } = require('./generic');

// 下载器注册表
const downloaders = new Map();

/**
 * 注册下载器
 * @param {string} platform - 平台 ID
 * @param {BaseDownloader} downloaderClass - 下载器类
 */
function registerDownloader(platform, downloaderClass) {
    downloaders.set(platform, downloaderClass);
    console.log(`[下载器] 注册平台：${platform}`);
}

/**
 * 获取下载器实例
 * @param {string} platform - 平台 ID
 * @returns {BaseDownloader} 下载器实例
 */
function getDownloader(platform) {
    const DownloaderClass = downloaders.get(platform);
    if (!DownloaderClass) {
        throw new Error(`不支持的平台：${platform}`);
    }
    return new DownloaderClass();
}

/**
 * 下载资源（统一入口）
 * @param {string} platform - 平台 ID
 * @param {string} url - 资源链接
 * @param {string} resourceId - 资源 ID
 * @param {string} tempPath - 临时目录
 * @param {object} context - 上下文，可包含 maxCount 等参数
 * @returns {Promise<{filePath: string, platform: string, extra?: object}>}
 */
async function downloadResource(platform, url, resourceId, tempPath, context = {}) {
    const downloader = getDownloader(platform);
    console.log(`[下载器] 使用 ${platform} 下载器`);
    return await downloader.download(url, resourceId, tempPath, context);
}

/**
 * 提取资源 ID（统一入口）
 * @param {string} platform - 平台 ID
 * @param {string} url - 资源链接
 * @returns {string|null}
 */
function extractResourceId(platform, url) {
    try {
        const downloader = getDownloader(platform);
        return downloader.extractResourceId(url);
    } catch (e) {
        return null;
    }
}

/**
 * 获取支持的平台列表
 * @returns {string[]}
 */
function getSupportedPlatforms() {
    return Array.from(downloaders.keys());
}

/**
 * 识别平台（从 URL）
 * @param {string} url - 资源链接
 * @returns {string} 平台 ID
 */
function identifyPlatform(url) {
    const hostname = new URL(url).hostname.toLowerCase();

    if (hostname.includes('zhihu')) return 'zhihu';
    if (hostname.includes('xiaohongshu')) return 'xiaohongshu';
    if (hostname.includes('bilibili')) return 'bilibili';
    if (hostname.includes('weibo')) return 'weibo';
    if (hostname.includes('douyin')) return 'douyin';
    if (hostname.includes('youtube')) return 'youtube';

    // 检查是否是直接文件链接
    const ext = url.split('?')[0].split('.').pop()?.toLowerCase();
    const fileExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'webm', 'mp3', 'wav', 'm4a'];
    if (fileExts.includes(ext)) return 'url';

    // 默认使用通用下载器
    return 'generic';
}

/**
 * 初始化所有下载器
 */
function initDownloaders() {
    // 注册知乎下载器
    registerDownloader('zhihu', ZhihuDownloader);
    registerDownloader('知乎', ZhihuDownloader);

    // 注册 URL 下载器
    registerDownloader('url', UrlDownloader);
    registerDownloader('direct', UrlDownloader);
    registerDownloader('generic', UrlDownloader);

    // 注册通用下载器
    registerDownloader('web', GenericDownloader);
    registerDownloader('playwright', GenericDownloader);

    console.log(`[下载器] 已加载 ${downloaders.size} 个下载器`);
    console.log(`[下载器] 支持的平台：${getSupportedPlatforms().join(', ')}`);
}

module.exports = {
    registerDownloader,
    getDownloader,
    downloadResource,
    extractResourceId,
    getSupportedPlatforms,
    identifyPlatform,
    initDownloaders
};
