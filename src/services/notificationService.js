const https = require('https');
const http = require('http');
const logger = require('../utils/logger');

/**
 * 通知服务 - 支持钉钉、飞书 Webhook 通知
 */

class NotificationService {
    constructor() {
        this.enabled = process.env.NOTIFICATION_ENABLED === 'true';
        this.defaultChannel = process.env.NOTIFICATION_CHANNEL || 'dingtalk';

        // 钉钉机器人配置
        this.dingtalkWebhook = process.env.DINGTALK_WEBHOOK_URL;
        this.dingtalkSecret = process.env.DINGTALK_SECRET;

        // 飞书机器人配置
        this.feishuWebhook = process.env.FEISHU_WEBHOOK_URL;
        this.feishuSecret = process.env.FEISHU_SECRET;
    }

    /**
     * 发送 HTTP 请求
     */
    async sendHttpRequest(url, method, body, secret) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const lib = urlObj.protocol === 'https:' ? https : http;

            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: method,
                headers: {
                    'Content-Type': 'application/json; charset=utf-8'
                }
            };

            const req = lib.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);
                        resolve(response);
                    } catch (e) {
                        resolve({ raw: data });
                    }
                });
            });

            req.on('error', reject);
            req.setTimeout(5000);
            req.write(JSON.stringify(body));
            req.end();
        });
    }

    /**
     * 发送钉钉通知
     */
    async sendDingtalk(message) {
        if (!this.dingtalkWebhook) {
            logger.warn('钉钉 Webhook URL 未配置');
            return { success: false, error: 'Webhook URL 未配置' };
        }

        try {
            const payload = {
                msgtype: 'markdown',
                markdown: {
                    title: message.title,
                    text: this.formatDingtalkMarkdown(message)
                },
                at: {
                    isAtAll: message.atAll || false
                }
            };

            const response = await this.sendHttpRequest(
                this.dingtalkWebhook,
                'POST',
                payload
            );

            if (response.errcode === 0) {
                logger.info('钉钉通知发送成功');
                return { success: true };
            } else {
                logger.error('钉钉通知发送失败', response);
                return { success: false, error: response.errmsg || '发送失败' };
            }
        } catch (error) {
            logger.error('钉钉通知发送异常', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 发送飞书通知
     */
    async sendFeishu(message) {
        if (!this.feishuWebhook) {
            logger.warn('飞书 Webhook URL 未配置');
            return { success: false, error: 'Webhook URL 未配置' };
        }

        try {
            const payload = {
                msg_type: 'interactive',
                card: {
                    config: {
                        wide_screen_mode: true
                    },
                    header: {
                        template: message.template || 'blue',
                        title: {
                            tag: 'plain_text',
                            content: message.title
                        }
                    },
                    elements: this.formatFeishuElements(message)
                }
            };

            const response = await this.sendHttpRequest(
                this.feishuWebhook,
                'POST',
                payload
            );

            if (response.StatusCode === 0 || response.code === 0) {
                logger.info('飞书通知发送成功');
                return { success: true };
            } else {
                logger.error('飞书通知发送失败', response);
                return { success: false, error: response.msg || response.message || '发送失败' };
            }
        } catch (error) {
            logger.error('飞书通知发送异常', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 格式化钉钉 Markdown 消息
     */
    formatDingtalkMarkdown(message) {
        let text = `## ${message.title}\n\n`;

        if (message.content) {
            text += `${message.content}\n\n`;
        }

        if (message.details) {
            text += '---\n\n';
            for (const [key, value] of Object.entries(message.details)) {
                text += `**${key}**: ${value}\n`;
            }
            text += '\n';
        }

        if (message.footer) {
            text += `\n> ${message.footer}`;
        }

        if (message.actions && message.actions.length > 0) {
            text += '\n\n';
            for (const action of message.actions) {
                text += `[${action.text}](${action.url})  `;
            }
        }

        return text;
    }

    /**
     * 格式化飞书卡片元素
     */
    formatFeishuElements(message) {
        const elements = [];

        // 内容区域
        if (message.content) {
            elements.push({
                tag: 'div',
                text: {
                    tag: 'lark_md',
                    content: message.content
                }
            });
        }

        // 详细信息
        if (message.details) {
            const detailLines = [];
            for (const [key, value] of Object.entries(message.details)) {
                detailLines.push(`**${key}**: ${value}`);
            }
            elements.push({
                tag: 'div',
                text: {
                    tag: 'lark_md',
                    content: detailLines.join('\n')
                }
            });
        }

        // 操作按钮
        if (message.actions && message.actions.length > 0) {
            elements.push({
                tag: 'action',
                actions: message.actions.map(action => ({
                    tag: 'button',
                    text: {
                        tag: 'plain_text',
                        content: action.text
                    },
                    url: action.url,
                    type: 'default'
                }))
            });
        }

        // 底部信息
        if (message.footer) {
            elements.push({
                tag: 'note',
                elements: [{
                    tag: 'plain_text',
                    content: message.footer
                }]
            });
        }

        return elements;
    }

    /**
     * 发送通知（自动选择渠道）
     */
    async send(message, channel) {
        const targetChannel = channel || this.defaultChannel;

        if (!this.enabled) {
            logger.debug('通知服务未启用，跳过发送', { message, channel: targetChannel });
            return { success: true, skipped: true };
        }

        logger.info('发送通知', { channel: targetChannel, title: message.title });

        switch (targetChannel) {
            case 'dingtalk':
                return this.sendDingtalk(message);
            case 'feishu':
                return this.sendFeishu(message);
            default:
                logger.error('不支持的通知渠道', targetChannel);
                return { success: false, error: '不支持的通知渠道' };
        }
    }

    /**
     * 发送审核完成通知
     */
    async sendReviewComplete(taskInfo, summary) {
        const message = {
            title: '📊 数据审核完成',
            template: 'green',
            content: `**${taskInfo.taskName}** 的 AI 审核流程已完成`,
            details: {
                '总数据量': summary.total,
                '审核通过': `${summary.approved} ✓`,
                '审核失败': `${summary.failed} ✗`,
                '优化次数': summary.optimized,
                '通过率': `${((summary.approved / summary.total) * 100).toFixed(1)}%`
            },
            footer: `完成时间：${new Date().toLocaleString('zh-CN')}`,
            actions: [
                {
                    text: '查看审核结果',
                    url: `${taskInfo.baseUrl}/raw-data-review.html?batch=${taskInfo.batchId}`
                }
            ],
            atAll: taskInfo.notifyAll || false
        };

        return this.send(message);
    }

    /**
     * 发送人工审核待办通知
     */
    async sendManualReviewPending(taskInfo, pendingCount) {
        const message = {
            title: '⏳ 待人工审核',
            template: 'orange',
            content: `**${taskInfo.taskName}** 有 ${pendingCount} 条数据需要人工审核`,
            details: {
                '审核范围': taskInfo.reviewScope || 'AI 失败数据',
                '待处理': pendingCount
            },
            footer: `通知时间：${new Date().toLocaleString('zh-CN')}`,
            actions: [
                {
                    text: '前往审核',
                    url: `${taskInfo.baseUrl}/raw-data-review.html?batch=${taskInfo.batchId}&manual=true`
                }
            ]
        };

        return this.send(message);
    }

    /**
     * 发送裂变完成通知
     */
    async sendFissionComplete(taskInfo, summary) {
        const message = {
            title: '✨ 数据裂变完成',
            template: 'blue',
            content: `**${taskInfo.taskName}** 的裂变任务已完成`,
            details: {
                '源数据量': summary.sourceCount,
                '裂变倍数': summary.fissionCount,
                '生成数据': summary.totalGenerated,
                '裂变要求': taskInfo.fissionRequirement
            },
            footer: `完成时间：${new Date().toLocaleString('zh-CN')}`,
            actions: [
                {
                    text: '查看裂变数据',
                    url: `${taskInfo.baseUrl}/raw-data-review.html?batch=${taskInfo.batchId}`
                },
                {
                    text: '导出数据集',
                    url: `${taskInfo.baseUrl}/api/finetuning/task/${taskInfo.taskId}/export`
                }
            ]
        };

        return this.send(message);
    }

    /**
     * 发送错误告警通知
     */
    async sendErrorAlert(errorInfo) {
        const message = {
            title: '🚨 系统告警',
            template: 'red',
            content: `**${errorInfo.title}**`,
            details: {
                '错误类型': errorInfo.type,
                '发生时间': new Date().toLocaleString('zh-CN'),
                '影响范围': errorInfo.scope,
                '错误信息': errorInfo.message
            },
            footer: errorInfo.suggestion ? `建议：${errorInfo.suggestion}` : '',
            atAll: errorInfo.critical || false
        };

        return this.send(message);
    }
}

// 单例模式
const notificationService = new NotificationService();

module.exports = notificationService;
