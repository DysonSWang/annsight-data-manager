/**
 * 统一状态机管理服务
 * 管理数据审核流程中的所有状态转换
 *
 * 状态流转图：
 *
 * pending ──→ [AI 审核] ──→ approved (AI 通过) ──→ [人工审核] ──→ 最终 approved
 *               │                                  │
 *               │                                  └──→ 拒绝 ──→ rejected
 *               │
 *               └──→ failed (AI 失败) ──→ [优化] ──→ 重新审核
 *                                      │
 *                                      └──→ [人工审核] ──→ approved / rejected
 */

const logger = require('../utils/logger');

// 定义所有可能的状态
const REVIEW_STATES = {
    // 初始状态
    PENDING: 'pending',

    // AI 审核状态
    AI_REVIEWING: 'ai_reviewing',
    AI_APPROVED: 'ai_approved',
    AI_FAILED: 'ai_failed',
    AI_OPTIMIZING: 'ai_optimizing',

    // 人工审核状态
    MANUAL_REVIEW_PENDING: 'manual_review_pending',
    MANUAL_REVIEWING: 'manual_reviewing',
    MANUALLY_APPROVED: 'manually_approved',
    MANUALLY_REJECTED: 'manually_rejected',

    // 最终状态
    FINAL_APPROVED: 'final_approved',
    REJECTED: 'rejected',

    // 异常状态
    ERROR: 'error'
};

// 定义审核流程状态（review_flow_status）
const FLOW_STATES = {
    // 初始状态
    INITIAL: 'initial',

    // AI 审核中
    AI_REVIEW_IN_PROGRESS: 'ai_review_in_progress',

    // AI 审核完成
    AI_APPROVED_FLOW: 'ai_approved',      // AI 通过，可能需要人工审核
    AI_FAILED_FLOW: 'ai_failed',          // AI 失败，可能需要人工审核或优化

    // AI 优化完成
    AI_OPTIMIZED: 'ai_optimized',         // 已优化，等待重新审核或人工审核

    // 人工审核中
    MANUAL_REVIEW_IN_PROGRESS: 'manual_review_in_progress',

    // 人工审核完成
    MANUALLY_APPROVED_FLOW: 'manually_approved',
    MANUALLY_REJECTED_FLOW: 'manually_rejected',

    // 最终状态
    COMPLETED: 'completed',               // 审核通过，可以进入下一流程
    REJECTED_FLOW: 'rejected'             // 审核拒绝
};

// 定义允许的状态转换
const STATE_TRANSITIONS = {
    // 初始状态可以转换到
    [REVIEW_STATES.PENDING]: [
        REVIEW_STATES.AI_REVIEWING,
        REVIEW_STATES.MANUAL_REVIEW_PENDING,
        REVIEW_STATES.REJECTED
    ],

    // AI 审核中可以转换到
    [REVIEW_STATES.AI_REVIEWING]: [
        REVIEW_STATES.AI_APPROVED,
        REVIEW_STATES.AI_FAILED,
        REVIEW_STATES.ERROR
    ],

    // AI 通过后可以转换到
    [REVIEW_STATES.AI_APPROVED]: [
        REVIEW_STATES.MANUAL_REVIEW_PENDING,
        REVIEW_STATES.FINAL_APPROVED,
        REVIEW_STATES.REJECTED
    ],

    // AI 失败后可以转换到
    [REVIEW_STATES.AI_FAILED]: [
        REVIEW_STATES.AI_OPTIMIZING,
        REVIEW_STATES.MANUAL_REVIEW_PENDING,
        REVIEW_STATES.REJECTED
    ],

    // AI 优化中可以转换到
    [REVIEW_STATES.AI_OPTIMIZING]: [
        REVIEW_STATES.AI_REVIEWING,
        REVIEW_STATES.MANUAL_REVIEW_PENDING,
        REVIEW_STATES.ERROR
    ],

    // 待人工审核可以转换到
    [REVIEW_STATES.MANUAL_REVIEW_PENDING]: [
        REVIEW_STATES.MANUAL_REVIEWING,
        REVIEW_STATES.FINAL_APPROVED,
        REVIEW_STATES.REJECTED
    ],

    // 人工审核中可以转换到
    [REVIEW_STATES.MANUAL_REVIEWING]: [
        REVIEW_STATES.MANUALLY_APPROVED,
        REVIEW_STATES.MANUALLY_REJECTED,
        REVIEW_STATES.ERROR
    ],

    // 人工批准后可以转换到
    [REVIEW_STATES.MANUALLY_APPROVED]: [
        REVIEW_STATES.FINAL_APPROVED
    ],

    // 人工拒绝后可以转换到
    [REVIEW_STATES.MANUALLY_REJECTED]: [
        REVIEW_STATES.REJECTED,
        REVIEW_STATES.AI_OPTIMIZING  // 允许人工拒绝后再次优化
    ],

    // 最终批准是终止状态
    [REVIEW_STATES.FINAL_APPROVED]: [],

    // 拒绝是终止状态（除非允许重新审核）
    [REVIEW_STATES.REJECTED]: [
        REVIEW_STATES.PENDING  // 允许重新开始流程
    ],

    // 错误状态可以重试
    [REVIEW_STATES.ERROR]: [
        REVIEW_STATES.PENDING,
        REVIEW_STATES.AI_REVIEWING,
        REVIEW_STATES.MANUAL_REVIEW_PENDING
    ]
};

