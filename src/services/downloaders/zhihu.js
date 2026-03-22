/**
 * 知乎下载器
 * 支持知乎视频和文章下载
 */

const { BaseDownloader } = require('./base');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class ZhihuDownloader extends BaseDownloader {
    /**
     * 获取支持的平台列表
     */
    static getSupportedPlatforms() {
        return ['zhihu', '知乎'];
    }

    /**
     * 从 URL 提取资源 ID
     * - 视频：https://www.zhihu.com/zvideo/123456
     * - 文章：https://zhuanlan.zhihu.com/p/123456
     */
    extractResourceId(url) {
        // 知乎视频
        const videoMatch = url.match(/zvideo\/(\d+)/);
        if (videoMatch) {
            return `zvideo-${videoMatch[1]}`;
        }

        // 知乎文章
        const articleMatch = url.match(/\/p\/(\d+)/);
        if (articleMatch) {
            return `article-${articleMatch[1]}`;
        }

        // 知乎问题
        const questionMatch = url.match(/\/question\/(\d+)/);
        if (questionMatch) {
            return `question-${questionMatch[1]}`;
        }

        return null;
    }

    /**
     * 下载知乎内容
     */
    async download(url, resourceId, tempPath) {
        console.log(`[知乎下载器] 开始下载：${resourceId}`);
        console.log(`[知乎下载器] URL: ${url}`);
        console.log(`[知乎下载器] 输出目录：${tempPath}`);

        if (!resourceId) {
            resourceId = this.extractResourceId(url);
        }

        if (!resourceId) {
            throw new Error('无法从 URL 提取资源 ID');
        }

        // 创建临时目录
        await fs.promises.mkdir(tempPath, { recursive: true });

        // 判断是视频还是文章
        const isVideo = url.includes('zvideo') || url.includes('video');

        if (isVideo) {
            // 使用 yt-dlp 下载知乎视频
            return await this.downloadVideo(url, resourceId, tempPath);
        } else {
            // 使用 playwright 抓取文章内容
            return await this.downloadArticle(url, resourceId, tempPath);
        }
    }

    /**
     * 下载知乎视频
     */
    async downloadVideo(url, resourceId, tempPath) {
        return new Promise((resolve, reject) => {
            const videoPath = path.join(tempPath, `${resourceId}_视频.mp4`);
            const metadataPath = path.join(tempPath, 'video_metadata.json');

            // 使用 yt-dlp 下载
            const args = [
                '-o', videoPath,
                '--write-info-json',
                '--print-json',
                url
            ];

            const child = spawn('yt-dlp', args, {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data) => {
                stderr += data.toString();
                console.log(`[yt-dlp] ${data.toString()}`);
            });

            child.on('close', (code) => {
                if (code === 0 || fs.existsSync(videoPath)) {
                    // 尝试读取 metadata
                    let extra = {};
                    if (fs.existsSync(videoPath.replace('.mp4', '.info.json'))) {
                        try {
                            const meta = JSON.parse(fs.readFileSync(videoPath.replace('.mp4', '.info.json'), 'utf-8'));
                            extra = {
                                title: meta.title,
                                description: meta.description,
                                duration: meta.duration,
                                uploader: meta.uploader
                            };
                            // 保存 metadata
                            fs.writeFileSync(metadataPath, JSON.stringify(extra, null, 2));
                        } catch (e) {
                            console.log('[知乎下载器] 读取 metadata 失败:', e.message);
                        }
                    }

                    resolve({
                        videoPath,
                        platform: 'zhihu',
                        extra
                    });
                } else {
                    reject(new Error(`yt-dlp 下载失败：${stderr}`));
                }
            });

            child.on('error', reject);
        });
    }

    /**
     * 下载知乎文章
     */
    async downloadArticle(url, resourceId, tempPath) {
        const articlePath = path.join(tempPath, `${resourceId}_文章.md`);
        const metadataPath = path.join(tempPath, 'article_metadata.json');

        // 使用 playwright 抓取
        const { chromium } = require('playwright');

        const browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();

        try {
            await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

            // 提取文章标题
            const title = await page.$eval('h1.Post-Title', el => el.innerText.trim()).catch(() => '未知标题');

            // 提取文章内容
            const content = await page.$eval('.Post-RichTextContainer, .RichText', el => el.innerText).catch(() => '');

            // 提取作者
            const author = await page.$eval('.AuthorInfo-name', el => el.innerText.trim()).catch(() => '匿名用户');

            // 提取发布时间
            const publishTime = await page.$eval('meta[property="article:published_time"]', el => el.getAttribute('content')).catch(() => '');

            // 保存为 Markdown
            const markdown = `# ${title}\n\n**作者**: ${author}\n**发布时间**: ${publishTime}\n**来源**: ${url}\n\n---\n\n${content}`;

            await fs.promises.writeFile(articlePath, markdown, 'utf-8');

            // 保存 metadata
            const metadata = {
                title,
                author,
                publishTime,
                url,
                platform: 'zhihu',
                contentType: 'article'
            };
            await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

            return {
                filePath: articlePath,
                platform: 'zhihu',
                extra: metadata
            };

        } finally {
            await browser.close();
        }
    }

    /**
     * 获取额外信息
     */
    async fetchExtraInfo(url) {
        const resourceId = this.extractResourceId(url);
        if (!resourceId) return {};

        return {
            resourceId,
            platform: 'zhihu'
        };
    }
}

module.exports = { ZhihuDownloader };
