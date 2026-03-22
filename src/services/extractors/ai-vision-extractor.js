/**
 * AI 视觉图片提取器
 * 使用 AI 视觉模型进行图片内容识别（支持 OCR 和场景理解）
 *
 * 支持三种模式：
 * 1. OCR 模式 - 提取图片中的文字
 * 2. 视觉理解模式 - 理解图片内容和场景
 * 3. 混合模式 - OCR + 视觉理解
 */

const fs = require('fs');
const path = require('path');

class AIVisionExtractor {
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
     * 提取图片内容
     * @param {string} filePath - 文件路径
     * @param {object} options - 配置选项
     * @param {'ocr' | 'vision' | 'hybrid'} options.mode - 识别模式
     * @param {string} options.prompt - 自定义提示词（视觉模式）
     * @returns {Promise<{text: string, metadata: object}>}
     */
    async extract(filePath, options = {}) {
        console.log(`[AI 视觉提取器] 提取文件：${filePath}`);

        const {
            mode = 'hybrid',  // ocr, vision, hybrid
            prompt,
            language = 'zh'
        } = options;

        const stats = fs.statSync(filePath);
        const ext = filePath.split('.').pop().toLowerCase();

        // 检查文件是否有效
        if (!fs.existsSync(filePath)) {
            throw new Error(`文件不存在：${filePath}`);
        }

        // 检查是否是有效的图片文件
        const validExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
        if (!validExts.includes(ext)) {
            throw new Error(`不支持的图片格式：${ext}`);
        }

        let ocrText = '';
        let visionText = '';

        // OCR 模式或混合模式
        if (mode === 'ocr' || mode === 'hybrid') {
            console.log('[AI 视觉提取器] 执行 OCR 识别...');
            ocrText = await this.performOCR(filePath, language);
        }

        // 视觉理解模式或混合模式
        if (mode === 'vision' || mode === 'hybrid') {
            console.log('[AI 视觉提取器] 执行视觉理解...');
            visionText = await this.performVision(filePath, prompt, language);
        }

        // 合并结果
        const text = [ocrText, visionText].filter(t => t?.trim()).join('\n\n');

        return {
            text: text.trim(),
            metadata: {
                format: mode === 'hybrid' ? 'ai_vision_ocr' : (mode === 'ocr' ? 'ocr' : 'ai_vision'),
                sourceType: 'image',
                imageType: ext,
                fileSize: stats.size,
                mode,
                ocrLength: ocrText?.length || 0,
                visionLength: visionText?.length || 0
            }
        };
    }

    /**
     * 执行 OCR 识别
     * 使用 Tesseract.js 或阿里云 OCR
     */
    async performOCR(filePath, language = 'zh') {
        const ocrEngine = process.env.OCR_ENGINE || 'tesseract';

        if (ocrEngine === 'aliyun') {
            return await this.ocrWithAliyun(filePath);
        } else {
            return await this.ocrWithTesseract(filePath, language);
        }
    }

    /**
     * 使用 Tesseract.js 进行 OCR
     */
    async ocrWithTesseract(filePath, language = 'zh') {
        try {
            const Tesseract = require('tesseract.js');

            const { data } = await Tesseract.recognize(filePath, language === 'zh' ? 'chi_sim+eng' : 'eng', {
                logger: (m) => {
                    if (m.status === 'recognizing text') {
                        console.log(`  [Tesseract] OCR 进度：${(m.progress * 100).toFixed(0)}%`);
                    }
                }
            });

            return data.text;
        } catch (error) {
            console.error('[AI 视觉提取器] Tesseract OCR 失败:', error.message);
            return '';
        }
    }

    /**
     * 使用阿里云 OCR
     */
    async ocrWithAliyun(filePath) {
        try {
            // 简化实现，详细实现见 image-extractor.js
            const imageContent = fs.readFileSync(filePath);
            const imageBase64 = imageContent.toString('base64');

            // 调用阿里云 OCR API
            // ... (实现略，参考 image-extractor.js)

            return ''; // 占位
        } catch (error) {
            console.error('[AI 视觉提取器] 阿里云 OCR 失败:', error.message);
            return '';
        }
    }