// 定义流程状态转换
const FLOW_TRANSITIONS = {
    [FLOW_STATES.INITIAL]: [
        FLOW_STATES.AI_REVIEW_IN_PROGRESS,
        FLOW_STATES.MANUAL_REVIEW_IN_PROGRESS,
        FLOW_STATES.REJECTED_FLOW
    ],
    [FLOW_STATES.AI_REVIEW_IN_PROGRESS]: [
        FLOW_STATES.AI_APPROVED_FLOW,
        FLOW_STATES.AI_FAILED_FLOW,
        FLOW_STATES.REJECTED_FLOW
    ],
    [FLOW_STATES.AI_APPROVED_FLOW]: [
        FLOW_STATES.MANUAL_REVIEW_IN_PROGRESS,
        FLOW_STATES.COMPLETED
    ],
    [FLOW_STATES.AI_FAILED_FLOW]: [
        FLOW_STATES.AI_OPTIMIZED,
        FLOW_STATES.MANUAL_REVIEW_IN_PROGRESS,
        FLOW_STATES.REJECTED_FLOW
    ],
    [FLOW_STATES.AI_OPTIMIZED]: [
        FLOW_STATES.AI_REVIEW_IN_PROGRESS,
        FLOW_STATES.MANUAL_REVIEW_IN_PROGRESS,
        FLOW_STATES.REJECTED_FLOW
    ],
    [FLOW_STATES.MANUAL_REVIEW_IN_PROGRESS]: [
        FLOW_STATES.MANUALLY_APPROVED_FLOW,
        FLOW_STATES.MANUALLY_REJECTED_FLOW
    ],
    [FLOW_STATES.MANUALLY_APPROVED_FLOW]: [
        FLOW_STATES.COMPLETED
    ],
    [FLOW_STATES.MANUALLY_REJECTED_FLOW]: [
        FLOW_STATES.AI_OPTIMIZED,
        FLOW_STATES.REJECTED_FLOW
    ],
    [FLOW_STATES.COMPLETED]: [],
    [FLOW_STATES.REJECTED_FLOW]: [
        FLOW_STATES.INITIAL  // 允许重新开始
    ]
};

/**
 * 状态机服务
 */
class ReviewStateMachine {
    /**
     * 验证状态转换是否合法
     * @param {string} currentState - 当前状态
     * @param {string} nextState - 下一个状态
     * @returns {Object} { valid: boolean, error?: string }
     */
    static canTransition(currentState, nextState) {
        const allowedTransitions = STATE_TRANSITIONS[currentState];

        if (!allowedTransitions) {
            return {
                valid: false,
                error: `未知状态：${currentState}`
            };
        }

        if (!allowedTransitions.includes(nextState)) {
            return {
                valid: false,
                error: `不允许的状态转换：${currentState} → ${nextState}`
            };
        }

        return { valid: true };
    }

    /**
     * 验证流程状态转换是否合法
     * @param {string} currentState - 当前流程状态
     * @param {string} nextState - 下一个流程状态
     * @returns {Object} { valid: boolean, error?: string }
     */
    static canTransitionFlow(currentState, nextState) {
        const allowedTransitions = FLOW_TRANSITIONS[currentState];

        if (!allowedTransitions) {
            return {
                valid: false,
                error: `未知流程状态：${currentState}`
            };
        }

        if (!allowedTransitions.includes(nextState)) {
            return {
                valid: false,
                error: `不允许的流程状态转换：${currentState} → ${nextState}`
            };
        }

        return { valid: true };
    }

