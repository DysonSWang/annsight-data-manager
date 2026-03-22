/**
 * 音频/视频提取器
 * 通过 Whisper 进行语音转文字
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class AudioExtractor {
    /**
     * 支持的 MIME 类型
     */
    static get supportedTypes() {
        return ['video/mp4', 'video/quicktime', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/webm'];
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
            return ['mp4', 'mov', 'webm', 'mp3', 'wav', 'm4a', 'aac', 'flac'].includes(ext);
        }
        return false;
    }

    /**
     * 提取音频/视频内容的转录文本
     * @param {string} filePath - 文件路径
     * @param {object} options - 配置选项
     * @returns {Promise<{text: string, metadata: object}>}
     */
    async extract(filePath, options = {}) {
        console.log(`[音频提取器] 提取文件：${filePath}`);

        const ext = filePath.split('.').pop().toLowerCase();
        const isVideo = ['mp4', 'mov', 'webm'].includes(ext);

        // 获取文件信息
        const fileInfo = await this.getFileInfo(filePath);

        // 调用 Whisper API 进行转录
        const transcript = await this.transcribeWithWhisper(filePath, options);

        return {
            text: transcript,
            metadata: {
                format: isVideo ? 'video_transcript' : 'audio_transcript',
                sourceType: isVideo ? 'video' : 'audio',
                duration: fileInfo.duration,
                fileSize: fileInfo.size,
                whisperModel: options.model || 'base'
            }
        };
    }

    /**
     * 获取文件信息（时长、大小等）
     */
    async getFileInfo(filePath) {
        const stats = fs.statSync(filePath);

        try {
            // 使用 ffprobe 获取时长
            const ffprobe = spawn('ffprobe', [
                '-v', 'quiet',
                '-print_format', 'json',
                '-show_format',
                filePath
            ]);

            return new Promise((resolve) => {
                let output = '';

                ffprobe.stdout.on('data', (data) => {
                    output += data.toString();
                });

                ffprobe.on('close', (code) => {
                    if (code === 0 && output) {
                        try {
                            const info = JSON.parse(output);
                            resolve({
                                size: stats.size,
                                duration: parseFloat(info.format.duration) || 0,
                                bitRate: info.format.bit_rate
                            });
                        } catch (e) {
                            resolve({ size: stats.size, duration: 0 });
                        }
                    } else {
                        resolve({ size: stats.size, duration: 0 });
                    }
                });
            });
        } catch (e) {
            return { size: stats.size, duration: 0 };
        }
    }

    /**
     * 使用 Whisper 转录
     */
    async transcribeWithWhisper(filePath, options = {}) {
        const {
            model = 'base',
            language = 'zh',
            device = 'cpu'
        } = options;

        // 检查是否配置了 Whisper API
        const whisperApiKey = process.env.WHISPER_API_KEY;
        const whisperApiUrl = process.env.WHISPER_API_URL || 'http://localhost:8000/v1/audio/transcriptions';

        if (whisperApiKey || process.env.OPENCLAW_WHISPER_URL) {
            // 使用 API 方式调用 Whisper
            return await this.transcribeWithWhisperApi(filePath, {
                url: process.env.OPENCLAW_WHISPER_URL || whisperApiUrl,
                token: whisperApiKey || process.env.OPENCLAW_WHISPER_TOKEN,
                model
            });
        }

        // 使用本地 whisper 命令行
        return await this.transcribeWithWhisperCli(filePath, { model, language, device });
    }

    /**
     * 使用 Whisper API 转录
     */
    async transcribeWithWhisperApi(filePath, config) {
        const FormData = require('form-data');
        const axios = require('axios');

        const form = new FormData();
        form.append('file', fs.createReadStream(filePath));
        form.append('model', config.model || 'whisper-1');
        form.append('language', 'zh');
        form.append('response_format', 'text');

        console.log(`[音频提取器] 调用 Whisper API: ${config.url}`);

        try {
            const response = await axios.post(config.url, form, {
                headers: {
                    ...form.getHeaders(),
                    'Authorization': `Bearer ${config.token}`
                },
                timeout: 300000 // 5 分钟超时
            });

            // 处理不同的响应格式
            let transcript = '';
            if (typeof response.data === 'string') {
                transcript = response.data;
            } else if (response.data.text) {
                transcript = response.data.text;
            } else if (response.data.transcript) {
                transcript = response.data.transcript;
            } else {
                transcript = JSON.stringify(response.data);
            }

            return transcript.trim();
        } catch (error) {
            console.error('[音频提取器] Whisper API 调用失败:', error.message);
            throw new Error(`Whisper API 调用失败：${error.message}`);
        }
    }

    /**
     * 使用 Whisper CLI 转录
     */
    async transcribeWithWhisperCli(filePath, options) {
        return new Promise((resolve, reject) => {
            const args = [
                '--model', options.model,
                '--language', options.language,
                '--output_format', 'txt',
                filePath
            ];

            if (options.device === 'cuda') {
                args.push('--device', 'cuda');
            }

            const whisper = spawn('whisper', args);

            let output = '';
            let error = '';

            whisper.stdout.on('data', (data) => {
                output += data.toString();
            });

            whisper.stderr.on('data', (data) => {
                error += data.toString();
                console.log(`[whisper] ${data.toString()}`);
            });

            whisper.on('close', (code) => {
                if (code === 0) {
                    // 读取输出的 txt 文件
                    const txtPath = filePath.replace(/\.[^.]+$/, '.txt');
                    if (fs.existsSync(txtPath)) {
                        const content = fs.readFileSync(txtPath, 'utf-8');
                        fs.unlinkSync(txtPath); // 清理临时文件
                        resolve(content.trim());
                    } else {
                        resolve(output.trim());
                    }
                } else {
                    reject(new Error(`Whisper 转录失败：${error}`));
                }
            });

            whisper.on('error', reject);
        });
    }
}

module.exports = { AudioExtractor };
