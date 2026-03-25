/**
 * 审核反馈日志仓库 - 用于积累人工审核时的修改建议
 */
class ReviewFeedbackLogRepository {
    constructor(pool) {
        this.pool = pool;
    }

    /**
     * 创建反馈日志记录
     * @param {Object} log - 反馈日志
     * @param {string} log.task_id - 任务 ID
     * @param {string} log.data_id - 数据 ID
     * @param {string} log.suggestion_type - 建议类型：human_optimization / ai_feedback / user_correction
     * @param {string} log.original_prompt - 原提示词标识
     * @param {string} log.user_feedback - 用户反馈/修改建议
     * @param {Object} log.optimization_result - 优化结果 { before, after, changes }
     * @param {string} log.created_by - 创建人
     * @returns {Promise<Object>} 创建的记录
     */
    async create(log) {
        const {
            task_id,
            data_id,
            suggestion_type,
            original_prompt = null,
            user_feedback = null,
            optimization_result = null,
            created_by = 'admin'
        } = log;

        const query = `
            INSERT INTO review_feedback_logs
            (task_id, data_id, suggestion_type, original_prompt, user_feedback, optimization_result, created_by)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
            RETURNING *
        `;

        const params = [
            task_id,
            data_id,
            suggestion_type,
            original_prompt,
            user_feedback,
            optimization_result ? JSON.stringify(optimization_result) : null,
            created_by
        ];

        const result = await this.pool.query(query, params);
        return result.rows[0];
    }

    /**
     * 查询任务下的反馈日志
     * @param {string} taskId - 任务 ID
     * @param {Object} options - 查询选项
     * @param {string} options.suggestionType - 按类型过滤
     * @param {boolean} options.notApplied - 是否只查询未应用到提示词的记录
     * @returns {Promise<Array>} 反馈日志列表
     */
    async findByTaskId(taskId, options = {}) {
        const { suggestionType = null, notApplied = false } = options;

        let query = `
            SELECT * FROM review_feedback_logs
            WHERE task_id = $1
        `;
        const params = [taskId];
        let paramCount = 1;

        if (suggestionType) {
            paramCount++;
            query += ` AND suggestion_type = $${paramCount}`;
            params.push(suggestionType);
        }

        if (notApplied) {
            query += ' AND applied_to_prompt = FALSE';
        }

        query += ' ORDER BY created_at DESC';

        const result = await this.pool.query(query, params);
        return result.rows;
    }

    /**
     * 查询单个数据的反馈日志
     * @param {string} dataId - 数据 ID
     * @returns {Promise<Array>} 反馈日志列表
     */
    async findByDataId(dataId) {
        const query = `
            SELECT * FROM review_feedback_logs
            WHERE data_id = $1
            ORDER BY created_at DESC
        `;
        const result = await this.pool.query(query, [dataId]);
        return result.rows;
    }

    /**
     * 标记反馈日志已应用到提示词
     * @param {number} id - 日志 ID
     * @returns {Promise<Object>} 更新的记录
     */
    async markAsApplied(id) {
        const query = `
            UPDATE review_feedback_logs
            SET applied_to_prompt = TRUE
            WHERE id = $1
            RETURNING *
        `;
        const result = await this.pool.query(query, [id]);
        return result.rows[0];
    }

    /**
     * 批量标记已应用
     * @param {number[]} ids - 日志 ID 列表
     * @returns {Promise<number>} 更新的记录数
     */
    async batchMarkAsApplied(ids) {
        const query = `
            UPDATE review_feedback_logs
            SET applied_to_prompt = TRUE
            WHERE id = ANY($1)
        `;
        const result = await this.pool.query(query, [ids]);
        return result.rowCount;
    }

    /**
     * 删除反馈日志
     * @param {number} id - 日志 ID
     * @returns {Promise<void>}
     */
    async delete(id) {
        const query = `
            DELETE FROM review_feedback_logs
            WHERE id = $1
        `;
        await this.pool.query(query, [id]);
    }

    /**
     * 获取统计信息
     * @param {string} taskId - 任务 ID
     * @returns {Promise<Object>} 统计信息
     */
    async getStats(taskId) {
        const query = `
            SELECT
                suggestion_type,
                COUNT(*) as total,
                SUM(CASE WHEN applied_to_prompt THEN 1 ELSE 0 END) as applied_count
            FROM review_feedback_logs
            WHERE task_id = $1
            GROUP BY suggestion_type
        `;
        const result = await this.pool.query(query, [taskId]);
        return result.rows;
    }
}

module.exports = ReviewFeedbackLogRepository;
