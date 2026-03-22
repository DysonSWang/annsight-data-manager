/**
 * 下载器基类
 * 定义所有平台下载器的标准接口
 */

class BaseDownloader {
    /**
     * 获取支持的平台列表
     * @returns {string[]} 平台 ID 列表
     */
    static getSupportedPlatforms() {
        throw new Error('必须实现 getSupportedPlatforms 方法');
    }

    /**
     * 从 URL 提取资源 ID
     * @param {string} url - 资源链接
     * @returns {string|null} 资源 ID，无法提取时返回 null
     */
    extractResourceId(url) {
        throw new Error('必须实现 extractResourceId 方法');
    }

    /**
     * 下载资源
     * @param {string} url - 资源链接
     * @param {string} resourceId - 资源 ID
     * @param {string} tempPath - 临时目录路径
     * @returns {Promise<{filePath: string, extra?: object}>} 下载结果
     */
    async download(url, resourceId, tempPath) {
        throw new Error('必须实现 download 方法');
    }

    /**
     * 获取额外信息（如标题、封面等）
     * @param {string} url - 资源链接
     * @returns {Promise<object>} 额外信息
     */
    async fetchExtraInfo(url) {
        return {};
    }
}

module.exports = { BaseDownloader };
