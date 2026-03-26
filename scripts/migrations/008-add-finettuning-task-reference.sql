-- ============================================
-- AnnSight Data Manager - V9 素材关联微调任务
-- 版本：v1.2 (2026-03-26)
-- 说明：支持 V9 素材导入到微调任务
-- ============================================

-- 为 processed_data 表添加 finetuning_task_id 字段
DO $$
BEGIN
    -- 添加 finetuning_task_id 字段
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'processed_data' AND column_name = 'finetuning_task_id'
    ) THEN
        ALTER TABLE processed_data
        ADD COLUMN finetuning_task_id VARCHAR(64) REFERENCES finetuning_tasks(id) ON DELETE SET NULL;

        -- 添加索引
        CREATE INDEX idx_pd_finetuning_task ON processed_data(finetuning_task_id);
    END IF;

    -- 添加 used_in_finetuning 字段（如果不存在）
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'processed_data' AND column_name = 'used_in_finetuning'
    ) THEN
        ALTER TABLE processed_data
        ADD COLUMN used_in_finetuning BOOLEAN DEFAULT FALSE;

        CREATE INDEX idx_pd_used_in_finetuning ON processed_data(used_in_finetuning);
    END IF;
END $$;

-- 说明：
-- 1. finetuning_task_id: 关联到微调任务，当素材被导入到某个任务时设置
-- 2. used_in_finetuning: 标记该素材是否已被用于微调任务
-- 3. 外键约束：ON DELETE SET NULL 表示任务删除时，素材的 task_id 置空而不是删除素材
