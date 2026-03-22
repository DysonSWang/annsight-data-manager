const { BaseProcessor } = require('../base');
const crypto = require('crypto');

// 动态导入 ESM 模块
let MinHash = null;
let LSH = null;
let MinHashAvailable = false;

async function initMinHash() {
    if (MinHashAvailable) return true;

    try {
        // 使用动态 import() 加载 ESM 模块
        const minhashjs = await import('minhashjs');
        MinHash = minhashjs.default || minhashjs.MinHash;
        LSH = minhashjs.LSH;
        MinHashAvailable = true;
        return true;
    } catch (e) {
        console.warn('[Dedup] minhashjs 模块加载失败，使用 MD5 简单去重:', e.message);
        return false;
    }
}

/**
 * MinHash 去重处理器
 * 使用 LSH (Locality Sensitive Hashing) 进行语义去重
 */
class DedupProcessor extends BaseProcessor {
    constructor(options = {}) {
        super();
        // 保存 LSH 实例以便重用
        this.lsh = null;
        this.options = {
            // 相似度阈值（0.85 表示 85% 相似判定为重复）
            threshold: options.threshold || 0.85,
            // 排列数（中文文本建议 256）
            numPerm: options.numPerm || 256,
            // 噪声容忍度
            noise: options.noise || 0.01,
            // 是否使用指纹库（持久化）
            useFingerprintDb: options.useFingerprintDb || false,
            // 数据库连接池
            pool: options.pool
        };
    }

    getName() {
        return 'dedup';
    }

    /**
     * 初始化 LSH（惰性加载）
     */
    async initLSH() {
        if (this.lsh) {
            return;
        }

        // 如果已经初始化过 MD5 索引，直接返回
        if (this.md5Index) {
            return;
        }

        const hasMinHash = await initMinHash();

        if (hasMinHash && LSH) {
            this.lsh = new LSH({
                threshold: this.options.threshold,
                numPerm: this.options.numPerm
            });

            // 如果配置了数据库，从数据库加载已有的指纹
            if (this.options.useFingerprintDb && this.options.pool) {
                await this.loadFingerprintsFromDb();
            }
        } else {
            // 使用 MD5 简单去重作为备选
            this.md5Index = new Map();
            console.log('[Dedup] 使用 MD5 简单去重模式');
        }
    }

    /**
     * 从数据库加载指纹
     */
    async loadFingerprintsFromDb() {
        try {
            const result = await this.options.pool.query(`
                SELECT data_id, minhash_blob FROM fingerprint_index
            `);

            for (const row of result.rows) {
                try {
                    // 反序列化 MinHash
                    const minhash = MinHash.deserialize(
                        Buffer.from(row.minhash_blob, 'base64').toString('utf-8')
                    );
                    this.lsh.insert(row.data_id, minhash);
                } catch (e) {
                    console.warn(`加载指纹失败：${row.data_id}`, e.message);
                }
            }

            console.log(`[Dedup] 已加载 ${result.rows.length} 条指纹`);
        } catch (error) {
            console.warn('[Dedup] 加载指纹库失败:', error.message);
        }
    }

