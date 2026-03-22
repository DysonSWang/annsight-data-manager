/**
 * 通用 URL 下载器
 * 支持直接文件链接下载（图片、音频、视频等）
 */

const { BaseDownloader } = require('./base');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

class UrlDownloader extends BaseDownloader {
    /**
     * 获取支持的平台列表
     */
    static getSupportedPlatforms() {
        return ['url', 'direct', 'generic'];
    }

    /**
     * 从 URL 提取资源 ID（使用 URL 最后一段或 MD5）
     */
    extractResourceId(url) {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const lastSegment = pathname.split('/').filter(Boolean).pop();

            if (lastSegment) {
                // 移除查询参数
                return lastSegment.split('?')[0];
            }

            // 如果没有有效路径段，使用 URL 的 MD5
            const crypto = require('crypto');
            return crypto.createHash('md5').update(url).digest('hex').slice(0, 16);
        } catch (e) {
            return null;
        }
    }

    /**
     * 下载文件
     */
    async download(url, resourceId, tempPath) {
        console.log(`[URL 下载器] 开始下载：${url}`);
        console.log(`[URL 下载器] 输出目录：${tempPath}`);

        if (!resourceId) {
            resourceId = this.extractResourceId(url);
        }

        // 创建临时目录
        await fs.promises.mkdir(tempPath, { recursive: true });

        try {
            // 获取文件扩展名
            const ext = this.getFileExtension(url);

            // 确定文件类型
            const contentType = this.guessContentType(url, ext);
            let fileType = 'file';
            if (contentType.startsWith('image/')) fileType = 'image';
            else if (contentType.startsWith('video/')) fileType = 'video';
            else if (contentType.startsWith('audio/')) fileType = 'audio';

            const filePath = path.join(tempPath, `${resourceId}_${fileType}${ext}`);

            // 下载文件
            const response = await axios({
                method: 'GET',
                url: url,
                responseType: 'stream',
                timeout: 60000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });

            const writer = fs.createWriteStream(filePath);
            let downloadedBytes = 0;

            response.data.on('data', (chunk) => {
                downloadedBytes += chunk.length;
            });

            response.data.pipe(writer);

            return new Promise((resolve, reject) => {
                writer.on('finish', () => {
                    console.log(`[URL 下载器] 下载完成：${filePath} (${downloadedBytes} bytes)`);
                    resolve({
                        filePath,
                        platform: 'url',
                        extra: {
                            originalUrl: url,
                            fileSize: downloadedBytes,
                            contentType,
                            fileType
                        }
                    });
                });

                writer.on('error', reject);
            });

        } catch (error) {
            console.error('[URL 下载器] 下载失败:', error.message);
            throw new Error(`URL 下载失败：${error.message}`);
        }
    }

    /**
     * 从 URL 获取文件扩展名
     */
    getFileExtension(url) {
        try {
            const pathname = new URL(url).pathname;
            const ext = path.extname(pathname);
            if (ext) return ext.toLowerCase();
        } catch (e) {}

        // 默认扩展名
        return '.file';
    }

    /**
     * 猜测 Content-Type
     */
    guessContentType(url, ext) {
        const mimeMap = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.mp4': 'video/mp4',
            '.mov': 'video/quicktime',
            '.webm': 'video/webm',
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.m4a': 'audio/mp4',
            '.pdf': 'application/pdf',
            '.txt': 'text/plain'
        };

        return mimeMap[ext] || 'application/octet-stream';
    }

    /**
     * 获取额外信息
     */
    async fetchExtraInfo(url) {
        try {
            // 发送 HEAD 请求获取文件信息
            const response = await axios.head(url, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            return {
                contentLength: parseInt(response.headers['content-length']) || 0,
                contentType: response.headers['content-type'],
                lastModified: response.headers['last-modified']
            };
        } catch (e) {
            return {};
        }
    }
}

module.exports = { UrlDownloader };
