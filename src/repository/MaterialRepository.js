/**
 * V9 素材仓库 - 负责 V9 素材数据的访问
 */
class MaterialRepository {
    constructor(pool) {
        this.pool = pool;
    }

    /**
     * 获取素材列表（支持筛选）
     * @param {Object} options - 查询选项
     * @param {string} options.type - 素材类型 (sft/rag/dpo/story)
     * @param {string} options.contentType - V9 分类 (A/B/C/D/E/F)
     * @param {string} options.status - 审核状态 (approved/pending/rejected)
     * @param {number} options.limit - 返回数量限制
     * @param {number} options.offset - 偏移量
     * @returns {Promise<Array>} 素材列表
     */
    async findList(options = {}) {
        const { type, contentType, status, limit = 50, offset = 0 } = options;

        const whereClauses = ["1=1"];
        const params = [];
        let paramIndex = 1;

        if (type) {
            whereClauses.push(`material_type = $${paramIndex++}`);
            params.push(type);
        }

        if (contentType) {
            whereClauses.push(`content_type = $${paramIndex++}`);
            params.push(contentType);
        }

        if (status) {
            whereClauses.push(`review_status = $${paramIndex++}`);
            params.push(status);
        }

        const whereSql = whereClauses.join(' AND ');

        const query = `
            SELECT
                id, type, category, title, content, material_type, content_type,
                source_video, source_timestamp, quality_score, review_status,
                created_at, updated_at
            FROM processed_data
            WHERE ${whereSql}
            ORDER BY created_at DESC
            LIMIT $${paramIndex++} OFFSET $${paramIndex++}
        `;

        params.push(limit, offset);

        const result = await this.pool.query(query, params);
        return result.rows;
    }

    /**
     * 获取素材统计
     * @returns {Promise<Object>} 统计数据
     */
    async getStats() {
        const query = `
            SELECT
                material_type,
                content_type,
                COUNT(*) as count,
                AVG(quality_score) as avg_quality
            FROM processed_data
            WHERE material_type IS NOT NULL
            GROUP BY material_type, content_type
            ORDER BY material_type, count DESC
        `;

        const result = await this.pool.query(query);
        const rows = result.rows;

        // 按类型汇总
        const byType = {};
        const byContentType = {};
        let total = 0;

        rows.forEach(row => {
            const type = row.material_type;
            const contentType = row.content_type;
            const count = parseInt(row.count);

            if (!byType[type]) {
                byType[type] = 0;
            }
            byType[type] += count;

            if (!byContentType[contentType]) {
                byContentType[contentType] = 0;
            }
            byContentType[contentType] += count;

            total += count;
        });

        return {
            total,
            byType,
            byContentType,
            details: rows.map(row => ({
                material_type: row.material_type,
                content_type: row.content_type,
                count: parseInt(row.count),
                avg_quality: parseFloat(row.avg_quality) || 0
            }))
        };
    }

    /**
     * 获取可导入微调任务的素材
     * @param {string} taskType - 任务类型 (sft/dpo)
     * @returns {Promise<Array>} 素材列表
     */
    async findAvailableForTask(taskType) {
        const query = `
            SELECT id, type, category, title, content, content_type, quality_score
            FROM processed_data
            WHERE material_type = $1
              AND review_status = 'approved'
            ORDER BY quality_score DESC NULLS LAST, created_at DESC
        `;

        const result = await this.pool.query(query, [taskType]);
        return result.rows;
    }

    /**
     * 批量更新素材类型
     * @param {Array<string>} ids - 素材 ID 列表
     * @param {Object} updates - 更新内容
     * @returns {Promise<number>} 更新的记录数
     */
    async batchUpdate(ids, updates) {
        const allowedFields = [
            'material_type', 'content_type', 'category', 'quality_score',
            'finetuning_task_id', 'review_status', 'used_in_finetuning'
        ];
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

        // 构建 WHERE id IN (...) 子句
        const idPlaceholders = ids.map((_, i) => `$${paramIndex + i}`).join(',');
        values.push(...ids);

        const query = `
            UPDATE processed_data
            SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE id IN (${idPlaceholders})
            RETURNING id
        `;

        const result = await this.pool.query(query, values);
        return result.rowCount;
    }

