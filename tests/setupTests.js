const { getGlobalTestClient, truncateAllTables } = require('./db');

/**
 * 每个测试前清空所有表数据
 */
beforeEach(async () => {
    const client = getGlobalTestClient();
    if (client) {
        await truncateAllTables(client);
    }
});
