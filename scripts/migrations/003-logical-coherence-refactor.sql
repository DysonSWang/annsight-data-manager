-- ============================================
-- AnnSight Data Manager - 逻辑连贯性重构
-- 版本：v1.2 (2026-03-24)
-- 说明：
--   1. 源数据只读，一次上传多处复用
--   2. 微调任务只能导入审核通过的数据
--   3. 裂变属于微调环节，根据任务目的执行
--   4. 任务数据隔离，每个任务有专属批次
-- ============================================

-- ============================================
-- 1. processed_data 表新增字段
-- ============================================

-- 来源追踪字段
ALTER TABLE processed_data
ADD COLUMN IF NOT EXISTS source_data_id VARCHAR(64);
COMMENT ON COLUMN processed_data.source_data_id IS '复制来源的数据 ID（从其他任务导入时记录）';

ALTER TABLE processed_data
ADD COLUMN IF NOT EXISTS source_task_id VARCHAR(64);
COMMENT ON COLUMN processed_data.source_task_id IS '复制来源的任务 ID（从其他任务导入时记录）';

-- 任务上下文和裂变配置（微调环节专用）
ALTER TABLE processed_data
ADD COLUMN IF NOT EXISTS task_context JSONB;
COMMENT ON COLUMN processed_data.task_context IS '任务上下文，包含微调目的等信息';

ALTER TABLE processed_data
ADD COLUMN IF NOT EXISTS fission_config JSONB;
COMMENT ON COLUMN processed_data.fission_config IS '裂变配置（微调环节专用）';

-- 新增索引
CREATE INDEX IF NOT EXISTS idx_pd_source_data ON processed_data(source_data_id);
CREATE INDEX IF NOT EXISTS idx_pd_source_task ON processed_data(source_task_id);

-- ============================================
-- 2. finetuning_tasks 表新增字段
-- ============================================

-- 裂变配置字段
ALTER TABLE finetuning_tasks
ADD COLUMN IF NOT EXISTS fission_enabled BOOLEAN DEFAULT FALSE;
COMMENT ON COLUMN finetuning_tasks.fission_enabled IS '是否启用裂变';

ALTER TABLE finetuning_tasks
ADD COLUMN IF NOT EXISTS fission_count INT DEFAULT 6;
COMMENT ON COLUMN finetuning_tasks.fission_count IS '裂变数量';

ALTER TABLE finetuning_tasks
ADD COLUMN IF NOT EXISTS fission_requirement TEXT;
COMMENT ON COLUMN finetuning_tasks.fission_requirement IS '裂变需求说明';

-- ============================================
-- 3. 清空测试数据（用户确认）
-- ============================================
-- 注意：以下操作会清空所有测试数据，仅保留表结构

-- 先删除外键依赖
TRUNCATE TABLE review_rounds CASCADE;
TRUNCATE TABLE finetuning_tasks CASCADE;
TRUNCATE TABLE processed_data CASCADE;
TRUNCATE TABLE raw_data_index CASCADE;
TRUNCATE TABLE fingerprint_index CASCADE;
TRUNCATE TABLE review_logs CASCADE;

-- 重置序列
ALTER SEQUENCE review_rounds_id_seq RESTART WITH 1;
ALTER SEQUENCE review_logs_id_seq RESTART WITH 1;

-- ============================================
-- 4. 恢复基础数据
-- ============================================
-- 重新插入默认管理员用户（如果不存在）
INSERT INTO users (id, username, password_hash, role)
VALUES ('admin-001', 'admin', '$2b$10$rMx9YQYxQYxQYxQYxQYxQuRZQxQYxQYxQYxQYxQYxQYxQYxQYxQ', 'admin')
ON CONFLICT (username) DO NOTHING;

-- ============================================
-- 迁移完成
-- ============================================