    /**
     * 通过 ID 获取素材详情
     * @param {string} id - 素材 ID
     * @returns {Promise<Object|undefined>} 素材详情
     */
    async findById(id) {
        const query = `
            SELECT
                pd.*,
                rdi.content_type as raw_content_type,
                rdi.source as raw_source,
                rdi.oss_url
            FROM processed_data pd
            LEFT JOIN raw_data_index rdi ON pd.raw_data_id = rdi.id
            WHERE pd.id = $1
        `;

        const result = await this.pool.query(query, [id]);
        return result.rows[0];
    }

    /**
     * 保存 V9 提取的素材（批量）
     * @param {Array<Object>} materials - 素材列表
     * @returns {Promise<Array>} 创建的记录
     */
    async saveBatch(materials) {
        const results = [];

        for (const material of materials) {
            const {
                id,
                rawDataId,
                materialType,
                contentType,
                sourceVideo,
                sourceTimestamp,
                qualityScore,
                type,
                category,
                title,
                content,
                tags,
                conversation
            } = material;

            const query = `
                INSERT INTO processed_data
                (id, raw_data_id, material_type, content_type, source_video, source_timestamp,
                 quality_score, type, category, title, content, tags, conversation, review_status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending')
                ON CONFLICT (id) DO UPDATE SET
                    material_type = EXCLUDED.material_type,
                    content_type = EXCLUDED.content_type,
                    source_video = EXCLUDED.source_video,
                    source_timestamp = EXCLUDED.source_timestamp,
                    quality_score = EXCLUDED.quality_score,
                    type = EXCLUDED.type,
                    category = EXCLUDED.category,
                    title = EXCLUDED.title,
                    content = EXCLUDED.content,
                    tags = EXCLUDED.tags,
                    conversation = EXCLUDED.conversation,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING *
            `;

            const params = [
                id,
                rawDataId || null,
                materialType,
                contentType,
                sourceVideo,
                sourceTimestamp,
                qualityScore,
                type,
                category,
                title,
                content,
                tags ? JSON.stringify(tags) : null,
                conversation ? JSON.stringify(conversation) : null
            ];

            const result = await this.pool.query(query, params);
            results.push(result.rows[0]);
        }

        return results;
    }

    /**
     * 删除素材
     * @param {string} id - 素材 ID
     * @returns {Promise<Object>} 删除的记录
     */
    async delete(id) {
        const query = `
            DELETE FROM processed_data
            WHERE id = $1
            RETURNING *
        `;

        const result = await this.pool.query(query, [id]);
        return result.rows[0];
    }

    /**
     * 获取质量分布
     * @returns {Promise<Object>} 质量分数分布
     */
    async getQualityDistribution() {
        const query = `
            SELECT
                material_type,
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE quality_score >= 0.9) as excellent,
                COUNT(*) FILTER (WHERE quality_score >= 0.8 AND quality_score < 0.8) as fair,
                COUNT(*) FILTER (WHERE quality_score < 0.6) as poor
            FROM processed_data
            WHERE material_type IS NOT NULL AND quality_score IS NOT NULL
            GROUP BY material_type
        `;

        const result = await this.pool.query(query);
        return result.rows;
    }

