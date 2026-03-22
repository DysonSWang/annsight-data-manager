/**
 * 图片 OCR 提取器
 * 使用 Tesseract.js 或阿里云 OCR 进行文字识别
 */

const fs = require('fs');

class ImageExtractor {
    /**
     * 支持的 MIME 类型
     */
    static get supportedTypes() {
        return ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
    }

    /**
     * 检测是否支持此文件类型
     */
    static supports(contentType, filePath = '') {
        if (contentType && this.supportedTypes.includes(contentType)) {
            return true;
        }
        if (filePath) {
            const ext = filePath.split('.').pop().toLowerCase();
            return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext);
        }
        return false;
    }

    /**
     * 提取图片中的文字（OCR）
     * @param {string} filePath - 文件路径
     * @param {object} options - 配置选项
     * @returns {Promise<{text: string, metadata: object}>}
     */
    async extract(filePath, options = {}) {
        console.log(`[图片提取器] 提取文件：${filePath}`);

        // 获取文件信息
        const stats = fs.statSync(filePath);
        const ext = filePath.split('.').pop().toLowerCase();

        // 根据配置选择 OCR 引擎
        const engine = options.engine || process.env.OCR_ENGINE || 'tesseract';

        let text = '';
        let ocrResult = {};

        if (engine === 'aliyun') {
            const result = await this.ocrWithAliyun(filePath, options);
            text = result.text;
            ocrResult = result.extra;
        } else {
            const result = await this.ocrWithTesseract(filePath, options);
            text = result.text;
            ocrResult = result.extra;
        }

        return {
            text: text.trim(),
            metadata: {
                format: 'ocr',
                sourceType: 'image',
                imageType: ext,
                fileSize: stats.size,
                ocrEngine: engine,
                ...ocrResult
            }
        };
    }

    /**
     * 使用 Tesseract.js 进行 OCR
     */
    async ocrWithTesseract(filePath, options = {}) {
        try {
            const Tesseract = require('tesseract.js');
            const { logger } = options;

            console.log('[图片提取器] 使用 Tesseract.js 进行 OCR');

            const { data } = await Tesseract.recognize(filePath, 'chi_sim+eng', {
                logger: logger || ((m) => {
                    if (m.status === 'recognizing text') {
                        console.log(`[Tesseract] 进度：${(m.progress * 100).toFixed(0)}%`);
                    }
                })
            });

            return {
                text: data.text,
                extra: {
                    confidence: data.confidence,
                    words: data.words?.length || 0,
                    lines: data.lines?.length || 0
                }
            };

        } catch (error) {
            console.error('[图片提取器] Tesseract OCR 失败:', error.message);
            throw new Error(`Tesseract OCR 失败：${error.message}`);
        }
    }

    /**
     * 使用阿里云 OCR 进行识别
     */
    async ocrWithAliyun(filePath, options = {}) {
        const axios = require('axios');
        const crypto = require('crypto');

        const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID;
        const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET;

        if (!accessKeyId || !accessKeySecret) {
            throw new Error('阿里云 OCR 未配置：缺少 ALIYUN_ACCESS_KEY_ID 或 ALIYUN_ACCESS_KEY_SECRET');
        }

        // 阿里云 OCR API 端点
        const endpoint = 'ocr.cn-shanghai.aliyuncs.com';
        const action = 'RecognizeText';
        const version = '2021-07-07';

        // 读取图片文件
        const imageContent = fs.readFileSync(filePath);
        const imageBase64 = imageContent.toString('base64');

        // 构建请求参数
        const params = {
            Action: action,
            Version: version,
            Timestamp: new Date().toISOString(),
            AccessKeyId: accessKeyId,
            Format: 'JSON',
            SignatureMethod: 'HMAC-SHA1',
            SignatureVersion: '1.0',
            SignatureNonce: crypto.randomUUID(),
            RegionId: 'cn-shanghai',
            ImageURL: '' // 使用 ImageBody 传递 base64
        };

        // 简单调用：使用通用 OCR 接口
        // 注意：阿里云 OCR 的签名算法较复杂，这里使用简化版本
        // 实际使用时建议引入 @alicloud/pop-core 库

        try {
            // 使用阿里云 SDK（如果已安装）
            try {
                const OCRClient = require('@alicloud/ocr20210707').default;
                const $OpenApi = require('@alicloud/openapi-client');

                const config = new $OpenApi.Config({
                    accessKeyId,
                    accessKeySecret,
                    endpoint
                });

                const client = new OCRClient.default(config);

                const request = new (require('@alicloud/ocr20210707').RecognizeTextRequest)({
                    imageBody: imageContent
                });

                const response = await client.recognizeText(request);

                return {
                    text: response.body.data.text || '',
                    extra: {
                        confidence: response.body.data.confidence || 0,
                        blocks: response.body.data.blocks?.length || 0
                    }
                };

            } catch (sdkError) {
                // SDK 不可用，使用简单 HTTP 调用
                console.log('[图片提取器] 使用 HTTP 方式调用阿里云 OCR');

                // 构建签名字符串
                const sortedParams = Object.keys(params).sort().reduce((obj, key) => {
                    obj[key] = params[key];
                    return obj;
                }, {});

                const canonicalizedQueryString = Object.entries(sortedParams)
                    .map(([k, v]) => `${this.percentEncode(k)}=${this.percentEncode(v)}`)
                    .join('&');

                const stringToSign = `POST&%2F&${this.percentEncode(canonicalizedQueryString)}`;
                const signature = crypto
                    .createHmac('sha1', `${accessKeySecret}&`)
                    .update(stringToSign)
                    .digest('base64');

                const url = `https://${endpoint}/?${canonicalizedQueryString}&Signature=${this.percentEncode(signature)}`;

                const response = await axios.post(url, imageContent, {
                    headers: {
                        'Content-Type': 'application/octet-stream'
                    },
                    timeout: 30000
                });

                return {
                    text: response.data?.data?.text || '',
                    extra: {
                        confidence: response.data?.data?.confidence || 0
                    }
                };
            }

        } catch (error) {
            console.error('[图片提取器] 阿里云 OCR 失败:', error.message);
            throw new Error(`阿里云 OCR 失败：${error.message}`);
        }
    }

    /**
     * URL 编码
     */
    percentEncode(str) {
        return encodeURIComponent(str)
            .replace(/\+/g, '%20')
            .replace(/\*/g, '%2A')
            .replace(/%7E/g, '~');
    }
}

module.exports = { ImageExtractor };
