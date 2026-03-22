/**
 * JSON 提取器
 * 支持 JSONPath 配置提取
 */

const fs = require('fs');

class JsonExtractor {
    /**
     * 支持的 MIME 类型
     */
    static get supportedTypes() {
        return ['application/json'];
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
            return ext === 'json';
        }
        return false;
    }

    /**
     * 提取 JSON 内容
     * @param {string} filePath - 文件路径
     * @param {object} options - 配置选项
     * @returns {Promise<{text: string, metadata: object, items: array}>}
     */
    async extract(filePath, options = {}) {
        console.log(`[JSON 提取器] 提取文件：${filePath}`);

        const content = fs.readFileSync(filePath, 'utf-8');
        let json;

        try {
            json = JSON.parse(content);
        } catch (error) {
            throw new Error(`JSON 解析失败：${error.message}`);
        }

        const { jsonPath } = options;

        // 如果没有指定路径，尝试自动提取
        if (!jsonPath) {
            return this.autoExtract(json);
        }

        // 使用 JSONPath 提取
        const items = this.queryJsonPath(json, jsonPath);

        return this.buildResult(items, jsonPath);
    }

    /**
     * 自动提取 JSON 内容
     */
    autoExtract(json) {
        const items = [];

        // 情况 1：数组 [{content: "..."}, ...]
        if (Array.isArray(json)) {
            return this.extractFromArray(json);
        }

        // 情况 2：对象 {data: [...]}
        if (json.data && Array.isArray(json.data)) {
            return this.extractFromArray(json.data);
        }

        // 情况 3：对象 {items: [...]}
        if (json.items && Array.isArray(json.items)) {
            return this.extractFromArray(json.items);
        }

        // 情况 4：对象 {results: [...]}
        if (json.results && Array.isArray(json.results)) {
            return this.extractFromArray(json.results);
        }

        // 情况 5：单个对象，提取所有字符串字段
        if (typeof json === 'object' && json !== null) {
            const strings = this.extractAllStrings(json);
            if (strings.length > 0) {
                items.push({
                    text: strings.join('\n'),
                    metadata: { source: 'json_object', fields: Object.keys(json) }
                });
            }
        }

        return this.buildResult(items, 'auto');
    }

    /**
     * 从数组提取
     */
    extractFromArray(array) {
        const items = [];

        for (const item of array) {
            const extracted = this.extractItem(item);
            if (extracted.text) {
                items.push(extracted);
            }
        }

        return this.buildResult(items, 'array');
    }

    /**
     * 提取单个项目
     */
    extractItem(item) {
        if (typeof item === 'string') {
            return {
                text: item,
                metadata: { format: 'json', itemType: 'string' }
            };
        }

        if (typeof item !== 'object' || item === null) {
            return {
                text: String(item),
                metadata: { format: 'json', itemType: 'primitive' }
            };
        }

        // 常见内容字段
        const contentFields = ['content', 'text', 'body', 'description', 'summary', 'message'];
        const titleFields = ['title', 'name', 'subject', 'heading'];

        let content = '';
        let title = '';

        // 查找内容字段
        for (const field of contentFields) {
            if (item[field]) {
                content = typeof item[field] === 'string'
                    ? item[field]
                    : JSON.stringify(item[field]);
                break;
            }
        }

        // 查找标题字段
        for (const field of titleFields) {
            if (item[field]) {
                title = typeof item[field] === 'string'
                    ? item[field]
                    : JSON.stringify(item[field]);
                break;
            }
        }

        // 如果没找到内容字段，提取所有字符串
        if (!content) {
            const strings = this.extractAllStrings(item);
            content = strings.join('\n');
        }

        return {
            text: title ? `${title}\n\n${content}` : content,
            metadata: {
                format: 'json',
                itemType: 'object',
                title: title || null,
                fields: Object.keys(item)
            }
        };
    }

    /**
     * 提取对象中的所有字符串
     */
    extractAllStrings(obj, depth = 0) {
        const results = [];

        if (depth > 10) return results; // 防止无限递归

        if (typeof obj === 'string') {
            results.push(obj);
        } else if (Array.isArray(obj)) {
            for (const item of obj) {
                results.push(...this.extractAllStrings(item, depth + 1));
            }
        } else if (typeof obj === 'object' && obj !== null) {
            for (const value of Object.values(obj)) {
                results.push(...this.extractAllStrings(value, depth + 1));
            }
        }

        return results.filter(s => s.trim().length > 0);
    }

    /**
     * JSONPath 查询
     */
    queryJsonPath(json, path) {
        // 简单 JSONPath 实现
        // 支持：$.data[*].content, $..content, .data.content

        const items = [];

        try {
            // 移除开头的 $
            let normalizedPath = path.replace(/^\$/, '');

            if (normalizedPath.startsWith('..')) {
                // 递归查找：$..content
                const targetField = normalizedPath.slice(2);
                items.push(...this.recursiveFind(json, targetField));
            } else if (normalizedPath.includes('[*]')) {
                // 数组遍历：$.data[*].content
                items.push(...this.queryArrayPath(json, normalizedPath));
            } else {
                // 直接路径：.data.content
                const parts = normalizedPath.split('.').filter(Boolean);
                let current = json;

                for (const part of parts) {
                    if (current && typeof current === 'object') {
                        current = current[part];
                    } else {
                        break;
                    }
                }

                if (current !== undefined) {
                    if (Array.isArray(current)) {
                        items.push(...current.map(item => this.extractItem(item)));
                    } else {
                        items.push(this.extractItem(current));
                    }
                }
            }
        } catch (error) {
            console.error('[JSON 提取器] JSONPath 查询失败:', error.message);
        }

        return items;
    }

    /**
     * 递归查找字段
     */
    recursiveFind(obj, field, results = []) {
        if (typeof obj !== 'object' || obj === null) return results;

        if (obj[field] !== undefined) {
            results.push(this.extractItem(obj[field]));
        }

        for (const value of Object.values(obj)) {
            if (typeof value === 'object' && value !== null) {
                this.recursiveFind(value, field, results);
            }
        }

        return results;
    }

    /**
     * 数组路径查询
     */
    queryArrayPath(json, path) {
        const items = [];
        const parts = path.split('[*]');

        if (parts.length !== 2) return items;

        // 获取数组
        const arrayPath = parts[0].split('.').filter(Boolean);
        let array = json;

        for (const p of arrayPath) {
            if (array && typeof array === 'object') {
                array = array[p];
            } else {
                return items;
            }
        }

        if (!Array.isArray(array)) return items;

        // 处理数组元素的路径
        const elementPath = parts[1].split('.').filter(Boolean);

        for (const item of array) {
            let current = item;
            for (const p of elementPath) {
                if (current && typeof current === 'object') {
                    current = current[p];
                } else {
                    break;
                }
            }
            if (current !== undefined) {
                items.push(this.extractItem(current));
            }
        }

        return items;
    }

    /**
     * 构建结果
     */
    buildResult(items, pathType) {
        const texts = items.map(item => item.text).filter(Boolean);

        return {
            text: texts.join('\n\n---\n\n'),
            metadata: {
                format: 'json',
                pathType,
                itemCount: items.length,
                validCount: texts.length
            },
            items
        };
    }
}

module.exports = { JsonExtractor };
