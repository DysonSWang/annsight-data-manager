/**
 * 原始数据索引仓库 - 负责 raw_data_index 表的 CRUD 操作
 */
class RawDataIndexRepository {
    constructor(pool) {
        this.pool = pool;
    }

    /**
     * 创建原始数据记录
     * @param {Object} rawData - 原始数据
     * @param {string} rawData.id - 记录 ID
     * @param {string} rawData.ossUrl - OSS URL
     * @param {string} rawData.contentType - 内容类型
     * @param {string} rawData.source - 来源 (zhihu/xiaohongshu/interview/submission)
     * @param {string} rawData.batchId - 批次 ID
     * @param {string} [rawData.contentMd5] - 内容 MD5
     * @param {Object} [rawData.metadata] - 元数据 (JSONB)
     * @returns {Promise<Object>} 创建的记录
     */
    async create(rawData) {
        const {
            id,
            ossUrl,
            contentType,
            source,
            batchId,
            contentMd5,
            metadata,
            status = 'pending'
        } = rawData;

        // 验证必填字段（ossUrl 可以为空字符串）
        if (!id || !contentType || !source || !batchId) {
            throw new Error('Missing required fields: id, contentType, source, batchId');
        }

        const query = `
            INSERT INTO raw_data_index
            (id, oss_url, content_type, source, batch_id, content_md5, metadata, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `;

        const result = await this.pool.query(query, [
            id,
            ossUrl,
            contentType,
            source,
            batchId,
            contentMd5 || null,
            metadata ? JSON.stringify(metadata) : null,
            status
        ]);

        return result.rows[0];
    }

    /**
     * 通过 ID 查找记录
     * @param {string} id - 记录 ID
     * @returns {Promise<Object|undefined>} 记录或 undefined
     */
    async findById(id) {
        const query = `SELECT * FROM raw_data_index WHERE id = $1`;
        const result = await this.pool.query(query, [id]);
        return result.rows[0];
    }

    /**
     * 通过 MD5 查找记录
     * @param {string} md5 - 内容 MD5
     * @returns {Promise<Object|undefined>} 记录或 undefined
     */
    async findByMd5(md5) {
        const query = `SELECT * FROM raw_data_index WHERE content_md5 = $1`;
        const result = await this.pool.query(query, [md5]);
        return result.rows[0];
    }

    /**
     * 标记为重复
     * @param {string} id - 记录 ID
     * @param {string} duplicateOf - 原始记录 ID
     * @param {string} reason - 重复原因
     * @returns {Promise<void>}
     */
    async markAsDuplicate(id, duplicateOf, reason) {
        const query = `
            UPDATE raw_data_index
            SET status = 'duplicate',
                duplicate_of = $2,
                duplicate_reason = $3,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
        `;
        await this.pool.query(query, [id, duplicateOf, reason]);
    }

    /**
     * 更新转录信息
     * @param {string} id - 记录 ID
     * @param {Object} transcript - 转录信息
     * @param {string} transcript.status - 转录状态
     * @param {string} transcript.ossUrl - 转录文件 OSS URL
     * @param {string} transcript.text - 转录文本
     * @returns {Promise<void>}
     */
    async updateTranscript(id, { status, ossUrl, text }) {
        const query = `
            UPDATE raw_data_index
            SET transcript_status = $2,
                transcript_oss_url = $3,
                transcript_text = $4,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
        `;
        await this.pool.query(query, [id, status, ossUrl, text]);
    }

    /**
     * 更新第一级审核状态
     * @param {string} id - 记录 ID
     * @param {Object} review - 审核信息
     * @param {string} review.status - 审核状态 (approved/rejected)
     * @param {string} review.reviewedBy - 审核人
     * @param {string} [review.rejectReason] - 拒绝原因
     * @returns {Promise<void>}
     */
    async updateReviewStatusRaw(id, { status, reviewedBy, rejectReason }) {
        const query = `
            UPDATE raw_data_index
            SET review_status_raw = $2,
                reviewed_by_raw = $3,
                reject_reason_raw = $4,
                reviewed_at_raw = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
        `;
        await this.pool.query(query, [id, status, reviewedBy, rejectReason || null]);
    }

    /**
     * 按批次列出记录
     * @param {string} batchId - 批次 ID
     * @returns {Promise<Array>} 记录列表
     */
    async listByBatch(batchId) {
        const query = `
            SELECT * FROM raw_data_index
            WHERE batch_id = $1
            ORDER BY created_at DESC
        `;
        const result = await this.pool.query(query, [batchId]);
        return result.rows;
    }

    /**
     * 按状态列出记录
     * @param {string} status - 状态
     * @returns {Promise<Array>} 记录列表
     */
    async listByStatus(status) {
        const query = `
            SELECT * FROM raw_data_index
            WHERE status = $1
            ORDER BY created_at DESC
        `;
        const result = await this.pool.query(query, [status]);
        return result.rows;
    }

    /**
     * 更新处理状态
     * @param {string} id - 记录 ID
     * @param {string} status - 新状态
     * @returns {Promise<void>}
     */
    async updateStatus(id, status) {
        const query = `
            UPDATE raw_data_index
            SET status = $2,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
        `;
        await this.pool.query(query, [id, status]);
    }

    /**
     * 更新处理中状态（ETL 阶段追踪）
     * @param {string} id - 记录 ID
     * @param {string} processingStatus - 处理中状态 (processing_l1_clean, processing_l25_fission, processing_l2_structure, processing_l3_evaluate, processing_dedup)
     * @returns {Promise<void>}
     */
    async updateProcessingStatus(id, processingStatus) {
        const query = `
            UPDATE raw_data_index
            SET processing_status = $2,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
        `;
        await this.pool.query(query, [id, processingStatus]);
    }
}

module.exports = RawDataIndexRepository;