    /**
     * 获取当前状态可以转换到的所有状态
     * @param {string} currentState - 当前状态
     * @returns {string[]} 允许的下一个状态列表
     */
    static getNextStates(currentState) {
        return STATE_TRANSITIONS[currentState] || [];
    }

    /**
     * 获取当前流程状态可以转换到的所有状态
     * @param {string} currentState - 当前流程状态
     * @returns {string[]} 允许的下一个流程状态列表
     */
    static getNextFlowStates(currentState) {
        return FLOW_TRANSITIONS[currentState] || [];
    }

    /**
     * 检查是否是终止状态
     * @param {string} state - 状态
     * @returns {boolean}
     */
    static isTerminalState(state) {
        const terminalStates = [
            REVIEW_STATES.FINAL_APPROVED,
            REVIEW_STATES.REJECTED
        ];
        return terminalStates.includes(state);
    }

    /**
     * 检查是否是终止流程状态
     * @param {string} flowState - 流程状态
     * @returns {boolean}
     */
    static isTerminalFlowState(flowState) {
        const terminalFlowStates = [
            FLOW_STATES.COMPLETED,
            FLOW_STATES.REJECTED_FLOW
        ];
        return terminalFlowStates.includes(flowState);
    }

    /**
     * 获取状态的人类可读名称
     * @param {string} state - 状态
     * @returns {string}
     */
    static getStateLabel(state) {
        const labels = {
            [REVIEW_STATES.PENDING]: '待审核',
            [REVIEW_STATES.AI_REVIEWING]: 'AI 审核中',
            [REVIEW_STATES.AI_APPROVED]: 'AI 通过',
            [REVIEW_STATES.AI_FAILED]: 'AI 失败',
            [REVIEW_STATES.AI_OPTIMIZING]: 'AI 优化中',
            [REVIEW_STATES.MANUAL_REVIEW_PENDING]: '待人工审核',
            [REVIEW_STATES.MANUAL_REVIEWING]: '人工审核中',
            [REVIEW_STATES.MANUALLY_APPROVED]: '人工批准',
            [REVIEW_STATES.MANUALLY_REJECTED]: '人工拒绝',
            [REVIEW_STATES.FINAL_APPROVED]: '最终批准',
            [REVIEW_STATES.REJECTED]: '已拒绝',
            [REVIEW_STATES.ERROR]: '错误'
        };
        return labels[state] || state;
    }

    /**
     * 获取流程状态的人类可读名称
     * @param {string} flowState - 流程状态
     * @returns {string}
     */
    static getFlowLabel(flowState) {
        const labels = {
            [FLOW_STATES.INITIAL]: '初始状态',
            [FLOW_STATES.AI_REVIEW_IN_PROGRESS]: 'AI 审核中',
            [FLOW_STATES.AI_APPROVED_FLOW]: 'AI 通过',
            [FLOW_STATES.AI_FAILED_FLOW]: 'AI 失败',
            [FLOW_STATES.AI_OPTIMIZED]: '已优化',
            [FLOW_STATES.MANUAL_REVIEW_IN_PROGRESS]: '人工审核中',
            [FLOW_STATES.MANUALLY_APPROVED_FLOW]: '人工批准',
            [FLOW_STATES.MANUALLY_REJECTED_FLOW]: '人工拒绝',
            [FLOW_STATES.COMPLETED]: '已完成',
            [FLOW_STATES.REJECTED_FLOW]: '已拒绝'
        };
        return labels[flowState] || flowState;
    }

    /**
     * 获取状态的优先级（用于排序）
     * @param {string} state - 状态
     * @returns {number} 优先级数值，越小越靠前
     */
    static getStatePriority(state) {
        const priorities = {
            [REVIEW_STATES.PENDING]: 0,
            [REVIEW_STATES.AI_REVIEWING]: 1,
            [REVIEW_STATES.AI_APPROVED]: 2,
            [REVIEW_STATES.AI_FAILED]: 2,
            [REVIEW_STATES.AI_OPTIMIZING]: 3,
            [REVIEW_STATES.MANUAL_REVIEW_PENDING]: 4,
            [REVIEW_STATES.MANUAL_REVIEWING]: 5,
            [REVIEW_STATES.MANUALLY_APPROVED]: 6,
            [REVIEW_STATES.MANUALLY_REJECTED]: 6,
            [REVIEW_STATES.FINAL_APPROVED]: 7,
            [REVIEW_STATES.REJECTED]: 7,
            [REVIEW_STATES.ERROR]: -1
        };
        return priorities[state] || 0;
    }
}

