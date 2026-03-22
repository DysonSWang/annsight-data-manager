const { getTestPool, runMigrations, truncateAllTables, closeTestPool, setGlobalTestClient } = require('./db');

let globalTestClient = null;

/**
 * Jest 全局 setup - 在所有测试之前执行
 */
async function setup() {
    console.log('🔧 Setting up test database...');

    const pool = getTestPool();

    try {
        // 获取一个专用客户端用于初始化
        globalTestClient = await pool.connect();
        setGlobalTestClient(globalTestClient);

        // 运行迁移创建表结构
        console.log('📦 Running database migrations...');
        await runMigrations(globalTestClient);
        console.log('✅ Database migrations complete');

    } catch (error) {
        console.error('❌ Setup failed:', error);
        throw error;
    }
}

/**
 * Jest 全局 teardown - 在所有测试之后执行
 */
async function teardown() {
    console.log('🧹 Cleaning up test database...');

    try {
        if (globalTestClient) {
            globalTestClient.release();
        }
        await closeTestPool();
        console.log('✅ Cleanup complete');
    } catch (error) {
        console.error('❌ Teardown failed:', error);
    }
}

// globalSetup 必须导出 default 函数
module.exports = setup;
module.exports.teardown = teardown;
