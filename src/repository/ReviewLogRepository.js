/**
 * 审核日志仓库 - 负责 review_logs 表的 CRUD 操作
 */
class ReviewLogRepository {
    constructor(pool) {
        this.pool = pool;
    }

    /**
     * 创建审核日志
     * @param {Object} log - 审核日志
     * @param {string} log.dataId - 数据 ID
     * @param {string} log.reviewerId - 审核人 ID
     * @param {string} log.action - 操作 (create/update/approve/reject/skip/spot_check_correct)
     * @param {Object} [log.oldValue] - 旧值 (JSONB)
     * @param {Object} [log.newValue] - 新值 (JSONB)
     * @param {string} log.result - 结果 (approved/rejected/skipped/corrected)
     * @param {string} [log.ipAddress] - IP 地址
     * @param {boolean} [log.isSpotCheck] - 是否为抽检
     * @returns {Promise<Object>} 创建的日志
     */
    async create(log) {
        const {
            dataId,
            reviewerId,
            action,
            oldValue,
            newValue,
            resultValue,
            ipAddress,
            isSpotCheck = false
        } = log;

        // 验证必填字段
        if (!dataId || !reviewerId || !action || !resultValue) {
            throw new Error('Missing required fields: dataId, reviewerId, action, result');
        }

        const query = `
            INSERT INTO review_logs
            (data_id, reviewer_id, action, old_value, new_value, result, ip_address, is_spot_check)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `;

        const queryResult = await this.pool.query(query, [
            dataId,
            reviewerId,
            action,
            oldValue ? JSON.stringify(oldValue) : null,
            newValue ? JSON.stringify(newValue) : null,
            resultValue,
            ipAddress || null,
            isSpotCheck
        ]);

        return queryResult.rows[0];
    }

    /**
     * 通过数据 ID 查找日志
     * @param {string} dataId - 数据 ID
     * @returns {Promise<Array>} 日志列表
     */
    async findByDataId(dataId) {
        const query = `
            SELECT * FROM review_logs
            WHERE data_id = $1
            ORDER BY created_at DESC
        `;
        const result = await this.pool.query(query, [dataId]);
        return result.rows;
    }

    /**
     * 通过审核人 ID 查找日志
     * @param {string} reviewerId - 审核人 ID
     * @returns {Promise<Array>} 日志列表
     */
    async findByReviewerId(reviewerId) {
        const query = `
            SELECT * FROM review_logs
            WHERE reviewer_id = $1
            ORDER BY created_at DESC
        `;
        const result = await this.pool.query(query, [reviewerId]);
        return result.rows;
    }

    /**
     * 查找抽检日志
     * @returns {Promise<Array>} 抽检日志列表
     */
    async findSpotChecks() {
        const query = `
            SELECT * FROM review_logs
            WHERE is_spot_check = TRUE
            ORDER BY created_at DESC
        `;
        const result = await this.pool.query(query);
        return result.rows;
    }

    /**
     * 获取 AI 准确率统计
     * @returns {Promise<Object>} 统计数据
     */
    async getAccuracyStats() {
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
        const stats = await this.getAccuracyStats();

        let recommendedThreshold = currentThreshold;
        const accuracy = stats.accuracy ? Number(stats.accuracy) : 1.0;

        if (accuracy < 0.85) {
            recommendedThreshold = Math.min(0.95, currentThreshold + 0.05);
        } else if (accuracy > 0.95) {
            recommendedThreshold = Math.max(0.75, currentThreshold - 0.05);
        }

        return {
            currentThreshold,
            accuracy,
            recommendedThreshold,
            stats: {
                total_spot_checks: Number(stats.total_spot_checks),
                corrections: Number(stats.corrections)
            }
        };
    }

    /**
     * 按操作类型统计
     * @param {string} action - 操作类型
     * @returns {Promise<Object>} 统计数据
     */
    async countByAction(action) {
        const query = `
            SELECT COUNT(*) as count
            FROM review_logs
            WHERE action = $1
        `;
        const result = await this.pool.query(query, [action]);
        return Number(result.rows[0].count);
    }

    /**
     * 获取审核人活动统计
     * @param {string} reviewerId - 审核人 ID
     * @returns {Promise<Object>} 统计数据
     */
    async getReviewerStats(reviewerId) {
        const query = `
            SELECT
                COUNT(*) as total_reviews,
                SUM(CASE WHEN result = 'approved' THEN 1 ELSE 0 END) as approved_count,
                SUM(CASE WHEN result = 'rejected' THEN 1 ELSE 0 END) as rejected_count,
                SUM(CASE WHEN is_spot_check = TRUE THEN 1 ELSE 0 END) as spot_check_count
            FROM review_logs
            WHERE reviewer_id = $1
        `;
        const result = await this.pool.query(query, [reviewerId]);
        return result.rows[0];
    }
}

module.exports = ReviewLogRepository;
