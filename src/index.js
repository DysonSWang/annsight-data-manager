#!/usr/bin/env node
/**
 * AnnSight 数据全流程管理系统 - 主入口
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const dotenv = require('dotenv');

// 加载环境变量
dotenv.config();

const app = express();

// 中间件
app.use(helmet({
    contentSecurityPolicy: false, // 开发模式禁用 CSP
}));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// 数据库连接池
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'annsight',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// 将连接池附加到 app
app.locals.pool = pool;

// 测试数据库连接
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('❌ 数据库连接失败:', err.message);
    } else {
        console.log('✅ 数据库连接成功:', res.rows[0].now);
    }
});

// API 路由
const reviewRoutes = require('./routes/review');
app.use('/api/review', reviewRoutes);

// ETL 测试路由（用于 UAT）
const etlRoutes = require('./routes/etl');
app.use('/api/etl', etlRoutes);

// 源数据管理路由
const rawDataRoutes = require('./routes/raw-data');
app.use('/api/raw-data', rawDataRoutes);

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
    console.log('='.repeat(60));
    console.log(`🚀 AnnSight 数据审核平台已启动`);
    console.log(`📌 访问地址：http://localhost:${PORT}`);
    console.log(`📊 API 文档：http://localhost:${PORT}/api/health`);
    console.log('='.repeat(60));
});

// 优雅关闭
process.on('SIGTERM', () => {
    console.log('📌 正在关闭服务器...');
    pool.end(() => {
        console.log('✅ 数据库连接已关闭');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('📌 正在关闭服务器...');
    pool.end(() => {
        console.log('✅ 数据库连接已关闭');
        process.exit(0);
    });
});