    /**
     * 按源数据 ID 聚合查看素材
     * @param {string} rawDataId - 源数据 ID
     * @returns {Promise<Object>} 源数据及其关联的素材列表
     */
    async findByRawDataId(rawDataId) {
        // 获取源数据详情
        const rawDataQuery = `
            SELECT id, content_type, source, batch_id, oss_url,
                   metadata->>'video_title' as video_title,
                   created_at
            FROM raw_data_index
            WHERE id = $1
        `;
        const rawDataResult = await this.pool.query(rawDataQuery, [rawDataId]);
        const rawData = rawDataResult.rows[0];

        if (!rawData) {
            return null;
        }

        // 获取关联的素材列表
        const materialsQuery = `
            SELECT
                id, material_type, content_type, type, category,
                title, content, source_video, source_timestamp,
                quality_score, review_status, created_at
            FROM processed_data
            WHERE raw_data_id = $1
            ORDER BY material_type, created_at DESC
        `;
        const materialsResult = await this.pool.query(materialsQuery, [rawDataId]);

        // 按素材类型分组统计
        const byType = {};
        materialsResult.rows.forEach(row => {
            if (!byType[row.material_type]) {
                byType[row.material_type] = [];
            }
            byType[row.material_type].push(row);
        });

        return {
            rawData,
            materials: materialsResult.rows,
            byType,
            stats: {
                total: materialsResult.rows.length,
                sft: byType.sft?.length || 0,
                rag: byType.rag?.length || 0,
                dpo: byType.dpo?.length || 0,
                story: byType.story?.length || 0,
                content: byType.content?.length || 0
            }
        };
    }

    /**
     * 获取按源数据聚合的素材列表（分页）
     * @param {Object} options - 查询选项
     * @param {string} options.materialType - 按素材类型筛选
     * @param {string} options.contentType - 按 V9 分类筛选
     * @param {number} options.limit - 每页数量
     * @param {number} options.offset - 偏移量
     * @returns {Promise<Object>} 聚合结果及分页信息
     */
    async findGroupedByRawData(options = {}) {
        const { materialType, contentType, limit = 20, offset = 0 } = options;

        const whereClauses = ['pd.raw_data_id IS NOT NULL'];
        const params = [];
        let paramIndex = 1;

        if (materialType) {
            whereClauses.push(`pd.material_type = $${paramIndex++}`);
            params.push(materialType);
        }

        if (contentType) {
            whereClauses.push(`pd.content_type = $${paramIndex++}`);
            params.push(contentType);
        }

        const whereSql = whereClauses.join(' AND ');

        // 获取按源数据分组的统计
        const groupQuery = `
            SELECT
                pd.raw_data_id,
                rdi.metadata->>'video_title' as video_title,
                COUNT(*) as material_count,
                COUNT(DISTINCT pd.material_type) as type_count,
                COUNT(DISTINCT pd.content_type) as content_type_count,
                AVG(pd.quality_score) as avg_quality,
                array_agg(DISTINCT pd.material_type) as material_types,
                array_agg(DISTINCT pd.content_type) as content_types
            FROM processed_data pd
            LEFT JOIN raw_data_index rdi ON pd.raw_data_id = rdi.id
            WHERE ${whereSql}
            GROUP BY pd.raw_data_id, rdi.metadata->>'video_title'
            ORDER BY material_count DESC, pd.raw_data_id
            LIMIT $${paramIndex++} OFFSET $${paramIndex++}
        `;

        params.push(limit, offset);

        const groupResult = await this.pool.query(groupQuery, params);

        // 获取总数 - 使用相同的参数但不包括 LIMIT 和 OFFSET
        const countQuery = `
            SELECT COUNT(DISTINCT pd.raw_data_id) as total
            FROM processed_data pd
            WHERE ${whereSql}
        `;
        const countParams = params.slice(0, params.length - 2);
        const countResult = await this.pool.query(countQuery, countParams);
        const total = parseInt(countResult.rows[0].total);

        return {
            groups: groupResult.rows.map(row => ({
                rawDataId: row.raw_data_id,
                videoTitle: row.video_title || '未知视频',
                materialCount: parseInt(row.material_count),
                typeCount: parseInt(row.type_count),
                contentTypes: row.content_types || [],
                materialTypes: row.material_types || [],
                avgQuality: parseFloat(row.avg_quality) || 0
            })),
            pagination: {
                total,
                page: Math.floor(offset / limit) + 1,
                pageSize: limit,
                totalPages: Math.ceil(total / limit)
            }
        };
    }
}

module.exports = MaterialRepository;
