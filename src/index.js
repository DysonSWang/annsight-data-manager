#!/usr/bin/env node
/**
 * AnnSight 数据全流程管理系统 - 主入口
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const dotenv = require('dotenv');
const logger = require('./utils/logger');

// 加载环境变量
dotenv.config();

const app = express();

// 中间件
app.use(helmet({
    contentSecurityPolicy: false, // 开发模式禁用 CSP
}));
app.use(cors());
app.use(express.json({ limit: '50mb' })); // 增加请求体大小限制
app.use(express.static(path.join(__dirname, '..', 'public')));

// 请求日志中间件（使用 Winston）
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger.http(`${req.method} ${req.path}`, {
            status: res.statusCode,
            duration: `${duration}ms`,
            ip: req.ip,
            userAgent: req.get('user-agent')
        });
    });
    next();
});

// 数据库连接池
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// 将连接池附加到 app
app.locals.pool = pool;

// 测试数据库连接
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        logger.error('❌ 数据库连接失败', err, { path: 'src/index.js' });
    } else {
        logger.info('✅ 数据库连接成功', { timestamp: res.rows[0].now });
    }
});

// 认证路由（公开）
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

// API 路由（需要认证）
const authMiddleware = require('./middleware/auth');

const reviewRoutes = require('./routes/review');
app.use('/api/review', authMiddleware.optional, reviewRoutes);

// ETL 测试路由（用于 UAT）
const etlRoutes = require('./routes/etl');
app.use('/api/etl', authMiddleware.optional, etlRoutes);

// 源数据管理路由
const rawDataRoutes = require('./routes/raw-data');
app.use('/api/raw-data', authMiddleware.optional, rawDataRoutes);

// 微调任务路由
const finetuningRoutes = require('./routes/finetuning');
app.use('/api/finetuning', authMiddleware.optional, finetuningRoutes);

// V9 素材管理路由
const materialsRoutes = require('./routes/materials');
app.use('/api/materials', authMiddleware.optional, materialsRoutes);

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 前端路由 - 特定页面
app.get('/stats.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'stats.html'));
});

app.get('/spotcheck.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'spotcheck.html'));
});

app.get('/raw-data.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'raw-data.html'));
});

// 根路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// 统计摘要 API（支持 purposes 筛选）
app.get('/api/review/stats/summary', async (req, res) => {
    try {
        const { purposes } = req.query;

        let whereClause = '';
        if (purposes) {
            const purposeList = purposes.split(',');
            const conditions = purposeList.map(p => `purposes LIKE '%${p}%'`).join(' OR ');
            whereClause = `WHERE ${conditions}`;
        }

        const stats = await pool.query(`
            SELECT
                COUNT(*) FILTER (WHERE review_status = 'pending') as pending,
                COUNT(*) FILTER (WHERE review_status = 'approved') as approved,
                COUNT(*) FILTER (WHERE review_status = 'rejected') as rejected,
                COALESCE(AVG(ai_confidence_score) * 100, 0) as avg_confidence
            FROM processed_data
            ${whereClause}
        `);

        const row = stats.rows[0];
        res.json({
            pending: parseInt(row.pending) || 0,
            approved: parseInt(row.approved) || 0,
            rejected: parseInt(row.rejected) || 0,
            accuracy: parseFloat(row.avg_confidence)?.toFixed(1) || 0
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.json({ pending: 0, approved: 0, rejected: 0, accuracy: 0 });
    }
});

// 启动服务器
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    logger.info('🚀 AnnSight 数据审核平台已启动', {
        port: PORT,
        url: `http://localhost:${PORT}`,
        healthUrl: `http://localhost:${PORT}/api/health`
    });
});

// 优雅关闭
process.on('SIGTERM', () => {
    logger.info('📌 正在关闭服务器...');
    pool.end(() => {
        logger.info('✅ 数据库连接已关闭');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    logger.info('📌 正在关闭服务器...');
    pool.end(() => {
        logger.info('✅ 数据库连接已关闭');
        process.exit(0);
    });
});
