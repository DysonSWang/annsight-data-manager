-- ============================================
-- AnnSight Data Manager - 添加用途字段
-- 版本：v1.1 (2026-03-22)
-- 说明：支持 RAG/微调/内容创作 多用途标记
-- ============================================

-- 添加 purpose 字段（逗号分隔的多选值）
-- 可选值：rag, finetuning, content_creation
ALTER TABLE processed_data ADD COLUMN IF NOT EXISTS purposes VARCHAR(64) DEFAULT '';

-- 添加索引用于按用途筛选
CREATE INDEX IF NOT EXISTS idx_pd_purposes ON processed_data(purposes);

-- 说明：
-- purposes 字段存储示例：
-- 'rag'              - 仅用于 RAG 知识库
-- 'rag,finetuning'   - 既用于 RAG 也用于微调
-- 'finetuning,content_creation' - 用于微调和内容创作
-- 'rag,finetuning,content_creation' - 三种用途都有

-- 更新现有数据（默认都用于 RAG）
UPDATE processed_data SET purposes = 'rag' WHERE purposes = '' AND used_in_rag = TRUE;
UPDATE processed_data SET purposes = 'finetuning' WHERE purposes = '' AND used_in_finetuning = TRUE;
UPDATE processed_data SET purposes = 'rag,finetuning' WHERE purposes = '' AND used_in_rag = TRUE AND used_in_finetuning = TRUE;
