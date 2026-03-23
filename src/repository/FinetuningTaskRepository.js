const { v4: uuidv4 } = require('uuid');

/**
 * 微调任务数据访问层
 */
class FinetuningTaskRepository {
    constructor(pool) {
        this.pool = pool;
    }

    /**
     * 创建微调任务
     */
    async create(task) {
        const query = `
            INSERT INTO finetuning_tasks (
                id, name, purpose, pass_threshold, max_review_rounds,
                manual_review_enabled, manual_review_scope, batch_id, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `;
        const values = [
            task.id || `ft-${uuidv4()}`,
            task.name,
            task.purpose,
            task.pass_threshold || 0.90,
            task.max_review_rounds || 2,
            task.manual_review_enabled || false,
            task.manual_review_scope || 'failed',
            task.batch_id,
            task.created_by || 'admin'
        ];
        const result = await this.pool.query(query, values);
        return result.rows[0];
    }

    /**
     * 根据 ID 查找任务
     */
    async findById(id) {
        const query = `SELECT * FROM finetuning_tasks WHERE id = $1`;
        const result = await this.pool.query(query, [id]);
        return result.rows[0];
    }

    /**
     * 根据批次 ID 查找任务
     */
    async findByBatchId(batchId) {
        const query = `SELECT * FROM finetuning_tasks WHERE batch_id = $1 ORDER BY created_at DESC`;
        const result = await this.pool.query(query, [batchId]);
        return result.rows;
    }

    /**
     * 获取任务列表
     */
    async findAll(options = {}) {
        const { status, page = 1, pageSize = 20 } = options;
        const offset = (parseInt(page) - 1) * parseInt(pageSize);

        let query = `SELECT * FROM finetuning_tasks`;
        let values = [];
        let whereClauses = [];

        if (status) {
            whereClauses.push(`status = $${values.length + 1}`);
            values.push(status);
        }

        if (whereClauses.length > 0) {
            query += ` WHERE ${whereClauses.join(' AND ')}`;
        }

        query += ` ORDER BY created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
        values.push(parseInt(pageSize), offset);

        const result = await this.pool.query(query, values);
        return result.rows;
    }

    /**
     * 更新任务状态
     */
    async updateStatus(id, status) {
        const query = `
            UPDATE finetuning_tasks
            SET status = $1::VARCHAR(32), updated_at = CURRENT_TIMESTAMP,
                started_at = CASE WHEN $1::VARCHAR(32) != 'pending' AND started_at IS NULL THEN CURRENT_TIMESTAMP ELSE started_at END,
                completed_at = CASE WHEN $1::VARCHAR(32) = 'completed' THEN CURRENT_TIMESTAMP ELSE completed_at END
            WHERE id = $2
            RETURNING *
        `;
        const result = await this.pool.query(query, [status, id]);
        return result.rows[0];
    }

    /**
     * 更新任务
     */
    async update(id, updates) {
        const allowedFields = ['name', 'purpose', 'pass_threshold', 'max_review_rounds', 'manual_review_enabled', 'manual_review_scope', 'status', 'batch_id'];
        const updatesql = [];
        const values = [];
        let paramIndex = 1;

        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key)) {
                updatesql.push(`${key} = $${paramIndex++}`);
                values.push(value);
            }
        }

        if (updatesql.length === 0) {
            return this.findById(id);
        }

        updatesql.push(`updated_at = CURRENT_TIMESTAMP`);
        values.push(id);

        const query = `
            UPDATE finetuning_tasks
            SET ${updatesql.join(', ')}
            WHERE id = $${paramIndex}
            RETURNING *
        `;
        const result = await this.pool.query(query, values);
        return result.rows[0];
    }

    /**
     * 删除任务
     */
    async delete(id) {
        const query = `DELETE FROM finetuning_tasks WHERE id = $1 RETURNING *`;
        const result = await this.pool.query(query, [id]);
        return result.rows[0];
    }

    /**
     * 获取任务统计
     */
    async getStats(id) {
        const query = `
            SELECT
                ft.id,
                ft.name,
                ft.status,
                ft.pass_threshold,
                ft.max_review_rounds,
                COUNT(DISTINCT rr.data_id) AS total_data,
                COUNT(DISTINCT CASE WHEN rr.ai_score IS NOT NULL THEN rr.data_id END) AS reviewed_data,
                COUNT(DISTINCT CASE WHEN rr.ai_score >= ft.pass_threshold THEN rr.data_id END) AS passed_data,
                COUNT(DISTINCT CASE WHEN rr.ai_score < ft.pass_threshold THEN rr.data_id END) AS failed_data,
                COUNT(DISTINCT CASE WHEN rr.optimized = TRUE THEN rr.data_id END) AS optimized_data,
                COUNT(DISTINCT CASE WHEN rr.manual_reviewed = TRUE THEN rr.data_id END) AS manual_reviewed_data,
                COALESCE(AVG(rr.ai_score), 0) AS avg_score
            FROM finetuning_tasks ft
            LEFT JOIN review_rounds rr ON ft.id = rr.task_id
            WHERE ft.id = $1
            GROUP BY ft.id, ft.name, ft.status, ft.pass_threshold, ft.max_review_rounds
        `;
        const result = await this.pool.query(query, [id]);
        return result.rows[0];
    }

    /**
     * 获取需要进行人工审核的数据 ID 列表
     */
    async getDataForManualReview(taskId, scope = 'failed') {
        let query;
        if (scope === 'all') {
            // 全量审核：所有已完成 AI 审核的数据
            query = `
                SELECT DISTINCT rr.data_id
                FROM review_rounds rr
                WHERE rr.task_id = $1
                  AND rr.round_type = 'ai_review'
                  AND rr.ai_score IS NOT NULL
                  AND NOT rr.manual_reviewed
            `;
        } else {
            // 仅失败：AI 审核未通过的数据
            query = `
                SELECT DISTINCT rr.data_id
                FROM review_rounds rr
                WHERE rr.task_id = $1
                  AND rr.round_type = 'ai_review'
                  AND rr.ai_score < (SELECT pass_threshold FROM finetuning_tasks WHERE id = $1)
                  AND NOT rr.manual_reviewed
            `;
        }
        const result = await this.pool.query(query, [taskId]);
        return result.rows.map(r => r.data_id);
    }

    /**
     * 检查任务是否允许开始审核
     */
    async canStartReview(taskId) {
        const task = await this.findById(taskId);
        if (!task) {
            return { can: false, reason: '任务不存在' };
        }
        if (task.status === 'completed') {
            return { can: false, reason: '任务已完成' };
        }
        if (task.status === 'exported') {
            return { can: false, reason: '任务已导出，无法再审核' };
        }

        // 检查是否有数据
        const dataQuery = `SELECT COUNT(*) FROM processed_data WHERE batch_id = $1`;
        const dataResult = await this.pool.query(dataQuery, [task.batch_id]);
        const count = parseInt(dataResult.rows[0].count);

        if (count === 0) {
            return { can: false, reason: '任务中没有数据' };
        }

        return { can: true, dataCount: count };
    }
}

module.exports = FinetuningTaskRepository;
