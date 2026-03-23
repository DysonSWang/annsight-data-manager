/**
 * 加工数据仓库 - 负责 processed_data 表的 CRUD 操作
 */
class ProcessedDataRepository {
    constructor(pool) {
        this.pool = pool;
    }

    /**
     * 创建加工数据记录
     * @param {Object} data - 加工数据
     * @param {string} data.id - 记录 ID
     * @param {string} data.rawDataId - 原始数据 ID
     * @param {string} data.type - 类型
     * @param {string} data.category - 分类
     * @param {string} data.title - 标题
     * @param {string} data.content - 内容
     * @param {string} [data.collectionName] - 知识库分库标识
     * @param {string} [data.subcategory] - 子分类
     * @param {string} [data.targetUser] - 目标用户
     * @param {Object} [data.tags] - 标签 (JSONB)
     * @param {Array} [data.conversation] - 多轮对话 (JSONB)
     * @param {number} [data.completenessScore] - 完整性评分
     * @param {number} [data.aiConfidenceScore] - AI 置信度
     * @param {boolean} [data.autoApproved] - 是否自动批准
     * @param {string} [data.source] - 来源
     * @param {string} [data.batchId] - 批次 ID
     * @returns {Promise<Object>} 创建的记录
     */
    async create(data) {
        const {
            id,
            rawDataId,
            type,
            category,
            subcategory,
            targetUser,
            title,
            content,
            collectionName = 'default',
            tags,
            conversation,
            completeness_score,
            authenticity_score,
            quality_score,
            quality_note,
            ai_confidence_score,
            ai_model_version,
            autoApproved = false,
            source,
            batchId,
            cooling_hours,
            cooling_until,
            purposes // 新增：用途列表 ['rag', 'finetuning', 'content_creation']
        } = data;

        console.log('[Repo] create called with batchId:', batchId, 'source:', source);

        // 验证必填字段
        // 注意：rawDataId 可以为 null（直接上传的文本）
        if (!id || !type || !category || !title || !content) {
            throw new Error('Missing required fields: id, type, category, title, content');
        }

        // 计算冷却期结束时间（默认 24 小时）
        const coolingUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);

        const query = `
            INSERT INTO processed_data
            (id, raw_data_id, collection_name, type, category, subcategory, target_user,
             title, content, tags, conversation, completeness_score, quality_score, quality_note,
             ai_confidence_score, ai_model_version, auto_approved, cooling_hours, cooling_until,
             source, batch_id, purposes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
            RETURNING *
        `;

        const params = [
            id,
            rawDataId,
            collectionName,
            type,
            category,
            subcategory || null,
            targetUser || null,
            title,
            content,
            tags ? JSON.stringify(tags) : null,
            conversation ? JSON.stringify(conversation) : null,
            completeness_score || null,
            quality_score || null,
            quality_note || null,
            ai_confidence_score || null,
            ai_model_version || null,
            autoApproved,
            cooling_hours || null,
            cooling_until || coolingUntil,
            source || null,
            batchId || null,
            purposes ? (Array.isArray(purposes) ? purposes.join(',') : purposes) : null
        ];

        console.log('[Repo] params[20] (batch_id):', params[20]);

        const result = await this.pool.query(query, params);

        console.log('[Repo] result.rows[0].batch_id:', result.rows[0]?.batch_id);

