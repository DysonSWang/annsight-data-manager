/**
 * 阿里云 OSS 存储服务
 */

const fs = require('fs');
const path = require('path');

// 动态导入 ali-oss
let OSS = null;
try {
    OSS = require('ali-oss');
} catch (e) {
    console.log('[OSS] ali-oss 模块未安装，OSS 功能将不可用');
}

class OSSService {
    constructor() {
        this.client = null;
        this.config = {
            region: process.env.OSS_REGION || 'oss-cn-hangzhou',
            bucket: process.env.OSS_BUCKET || 'xiaohongshu-videos',
            accessKeyId: process.env.OSS_ACCESS_KEY_ID,
            accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET
        };

        this.init();
    }

    init() {
        if (!OSS) {
            console.log('[OSS] 跳过初始化（模块未安装）');
            return;
        }

        const { region, bucket, accessKeyId, accessKeySecret } = this.config;

        if (!accessKeyId || !accessKeySecret) {
            console.log('[OSS] 跳过初始化（凭证未配置）');
            return;
        }

        try {
            this.client = new OSS({
                region,
                bucket,
                accessKeyId,
                accessKeySecret
            });
            console.log('[OSS] 初始化成功');
        } catch (error) {
            console.error('[OSS] 初始化失败:', error.message);
        }
    }

    /**
     * 获取视频文件 OSS 路径
     */
    getVideoPath(videoId) {
        return `videos/${videoId}/${videoId}_视频.mp4`;
    }

    /**
     * 获取音频文件 OSS 路径
     */
    getAudioPath(videoId) {
        return `audios/${videoId}/${videoId}_音频.wav`;
    }

    /**
     * 获取转录文本 OSS 路径
     */
    getTranscriptPath(videoId) {
        return `transcripts/${videoId}/${videoId}_转录.json`;
    }

    /**
     * 获取报告 OSS 路径（通用，已废弃，保留向后兼容）
     */
    getReportPath(videoId) {
        return `reports/${videoId}/${videoId}_报告.md`;
    }

    /**
     * 获取文本分析报告 OSS 路径
     */
    getTextReportPath(videoId) {
        return `reports/${videoId}/${videoId}_文本分析报告.md`;
    }

    /**
     * 获取视觉分析报告 OSS 路径
     */
    getVisionReportPath(videoId) {
        return `reports/${videoId}/${videoId}_视觉分析报告.md`;
    }

    /**
     * 上传文件到 OSS
     * @param {string} localPath - 本地文件路径
     * @param {string} ossPath - OSS 路径
     * @returns {Promise<object>} 上传结果
     */
    async uploadFile(localPath, ossPath) {
        if (!this.client) {
            throw new Error('OSS 客户端未初始化');
        }

        if (!fs.existsSync(localPath)) {
            throw new Error(`文件不存在：${localPath}`);
        }

        const result = await this.client.put(ossPath, localPath);
        return result;
    }

    /**
     * 从 OSS 下载文件
     * @param {string} ossPath - OSS 路径
     * @param {string} localPath - 本地文件路径
     * @returns {Promise<void>}
     */
    async downloadFile(ossPath, localPath) {
        if (!this.client) {
            throw new Error('OSS 客户端未初始化');
        }

        const result = await this.client.get(ossPath);
        const dir = path.dirname(localPath);
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(localPath, result.content);
    }

    /**
     * 获取文件内容
     * @param {string} ossPath - OSS 路径
     * @returns {Promise<Buffer>}
     */
    async getFileContent(ossPath) {
        if (!this.client) {
            throw new Error('OSS 客户端未初始化');
        }

        const result = await this.client.get(ossPath);
        return result.content;
    }

    /**
     * 获取签名 URL
     * @param {string} ossPath - OSS 路径
     * @param {number} expires - 过期时间（秒）
     * @returns {string} 签名 URL
     */
    signatureUrl(ossPath, expires = 3600) {
        if (!this.client) {
            return null;
        }

        return this.client.signatureUrl(ossPath, { expires });
    }

    /**
     * 删除文件
     * @param {string} ossPath - OSS 路径
     * @returns {Promise<void>}
     */
    async deleteFile(ossPath) {
        if (!this.client) {
            throw new Error('OSS 客户端未初始化');
        }

        await this.client.delete(ossPath);
    }

    /**
     * 检查文件是否存在
     * @param {string} ossPath - OSS 路径
     * @returns {Promise<boolean>}
     */
    async exists(ossPath) {
        if (!this.client) {
            return false;
        }

        try {
            await this.client.head(ossPath);
            return true;
        } catch (e) {
            return false;
        }
    }
}

// 单例
let instance = null;
function getOSSService() {
    if (!instance) {
        instance = new OSSService();
    }
    return instance;
}

module.exports = {
    OSSService,
    getOSSService
};
