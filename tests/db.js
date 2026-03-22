const { Pool } = require('pg');

// 测试数据库配置
const testConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.TEST_DB_NAME || 'annsight_data_test',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
};

// 测试专用数据库连接池
let testPool = null;

// 全局测试客户端（由 setup 创建）
let globalTestClient = null;

/**
 * 获取测试数据库连接池
 */
function getTestPool() {
    if (!testPool) {
        testPool = new Pool(testConfig);

        // 监听错误
        testPool.on('error', (err) => {
            console.error('Unexpected error on idle test client', err);
        });
    }
    return testPool;
}

/**
 * 设置全局测试客户端（由 setup.js 调用）
 */
function setGlobalTestClient(client) {
    globalTestClient = client;
}

/**
 * 获取全局测试客户端
 */
function getGlobalTestClient() {
    return globalTestClient;
}

/**
 * 关闭测试数据库连接池
 */
async function closeTestPool() {
    if (testPool) {
        await testPool.end();
        testPool = null;
    }
}

/**
 * 在事务中执行测试（自动回滚）
 * 确保测试之间数据隔离
 */
async function withTransaction(fn) {
    const pool = getTestPool();
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const result = await fn(client);

        await client.query('ROLLBACK');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * 清空所有表（用于测试重置）
 */
async function truncateAllTables(client) {
    const tables = [
        'review_logs',
        'fingerprint_index',
        'processed_data',
        'raw_data_index',
        'users'
    ];

    for (const table of tables) {
        await client.query(`TRUNCATE TABLE ${table} CASCADE`);
    }
}

/**
 * 运行数据库迁移
 */
async function runMigrations(client) {
    const fs = require('fs');
    const path = require('path');

    const migrationPath = path.join(__dirname, '../scripts/migrations/001-initial-schema.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');

    await client.query(migrationSql);
}

module.exports = {
    getTestPool,
    closeTestPool,
    withTransaction,
    truncateAllTables,
    runMigrations,
    setGlobalTestClient,
    getGlobalTestClient
};
