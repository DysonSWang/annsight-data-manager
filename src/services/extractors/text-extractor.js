/**
 * 文本提取器
 * 支持 TXT、CSV 等纯文本格式
 */

const fs = require('fs');

class TextExtractor {
    /**
     * 支持的 MIME 类型
     */
    static get supportedTypes() {
        return ['text/plain', 'text/csv', 'text/html'];
    }

    /**
     * 检测是否支持此文件类型
     * @param {string} contentType - MIME 类型
     * @param {string} filePath - 文件路径
     * @returns {boolean}
     */
    static supports(contentType, filePath = '') {
        if (contentType && this.supportedTypes.includes(contentType)) {
            return true;
        }
        // 通过扩展名判断
        if (filePath) {
            const ext = filePath.split('.').pop().toLowerCase();
            return ['txt', 'csv', 'md'].includes(ext);
        }
        return false;
    }

    /**
     * 提取文本内容
     * @param {string} filePath - 文件路径
     * @param {object} options - 配置选项
     * @returns {Promise<{text: string, metadata: object, items?: array}>}
     */
    async extract(filePath, options = {}) {
        console.log(`[文本提取器] 提取文件：${filePath}`);

        const content = fs.readFileSync(filePath, 'utf-8');
        const ext = filePath.split('.').pop().toLowerCase();

        // CSV 文件处理
        if (ext === 'csv') {
            return this.extractCSV(content, options);
        }

        // HTML 文件处理
        if (ext === 'html' || ext === 'htm') {
            return this.extractHTML(content, options);
        }

        // 纯文本
        return {
            text: content.trim(),
            metadata: {
                format: 'text',
                encoding: 'utf-8',
                lineCount: content.split('\n').length,
                charCount: content.length
            }
        };
    }

    /**
     * 提取 CSV 文件
     */
    extractCSV(content, options = {}) {
        const lines = content.split(/\r?\n/).filter(line => line.trim());
        const { delimiter = ',' } = options;

        if (lines.length === 0) {
            return {
                text: '',
                metadata: { format: 'csv', rowCount: 0 },
                items: []
            };
        }

        // 解析表头
        const headers = this.parseCSVLine(lines[0], delimiter);

        // 解析数据行
        const items = [];
        const textRows = [];

        for (let i = 1; i < lines.length; i++) {
            const values = this.parseCSVLine(lines[i], delimiter);
            const row = {};

            headers.forEach((header, index) => {
                row[header] = values[index] || '';
            });

            items.push(row);

            // 构建文本行（所有字段拼接）
            textRows.push(Object.values(row).join(' '));
        }

        return {
            text: textRows.join('\n'),
            metadata: {
                format: 'csv',
                rowCount: items.length,
                columns: headers
            },
            items
        };
    }

    /**
     * 解析 CSV 行（处理引号和转义）
     */
    parseCSVLine(line, delimiter) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === delimiter && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }

        result.push(current.trim());
        return result;
    }

    /**
     * 提取 HTML 文件
     */
    extractHTML(content, options = {}) {
        // 简单 HTML 转文本（去除标签）
        const text = content
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .trim();

        return {
            text,
            metadata: {
                format: 'html',
                charCount: text.length
            }
        };
    }
}

module.exports = { TextExtractor };