/**
 * 审核进度跟踪服务
 */
class ReviewProgressTracker {
    constructor(pool) {
        this.pool = pool;
    }

    /**
     * 获取批次的审核进度
     * @param {string} batchId - 批次 ID
     * @returns {Promise<Object>}
     */
    async getBatchProgress(batchId) {
        const query = `
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE ai_review_status = 'approved') as ai_approved,
                COUNT(*) FILTER (WHERE ai_review_status = 'failed') as ai_failed,
                COUNT(*) FILTER (WHERE manual_review_status = 'approved') as manually_approved,
                COUNT(*) FILTER (WHERE manual_review_status = 'rejected') as manually_rejected,
                COUNT(*) FILTER (WHERE review_flow_status = 'completed') as completed,
                COUNT(*) FILTER (WHERE review_flow_status = 'rejected') as rejected
            FROM raw_data_index
            WHERE batch_id = $1 AND status != 'duplicate'
        `;

        const result = await this.pool.query(query, [batchId]);
        const row = result.rows[0];

        return {
            batchId,
            total: parseInt(row.total),
            aiApproved: parseInt(row.ai_approved),
            aiFailed: parseInt(row.ai_failed),
            manuallyApproved: parseInt(row.manually_approved),
            manuallyRejected: parseInt(row.manually_rejected),
            completed: parseInt(row.completed),
            rejected: parseInt(row.rejected),
            aiPassRate: parseInt(row.total) > 0
                ? ((parseInt(row.ai_approved) / parseInt(row.total)) * 100).toFixed(1) + '%'
                : '0%',
            finalPassRate: parseInt(row.total) > 0
                ? ((parseInt(row.completed) / parseInt(row.total)) * 100).toFixed(1) + '%'
                : '0%',
            progress: parseInt(row.total) > 0
                ? Math.round(((parseInt(row.completed) + parseInt(row.rejected)) / parseInt(row.total)) * 100) + '%'
                : '0%'
        };
    }

    /**
     * 获取数据的详细状态
     * @param {string} dataId - 数据 ID
     * @returns {Promise<Object>}
     */
    async getDataStatus(dataId) {
        const query = `
            SELECT
                id,
                ai_review_status,
                ai_review_score,
                ai_review_rounds,
                manual_review_status,
                manual_review_decision,
                review_flow_status,
                status
            FROM raw_data_index
            WHERE id = $1
        `;

        const result = await this.pool.query(query, [dataId]);

        if (!result.rows.length) {
            return null;
        }

        const row = result.rows[0];
        return {
            dataId: row.id,
            reviewStatus: row.ai_review_status,
            reviewScore: row.ai_review_score,
            reviewRounds: row.ai_review_rounds || 0,
            manualReviewStatus: row.manual_review_status,
            manualDecision: row.manual_review_decision,
            flowStatus: row.review_flow_status,
            dataStatus: row.status,
            isTerminal: ReviewStateMachine.isTerminalFlowState(row.review_flow_status)
        };
    }

    /**
     * 获取待处理项目数量
     * @param {string} batchId - 批次 ID
     * @returns {Promise<Object>}
     */
    async getPendingCounts(batchId) {
        const query = `
            SELECT
                COUNT(*) FILTER (WHERE ai_review_status IS NULL OR ai_review_status = 'pending') as ai_pending,
                COUNT(*) FILTER (
                    WHERE ai_review_status = 'failed'
                    AND (manual_review_status IS NULL OR manual_review_status = 'pending')
                ) as manual_pending_failed,
                COUNT(*) FILTER (
                    WHERE ai_review_status = 'approved'
                    AND (manual_review_status IS NULL OR manual_review_status = 'pending')
                ) as manual_pending_approved
            FROM raw_data_index
            WHERE batch_id = $1 AND status != 'duplicate'
        `;

        const result = await this.pool.query(query, [batchId]);
        const row = result.rows[0];

        return {
            batchId,
            aiPending: parseInt(row.ai_pending),
            manualPendingFailed: parseInt(row.manual_pending_failed),
            manualPendingApproved: parseInt(row.manual_pending_approved),
            totalManualPending: parseInt(row.manual_pending_failed) + parseInt(row.manual_pending_approved)
        };
    }
}

module.exports = {
    REVIEW_STATES,
    FLOW_STATES,
    STATE_TRANSITIONS,
    FLOW_TRANSITIONS,
    ReviewStateMachine,
    ReviewProgressTracker
};