    /**
     * 执行视觉理解
     * 使用 AI 视觉模型理解图片内容
     */
    async performVision(filePath, customPrompt, language = 'zh') {
        // 检查是否配置了视觉 API
        const visionApiUrl = process.env.VISION_API_URL || process.env.OPENCLAW_VISION_URL;
        const visionToken = process.env.VISION_API_TOKEN || process.env.OPENCLAW_VISION_TOKEN;

        if (visionApiUrl && visionToken) {
            return await this.visionWithApi(filePath, customPrompt, visionApiUrl, visionToken);
        }

        // 如果没有配置 API，返回空字符串
        console.log('[AI 视觉提取器] 未配置视觉 API，跳过视觉理解');
        return '';
    }

    /**
     * 使用视觉 API 进行理解
     */
    async visionWithApi(filePath, customPrompt, apiUrl, token) {
        const axios = require('axios');
        const FormData = require('form-data');

        const imageContent = fs.readFileSync(filePath);

        const form = new FormData();
        form.append('image', imageContent);
        form.append('prompt', customPrompt || '请详细描述这张图片的内容，包括其中的文字信息、场景、人物、物体等。如果图片中有文字，请完整提取出来。');
        form.append('language', 'zh');

        try {
            console.log(`[AI 视觉提取器] 调用视觉 API: ${apiUrl}`);

            const response = await axios.post(apiUrl, form, {
                headers: {
                    ...form.getHeaders(),
                    'Authorization': `Bearer ${token}`
                },
                timeout: 120000 // 2 分钟超时
            });

            // 处理响应
            let description = '';
            if (typeof response.data === 'string') {
                description = response.data;
            } else if (response.data.description) {
                description = response.data.description;
            } else if (response.data.text) {
                description = response.data.text;
            } else if (response.data.content) {
                description = response.data.content;
            } else {
                description = JSON.stringify(response.data);
            }

            return description.trim();
        } catch (error) {
            console.error('[AI 视觉提取器] 视觉 API 调用失败:', error.message);
            return '';
        }
    }

    /**
     * 使用 Claude 视觉模型（备选方案）
     * 需要配置 ANTHROPIC_API_KEY
     */
    async visionWithClaude(filePath, customPrompt) {
        try {
            const axios = require('axios');
            const Anthropic = require('@anthropic-ai/sdk');

            const apiKey = process.env.ANTHROPIC_API_KEY;
            if (!apiKey) {
                console.log('[AI 视觉提取器] 未配置 ANTHROPIC_API_KEY');
                return '';
            }

            const anthropic = new Anthropic({ apiKey });
            const imageContent = fs.readFileSync(filePath);
            const imageBase64 = imageContent.toString('base64');
            const mimeType = this.getMimeType(filePath);

            const response = await anthropic.messages.create({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 2048,
                messages: [{
                    role: 'user',
                    content: [
                        {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: mimeType,
                                data: imageBase64
                            }
                        },
                        {
                            type: 'text',
                            text: customPrompt || '请详细描述这张图片的内容，包括其中的文字信息。如果图片中有文字，请完整提取出来。'
                        }
                    ]
                }]
            });

            return response.content[0]?.text || '';
        } catch (error) {
            console.error('[AI 视觉提取器] Claude 视觉模型调用失败:', error.message);
            return '';
        }
    }

    /**
     * 获取 MIME 类型
     */
    getMimeType(filePath) {
        const ext = filePath.split('.').pop().toLowerCase();
        const mimeMap = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'bmp': 'image/bmp'
        };
        return mimeMap[ext] || 'application/octet-stream';
    }
}

module.exports = { AIVisionExtractor };