    async process(context) {
        await this.initLSH();

        const { cleanedText, dataId, items, fissionMode } = context;

        // 裂变模式：对每条 item 进行去重检查
        if (fissionMode && items && Array.isArray(items)) {
            const dedupedItems = [];
            const duplicateItems = [];

            for (const item of items) {
                const content = item.content || item.title || '';
                if (!content) continue;

                const md5 = this.computeMD5(content);
                if (this.md5Index.has(md5)) {
                    duplicateItems.push({
                        ...item,
                        isDuplicate: true,
                        duplicateOf: this.md5Index.get(md5),
                        duplicateReason: '内容 MD5 完全匹配'
                    });
                } else {
                    this.md5Index.set(md5, dataId || md5);
                    dedupedItems.push({
                        ...item,
                        isDuplicate: false
                    });
                }
            }

            return {
                items: dedupedItems,
                duplicateItems,
                fissionMode: true,
                isDuplicate: false, // 裂变模式下整体不算重复，只是部分 item 可能重复
                dedupedCount: dedupedItems.length,
                duplicateCount: duplicateItems.length
            };
        }

        // 传统模式：单条数据处理
        if (!cleanedText) {
            throw new Error('没有可去重的内容');
        }

        // 检查是否有 LSH 可用
        if (this.lsh) {
            // 使用 LSH 语义去重
            const minhash = this.computeMinHash(cleanedText);
            const similar = this.lsh.query(minhash);

            if (similar.length > 0) {
                // 发现重复
                return {
                    isDuplicate: true,
                    duplicateOf: similar[0],
                    duplicateReason: `与文档 ${similar[0]} 相似度超过阈值`,
                    similarIds: similar
                };
            }

            // 不是重复，加入 LSH 索引
            if (dataId) {
                this.lsh.insert(dataId, minhash);

                // 如果配置了数据库，持久化指纹
                if (this.options.useFingerprintDb && this.options.pool) {
                    await this.saveFingerprintToDb(dataId, minhash);
                }
            }

            return {
                isDuplicate: false,
                minhash: minhash
            };
        } else {
            // 使用 MD5 简单去重
            const md5 = this.computeMD5(cleanedText);

            if (this.md5Index.has(md5)) {
                return {
                    isDuplicate: true,
                    duplicateOf: this.md5Index.get(md5),
                    duplicateReason: '内容 MD5 完全匹配',
                    method: 'md5'
                };
            }

            // 即使没有 dataId，也要保存 MD5 到索引（用 MD5 值本身作为临时 ID）
            this.md5Index.set(md5, dataId || md5);

            return {
                isDuplicate: false,
                md5,
                method: 'md5'
            };
        }
    }

    /**
     * 计算 MinHash
     */
    computeMinHash(text) {
        const m = new MinHash({ num_perm: this.options.numPerm });

        // 分词（中文简单分词：按字符）
        const words = this.tokenize(text);

        for (const word of words) {
            m.update(word);
        }

        return m;
    }

    /**
     * 中文分词（简单实现）
     * 可以使用更好的分词库如 node-segment
     */
    tokenize(text) {
        // 移除标点和空白
        const cleaned = text.replace(/[^\w\u4e00-\u9fa5]/g, '');

        // 对于中文，每个字符作为一个词（简单方法）
        // 更好的方法是使用分词库
        const words = [];

        // 添加单字符
        for (let i = 0; i < cleaned.length; i++) {
            words.push(cleaned[i]);
        }

        // 添加双字符组合（提高语义捕捉）
        for (let i = 0; i < cleaned.length - 1; i++) {
            words.push(cleaned.slice(i, i + 2));
        }

        return words;
    }

    /**
     * 保存指纹到数据库
     */
    async saveFingerprintToDb(dataId, minhash) {
        try {
            const minhashPrefix = minhash.hashvalues.slice(0, 4).join('');
            const minhashBlob = minhash.serialize().toString('base64');

            await this.options.pool.query(`
                INSERT INTO fingerprint_index (content_md5, minhash_prefix, minhash_blob, data_id)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (content_md5) DO NOTHING
            `, [
                this.computeMD5(minhash),
                minhashPrefix,
                minhashBlob,
                dataId
            ]);
        } catch (error) {
            console.warn('[Dedup] 保存指纹失败:', error.message);
        }
    }

    /**
     * 计算 MD5（用于唯一标识）
     */
    computeMD5(text) {
        const crypto = require('crypto');
        // 直接对文本内容计算 MD5
        return crypto.createHash('md5').update(text).digest('hex');
    }

    /**
     * 序列化 LSH 状态（用于持久化）
     */
    async serializeLSH() {
        if (!this.lsh) {
            return null;
        }

        // 返回所有指纹
        const fingerprints = [];
        // 注意：minhashjs 的 LSH 没有公开遍历方法
        // 实际使用时需要扩展 LSH 类或自行维护索引
        return fingerprints;
    }

    isRequired() {
        return true;
    }
}

module.exports = { DedupProcessor };
