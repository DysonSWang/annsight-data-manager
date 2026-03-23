/**
 * 审核轮次数据访问层
 */
class ReviewRoundRepository {
    constructor(pool) {
        this.pool = pool;
    }

    /**
     * 创建审核轮次记录
     */
    async create(round) {
        const query = `
            INSERT INTO review_rounds (
                task_id, data_id, round_number, round_type,
                ai_score, ai_dimension_scores, ai_feedback, ai_suggestions, ai_passed,
                optimized, optimization_result, optimization_applied,
                manual_reviewed, manual_decision, manual_reason, manual_reviewer
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
            )
            RETURNING *
        `;
        const values = [
            round.task_id,
            round.data_id,
            round.round_number,
            round.round_type || 'ai_review',
            round.ai_score || null,
            round.ai_dimension_scores ? JSON.stringify(round.ai_dimension_scores) : null,
            round.ai_feedback || null,
            round.ai_suggestions ? JSON.stringify(round.ai_suggestions) : null,
            round.ai_passed || null,
            round.optimized || false,
            round.optimization_result ? JSON.stringify(round.optimization_result) : null,
            round.optimization_applied || false,
            round.manual_reviewed || false,
            round.manual_decision || null,
            round.manual_reason || null,
            round.manual_reviewer || null
        ];
        const result = await this.pool.query(query, values);
        return result.rows[0];
    }

    /**
     * 根据 ID 查找轮次
     */
    async findById(id) {
        const query = `SELECT * FROM review_rounds WHERE id = $1`;
        const result = await this.pool.query(query, [id]);
        return this._parseRow(result.rows[0]);
    }

    /**
     * 查找数据的最新审核轮次
     */
    async findLatestForData(taskId, dataId) {
        const query = `
            SELECT * FROM review_rounds
            WHERE task_id = $1 AND data_id = $2
            ORDER BY round_number DESC
            LIMIT 1
        `;
        const result = await this.pool.query(query, [taskId, dataId]);
        return result.rows[0] ? this._parseRow(result.rows[0]) : null;
    }

    /**
     * 查找数据的所有审核轮次
     */
    async findAllForData(taskId, dataId) {
        const query = `
            SELECT * FROM review_rounds
            WHERE task_id = $1 AND data_id = $2
            ORDER BY round_number ASC
        `;
        const result = await this.pool.query(query, [taskId, dataId]);
        return result.rows.map(r => this._parseRow(r));
    }

