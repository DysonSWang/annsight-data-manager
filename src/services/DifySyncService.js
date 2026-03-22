const ProcessedDataRepository = require('../repository/ProcessedDataRepository');

/**
 * Dify 同步服务
 * 负责将审核通过的数据同步到 Dify RAG 知识库
 */
class DifySyncService {
    /**
     * @param {Pool} pool - PostgreSQL 连接池
     * @param {Object} difyApi - Dify API 客户端
     * @param {string} defaultDatasetId - 默认数据集 ID
     */
    constructor(pool, difyApi, defaultDatasetId = 'default') {
        this.pool = pool;
        this.difyApi = difyApi;
        this.defaultDatasetId = defaultDatasetId;
        this.repo = new ProcessedDataRepository(pool);
    }

    /**
     * 同步单条数据到 Dify
     * @param {string} dataId - 数据 ID
     * @returns {Promise<Object>} 同步结果
     */
    async syncToDify(dataId) {
        try {
            // 获取数据
            const data = await this.repo.findById(dataId);
            if (!data) {
                return { success: false, error: 'Data not found' };
            }

            // 格式化文档
            const document = await this.formatDocument(dataId);

            // 调用 Dify API
            const datasetId = data.collection_name || this.defaultDatasetId;
            const result = await this.difyApi.importDocument(datasetId, document);

            // 标记已同步
            await this.repo.markAsUsedInRag(dataId);

            return {
                success: true,
                documentId: result.documentId,
                datasetId
            };
        } catch (error) {
            console.error(`Error syncing data ${dataId} to Dify:`, error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 批量同步所有待同步的数据
     * @returns {Promise<Object>} 同步统计信息
     */
    async syncBatch() {
        try {
            // 获取所有待同步的数据
            const readyData = await this.repo.findReadyForRag();

            let synced = 0;
            let failed = 0;
            const details = [];

            for (const data of readyData) {
                const result = await this.syncToDify(data.id);

                if (result.success) {
                    synced++;
                } else {
                    failed++;
                }

                details.push({
                    id: data.id,
                    title: data.title,
                    ...result
                });
            }

            return {
                synced,
                failed,
                total: readyData.length,
                details
            };
        } catch (error) {
            console.error('Error syncing batch to Dify:', error);
            return {
                synced: 0,
                failed: 0,
                total: 0,
                error: error.message
            };
        }
    }

    /**
     * 格式化文档为 Dify API 所需格式
     * @param {string} dataId - 数据 ID
     * @returns {Promise<Object>} 格式化的文档
     */
    async formatDocument(dataId) {
        const data = await this.repo.findById(dataId);

        if (!data) {
            throw new Error('Data not found');
        }

        // 构建元数据
        const metadata = {
            type: data.type,
            category: data.category,
            subcategory: data.subcategory,
            target_user: data.target_user,
            source: data.source,
            batch_id: data.batch_id,
            tags: data.tags || [],
            created_at: data.created_at
        };

        // 如果有对话数据，添加到内容中
        let content = data.content;
        if (data.conversation && Array.isArray(data.conversation)) {
            const conversationText = data.conversation
                .map(msg => `${msg.role === 'user' ? '用户' : '助手'}: ${msg.content}`)
                .join('\n\n');
            content = `${content}\n\n---\n\n对话示例:\n${conversationText}`;
        }

        return {
            title: data.title,
            content,
            metadata
        };
    }

    /**
     * 测试 Dify API 连接
     * @returns {Promise<boolean>} 连接是否正常
     */
    async testConnection() {
        try {
            // 尝试获取数据集列表或其他轻量级操作
            await this.difyApi.getDatasets?.();
            return true;
        } catch (error) {
            console.error('Dify API connection test failed:', error);
            return false;
        }
    }
}

module.exports = DifySyncService;
