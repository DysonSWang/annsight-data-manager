/**
 * 通用网页下载器（Playwright）
 * 用于抓取无法通过简单下载获取的网页内容
 */

const { BaseDownloader } = require('./base');
const fs = require('fs');
const path = require('path');

class GenericDownloader extends BaseDownloader {
    /**
     * 获取支持的平台列表
     */
    static getSupportedPlatforms() {
        return ['generic', 'web', 'playwright'];
    }

    /**
     * 从 URL 提取资源 ID
     */
    extractResourceId(url) {
        try {
            const urlObj = new URL(url);
            // 使用 hostname + pathname 的组合作为 ID
            const hostname = urlObj.hostname.replace('www.', '');
            const pathname = urlObj.pathname.replace(/\//g, '_').slice(1);
            return `${hostname}_${pathname || 'index'}`.slice(0, 64);
        } catch (e) {
            return null;
        }
    }

    /**
     * 抓取网页内容
     */
    async download(url, resourceId, tempPath) {
        console.log(`[通用下载器] 开始抓取：${url}`);
        console.log(`[通用下载器] 输出目录：${tempPath}`);

        if (!resourceId) {
            resourceId = this.extractResourceId(url);
        }

        // 创建临时目录
        await fs.promises.mkdir(tempPath, { recursive: true });

        const { chromium } = require('playwright');
        const browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();

        try {
            // 设置 viewport
            await page.setViewportSize({ width: 1280, height: 800 });

            // 访问页面
            await page.goto(url, {
                waitUntil: 'networkidle',
                timeout: 30000
            });

            // 提取标题
            const title = await page.$eval('title', el => el.innerText.trim()).catch(() => '未知标题');

            // 提取主要内容
            const content = await this.extractMainContent(page);

            // 提取元数据
            const metadata = await this.extractMetadata(page, url);

            // 保存为 Markdown
            const markdownPath = path.join(tempPath, `${resourceId}.md`);
            const markdown = this.toMarkdown(title, metadata, content);
            await fs.promises.writeFile(markdownPath, markdown, 'utf-8');

            // 保存截图（可选）
            const screenshotPath = path.join(tempPath, `${resourceId}_screenshot.png`);
            await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

            // 保存 metadata
            const metadataPath = path.join(tempPath, `${resourceId}_metadata.json`);
            await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

            return {
                filePath: markdownPath,
                platform: 'generic',
                extra: {
                    ...metadata,
                    screenshotPath
                }
            };

        } finally {
            await browser.close();
        }
    }

    /**
     * 提取网页主要内容
     */
    async extractMainContent(page) {
        // 尝试多种选择器提取主要内容
        const selectors = [
            'article',
            '.post-content',
            '.article-content',
            '.content',
            '.main',
            '#content',
            '.RichText',
            '.post-body'
        ];

        for (const selector of selectors) {
            try {
                const element = await page.$(selector);
                if (element) {
                    return await element.innerText();
                }
            } catch (e) {
                continue;
            }
        }

        // 如果都没找到，返回 body 文本
        try {
            return await page.$eval('body', el => el.innerText);
        } catch (e) {
            return '';
        }
    }

    /**
     * 提取网页元数据
     */
    async extractMetadata(page, url) {
        const metadata = {
            url,
            title: '',
            author: '',
            publishDate: '',
            description: '',
            platform: this.identifyPlatform(url)
        };

        try {
            // 标题
            metadata.title = await page.$eval('title', el => el.innerText.trim()).catch(() => '');

            // 作者
            metadata.author = await page.$eval('[name="author"]', el => el.getAttribute('content')).catch(() =>
                page.$eval('.author, .byline', el => el.innerText.trim()).catch(() => '')
            );

            // 发布时间
            metadata.publishDate = await page.$eval('[name="date"]', el => el.getAttribute('content')).catch(() =>
                page.$eval('[property="article:published_time"]', el => el.getAttribute('content')).catch(() =>
                    page.$eval('time', el => el.dateTime || el.innerText).catch(() => '')
                )
            );

            // 描述
            metadata.description = await page.$eval('[name="description"]', el => el.getAttribute('content')).catch(() => '');

        } catch (e) {
            console.log('[通用下载器] 提取 metadata 部分失败:', e.message);
        }

        return metadata;
    }

    /**
     * 识别平台
     */
    identifyPlatform(url) {
        const hostname = new URL(url).hostname.toLowerCase();

        if (hostname.includes('zhihu')) return 'zhihu';
        if (hostname.includes('xiaohongshu')) return 'xiaohongshu';
        if (hostname.includes('bilibili')) return 'bilibili';
        if (hostname.includes('weibo')) return 'weibo';
        if (hostname.includes('douyin')) return 'douyin';
        if (hostname.includes('youtube')) return 'youtube';

        return 'generic';
    }

    /**
     * 转换为 Markdown 格式
     */
    toMarkdown(title, metadata, content) {
        let md = `# ${title}\n\n`;

        if (metadata.author) md += `**作者**: ${metadata.author}\n`;
        if (metadata.publishDate) md += `**发布时间**: ${metadata.publishDate}\n`;
        if (metadata.url) md += `**来源**: ${metadata.url}\n`;
        if (metadata.platform) md += `**平台**: ${metadata.platform}\n`;

        md += `\n---\n\n${content}`;

        return md;
    }

    /**
     * 获取额外信息
     */
    async fetchExtraInfo(url) {
        return {
            resourceId: this.extractResourceId(url),
            platform: this.identifyPlatform(url)
        };
    }
}

module.exports = { GenericDownloader };