    /**
     * 获取任务的审核轮次列表
     */
    async findByTask(taskId, options = {}) {
        const { dataId, roundType, page = 1, pageSize = 50 } = options;
        const offset = (parseInt(page) - 1) * parseInt(pageSize);

        let query = `SELECT * FROM review_rounds WHERE task_id = $1`;
        let values = [taskId];
        let paramIndex = 2;

        if (dataId) {
            query += ` AND data_id = $${paramIndex++}`;
            values.push(dataId);
        }

        if (roundType) {
            query += ` AND round_type = $${paramIndex++}`;
            values.push(roundType);
        }

        query += ` ORDER BY task_id, data_id, round_number LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        values.push(parseInt(pageSize), offset);

        const result = await this.pool.query(query, values);
        return {
            rows: result.rows.map(r => this._parseRow(r)),
            total: result.rowCount
        };
    }

    /**
     * 更新审核轮次
     */
    async update(id, updates) {
        const allowedFields = [
            'ai_score', 'ai_dimension_scores', 'ai_feedback', 'ai_suggestions', 'ai_passed',
            'optimized', 'optimization_result', 'optimization_applied',
            'manual_reviewed', 'manual_decision', 'manual_reason', 'manual_reviewer', 'manual_reviewed_at',
            'status', 'error_message'
        ];

        const updatesql = [];
        const values = [];
        let paramIndex = 1;

        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key)) {
                if (typeof value === 'object' && value !== null && !['Date', 'Error'].includes(value.constructor.name)) {
                    updatesql.push(`${key} = $${paramIndex}::jsonb`);
                } else {
                    updatesql.push(`${key} = $${paramIndex}`);
                }
                values.push(value);
                paramIndex++;
            }
        }

        if (updatesql.length === 0) {
            return this.findById(id);
        }

        updatesql.push(`updated_at = CURRENT_TIMESTAMP`);
        values.push(id);

        const query = `
            UPDATE review_rounds
            SET ${updatesql.join(', ')}
            WHERE id = $${paramIndex}
            RETURNING *
        `;
        const result = await this.pool.query(query, values);
        return result.rows[0] ? this._parseRow(result.rows[0]) : null;
    }

    /**
     * 批量创建轮次记录（用于初始化 AI 审核）
     */
    async batchCreate(rounds) {
        if (rounds.length === 0) return [];

        const values = [];
        const valTuples = [];
        let paramIndex = 1;

        for (const round of rounds) {
            valTuples.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
            values.push(
                round.task_id,
                round.data_id,
                round.round_number,
                round.round_type || 'ai_review',
                round.ai_score || null,
                round.ai_dimension_scores ? JSON.stringify(round.ai_dimension_scores) : null,
                round.ai_feedback || null,
                round.ai_suggestions ? JSON.stringify(round.ai_suggestions) : null,
                round.ai_passed || null,
                round.optimized || false,
                round.optimization_result ? JSON.stringify(round.optimization_result) : null,
                round.optimization_applied || false,
                round.manual_reviewed || false,
                round.manual_decision || null,
                round.manual_reason || null,
                round.manual_reviewer || null
            );
        }

        const query = `
            INSERT INTO review_rounds (
                task_id, data_id, round_number, round_type,
                ai_score, ai_dimension_scores, ai_feedback, ai_suggestions, ai_passed,
                optimized, optimization_result, optimization_applied,
                manual_reviewed, manual_decision, manual_reason, manual_reviewer
            ) VALUES ${valTuples.join(', ')}
            RETURNING *
        `;
        const result = await this.pool.query(query, values);
        return result.rows;
    }

    /**
     * 获取需要继续 AI 审核的数据
     */
    async getDataForNextReview(taskId, maxRounds) {
        const query = `
            SELECT DISTINCT rr.data_id, rr.round_number as current_round
            FROM review_rounds rr
            WHERE rr.task_id = $1
              AND rr.round_type = 'ai_review'
              AND rr.ai_score < (SELECT pass_threshold FROM finetuning_tasks WHERE id = $1)
              AND rr.round_number < $2
              AND NOT EXISTS (
                  SELECT 1 FROM review_rounds rr2
                  WHERE rr2.task_id = $1
                    AND rr2.data_id = rr.data_id
                    AND rr2.round_number = rr.round_number + 1
                    AND rr2.round_type = 'ai_review'
              )
        `;
        const result = await this.pool.query(query, [taskId, maxRounds]);
        return result.rows;
    }

    /**
     * 获取需要人工审核的数据
     */
    async getDataForManualReview(taskId, dataIds) {
        const query = `
            SELECT DISTINCT ON (rr.data_id) rr.*
            FROM review_rounds rr
            WHERE rr.task_id = $1
              AND rr.data_id = ANY($2)
              AND rr.round_type = 'ai_review'
              AND NOT rr.manual_reviewed
            ORDER BY rr.data_id, rr.round_number DESC
        `;
        const result = await this.pool.query(query, [taskId, dataIds]);
        return result.rows.map(r => this._parseRow(r));
    }

    /**
     * 统计审核进度
     */
    async getProgressStats(taskId) {
        const query = `
            SELECT
                COUNT(DISTINCT data_id) as total_records,
                COUNT(DISTINCT CASE WHEN round_type = 'ai_review' AND ai_score IS NOT NULL THEN data_id END) as ai_reviewed,
                COUNT(DISTINCT CASE WHEN round_type = 'ai_review' AND ai_score >= (SELECT pass_threshold FROM finetuning_tasks WHERE id = $1) THEN data_id END) as ai_passed,
                COUNT(DISTINCT CASE WHEN round_type = 'ai_review' AND ai_score < (SELECT pass_threshold FROM finetuning_tasks WHERE id = $1) THEN data_id END) as ai_failed,
                COUNT(DISTINCT CASE WHEN optimized = TRUE THEN data_id END) as optimized,
                COUNT(DISTINCT CASE WHEN manual_reviewed = TRUE THEN data_id END) as manual_reviewed
            FROM review_rounds
            WHERE task_id = $1
        `;
        const result = await this.pool.query(query, [taskId]);
        return result.rows[0];
    }

    /**
     * 解析行数据（处理 JSONB 字段）
     */
    _parseRow(row) {
        if (!row) return null;

        const parsed = { ...row };

        if (row.ai_dimension_scores && typeof row.ai_dimension_scores === 'string') {
            parsed.ai_dimension_scores = JSON.parse(row.ai_dimension_scores);
        }

        if (row.ai_suggestions && typeof row.ai_suggestions === 'string') {
            parsed.ai_suggestions = JSON.parse(row.ai_suggestions);
        }

        if (row.optimization_result && typeof row.optimization_result === 'string') {
            parsed.optimization_result = JSON.parse(row.optimization_result);
        }

        return parsed;
    }
}

module.exports = ReviewRoundRepository;