        return result.rows[0];
    }

    /**
     * 通过 ID 查找记录
     * @param {string} id - 记录 ID
     * @returns {Promise<Object|undefined>} 记录或 undefined
     */
    async findById(id) {
        const query = `SELECT * FROM processed_data WHERE id = $1`;
        const result = await this.pool.query(query, [id]);
        return result.rows[0];
    }

    /**
     * 查找低置信度待审核数据
     * @param {number} threshold - 置信度阈值
     * @param {number} limit - 返回数量限制
     * @param {number} offset - 偏移量
     * @returns {Promise<Array>} 记录列表
     */
    async findLowConfidence(threshold = 0.8, limit = 20, offset = 0) {
        const query = `
            SELECT pd.*, rdi.content_type, rdi.source, rdi.oss_url
            FROM processed_data pd
            LEFT JOIN raw_data_index rdi ON pd.raw_data_id = rdi.id
            WHERE pd.review_status = 'pending'
              AND pd.ai_confidence_score < $1
            ORDER BY pd.ai_confidence_score ASC, pd.created_at DESC
            LIMIT $2 OFFSET $3
        `;
        const result = await this.pool.query(query, [threshold, limit, offset]);
        return result.rows;
    }

    /**
     * 自动批准高置信度数据
     * @param {string} id - 记录 ID
     * @param {number} coolingHours - 冷却期时长（小时）
     * @returns {Promise<Object>} 更新后的记录
     */
    async autoApprove(id, coolingHours = 24) {
        const query = `
            UPDATE processed_data
            SET review_status = 'approved',
                reviewed_by = NULL,
                reviewed_at = CURRENT_TIMESTAMP,
                auto_approved = TRUE,
                cooling_until = CURRENT_TIMESTAMP + ($1 || ' hours')::interval,
                ready_for_rag = FALSE,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING *
        `;
        const result = await this.pool.query(query, [coolingHours.toString(), id]);
        return result.rows[0];
    }

    /**
     * 手动批准数据
     * @param {string} id - 记录 ID
     * @param {string} reviewerId - 审核人 ID
     * @returns {Promise<Object>} 更新后的记录
     */
    async approve(id, reviewerId) {
        const query = `
            UPDATE processed_data
            SET review_status = 'approved',
                reviewed_by = $2,
                reviewed_at = CURRENT_TIMESTAMP,
                ready_for_rag = FALSE,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING *
        `;
        const result = await this.pool.query(query, [id, reviewerId]);
        return result.rows[0];
    }

    /**
     * 拒绝数据
     * @param {string} id - 记录 ID
     * @param {string} reviewerId - 审核人 ID
     * @param {string} reason - 拒绝原因
     * @returns {Promise<Object>} 更新后的记录
     */
    async reject(id, reviewerId, reason) {
        const query = `
            UPDATE processed_data
            SET review_status = 'rejected',
                reviewed_by = $2,
                reviewed_at = CURRENT_TIMESTAMP,
                reject_reason = $3,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING *
        `;
        const result = await this.pool.query(query, [id, reviewerId, reason]);
        return result.rows[0];
    }

    /**
     * 查找可以同步到 Dify 的数据（冷却期已过）
     * @returns {Promise<Array>} 记录列表
     */
    async findReadyForRag() {
        const query = `
            SELECT id, type, title, content, collection_name
            FROM processed_data
            WHERE review_status = 'approved'
              AND ready_for_rag = FALSE
              AND (cooling_until IS NULL OR cooling_until <= CURRENT_TIMESTAMP)
        `;
        const result = await this.pool.query(query);
        return result.rows;
    }

    /**
     * 标记已同步到 Dify
     * @param {string} id - 记录 ID
     * @returns {Promise<Object>} 更新后的记录
     */
    async markAsUsedInRag(id) {
        const query = `
            UPDATE processed_data
            SET used_in_rag = TRUE,
                rag_imported_at = CURRENT_TIMESTAMP,
                ready_for_rag = TRUE,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING *
        `;
        const result = await this.pool.query(query, [id]);
        return result.rows[0];
    }

    /**
     * 获取抽检样本（分层抽样）
     * @param {Object} options - 抽样选项
     * @param {number} options.minPerType - 每种类型最少样本数
     * @returns {Promise<Array>} 样本列表
     */
    async getSpotCheckSamples(options = {}) {
        const { minPerType = 2 } = options;

        const query = `
            SELECT * FROM (
                SELECT pd.*,
                       ROW_NUMBER() OVER (PARTITION BY type ORDER BY RANDOM()) as rn
                FROM processed_data pd
                WHERE pd.auto_approved = TRUE AND pd.review_status = 'approved'
            ) t
            WHERE rn <= $1
            ORDER BY type, created_at DESC
        `;
        const result = await this.pool.query(query, [minPerType]);
        return result.rows;
    }

    /**
     * 批量修正数据
     * @param {Object} conditions - 筛选条件
     * @param {string} conditions.type - 类型
     * @param {string} conditions.category - 分类
     * @param {Object} corrections - 修正内容
     * @param {string} corrections.category - 新分类
     * @returns {Promise<number>} 修正的记录数
     */
    async batchCorrect(conditions, corrections) {
        const { type, category } = conditions;
        const whereClauses = ['review_status = $1'];
        const params = ['approved'];
        let paramIndex = 2;

        if (type) {
            whereClauses.push(`type = $${paramIndex++}`);
            params.push(type);
        }
        if (category) {
            whereClauses.push(`category = $${paramIndex++}`);
            params.push(category);
        }

        const whereSql = whereClauses.join(' AND ');

        const query = `
            UPDATE processed_data
            SET category = $${paramIndex},
                updated_at = CURRENT_TIMESTAMP
            WHERE ${whereSql}
            RETURNING id
        `;

        const result = await this.pool.query(query, [...params, corrections.category]);
        return result.rowCount;
    }

    /**
     * 导出用于微调的数据
     * @returns {Promise<Array>} 微调数据列表
     */
    async exportForFinetuning() {
        const query = `
            SELECT id, type, category, title, content, conversation, created_at
            FROM processed_data
            WHERE review_status = 'approved'
            ORDER BY created_at DESC
        `;
        const result = await this.pool.query(query);
        return result.rows;
    }

    /**
     * 更新记录
     * @param {string} id - 记录 ID
     * @param {Object} updates - 更新内容
     * @returns {Promise<Object>} 更新后的记录
     */
    async update(id, updates) {
        const allowedFields = ['type', 'category', 'subcategory', 'target_user', 'title', 'content', 'tags', 'conversation', 'quality_score'];
        const fields = [];
        const values = [];
        let paramIndex = 1;

        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key)) {
                const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
                fields.push(`${snakeKey} = $${paramIndex++}`);
                values.push(typeof value === 'object' ? JSON.stringify(value) : value);
            }
        }

        if (fields.length === 0) {
            throw new Error('No valid fields to update');
        }

        values.push(id);
        const query = `
            UPDATE processed_data
            SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE id = $${paramIndex}
            RETURNING *
        `;

        const result = await this.pool.query(query, values);
        return result.rows[0];
    }

    /**
     * 统计 AI 准确率
     * @returns {Promise<Object>} 统计数据
     */
    async getAiAccuracyStats() {
        const query = `
            SELECT
                COUNT(*) as total_spot_checks,
                SUM(CASE WHEN result = 'corrected' THEN 1 ELSE 0 END) as corrections,
                1.0 - (SUM(CASE WHEN result = 'corrected' THEN 1 ELSE 0 END)::DECIMAL / NULLIF(COUNT(*), 0)) as accuracy
            FROM review_logs
            WHERE is_spot_check = TRUE
        `;
        const result = await this.pool.query(query);
        return result.rows[0];
    }

    /**
     * 获取阈值调整建议
     * @param {number} currentThreshold - 当前阈值
     * @returns {Promise<Object>} 阈值建议
     */
    async getThresholdRecommendation(currentThreshold = 0.8) {
        const query = `
            SELECT
                AVG(ai_confidence_score) as avg_confidence,
                COUNT(*) as total,
                SUM(CASE WHEN pd.ai_confidence_score >= $1 AND rl.result = 'corrected' THEN 1 ELSE 0 END) as false_positives
            FROM processed_data pd
            JOIN review_logs rl ON pd.id = rl.data_id
            WHERE pd.auto_approved = TRUE AND pd.review_status = 'approved'
        `;
        const result = await this.pool.query(query, [currentThreshold]);
        const stats = result.rows[0];

        const accuracy = 1.0 - (stats.false_positives / stats.total);
        let recommendedThreshold = currentThreshold;

        if (accuracy < 0.85) {
            recommendedThreshold = Math.min(0.95, currentThreshold + 0.05);
        } else if (accuracy > 0.95) {
            recommendedThreshold = Math.max(0.75, currentThreshold - 0.05);
        }

        return {
            currentThreshold,
            accuracy,
            recommendedThreshold,
            stats
        };
    }

    /**
     * 获取数据分布统计
     * @param {string} field - 分布字段 (type/category/source)
     * @param {string[]} purposesFilter - 用途筛选（可选）
     * @returns {Promise<Array>} 分布数据
     */
    async getDistribution(field = 'type', purposesFilter = null) {
        const validFields = ['type', 'category', 'source'];
        if (!validFields.includes(field)) {
            throw new Error(`Invalid field: ${field}. Must be one of: ${validFields.join(', ')}`);
        }

        let whereClause = "WHERE review_status IN ('approved', 'pending')";
        const params = [];

        if (purposesFilter && purposesFilter.length > 0) {
            const purposeConditions = purposesFilter.map((_, i) => `purposes LIKE $${i + 1}`);
            whereClause += ` AND (${purposeConditions.join(' OR ')})`;
            purposesFilter.forEach((p, i) => params.push(`%${p}%`));
        }

        const query = `
            SELECT ${field}, COUNT(*) as count
            FROM processed_data
            ${whereClause}
            GROUP BY ${field}
            ORDER BY count DESC
        `;
        const result = await this.pool.query(query, params);
        return result.rows;
    }

    /**
     * 获取详细统计摘要
     * @returns {Promise<Object>} 统计数据
     */
    async getDetailedStats() {
        const query = `
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE review_status = 'pending') as pending,
                COUNT(*) FILTER (WHERE review_status = 'approved') as approved,
                COUNT(*) FILTER (WHERE review_status = 'rejected') as rejected,
                COUNT(*) FILTER (WHERE auto_approved = TRUE) as auto_approved,
                COUNT(*) FILTER (WHERE ready_for_rag = FALSE AND review_status = 'approved' AND (cooling_until IS NULL OR cooling_until <= CURRENT_TIMESTAMP)) as ready_for_rag,
                COALESCE(AVG(ai_confidence_score) * 100, 0) as avg_confidence
            FROM processed_data
        `;
        const result = await this.pool.query(query);
        const row = result.rows[0];

        return {
            total: parseInt(row.total) || 0,
            pending: parseInt(row.pending) || 0,
            approved: parseInt(row.approved) || 0,
            rejected: parseInt(row.rejected) || 0,
            autoApproved: parseInt(row.auto_approved) || 0,
            readyForRag: parseInt(row.ready_for_rag) || 0,
            avgConfidence: parseFloat(row.avg_confidence)?.toFixed(1) || 0
        };
    }
}

module.exports = ProcessedDataRepository;
