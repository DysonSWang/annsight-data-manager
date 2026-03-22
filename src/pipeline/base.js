/**
 * Pipeline 处理器基类
 * 定义所有处理器的标准接口
 */

class BaseProcessor {
    /**
     * 处理器名称
     * @returns {string} 名称
     */
    getName() {
        throw new Error('必须实现 getName 方法');
    }

    /**
     * 处理数据
     * @param {object} context - 上下文数据
     * @returns {Promise<object>} 处理结果
     */
    async process(context) {
        throw new Error('必须实现 process 方法');
    }

    /**
     * 是否必须（失败时是否中断流程）
     * @returns {boolean} 是否必须
     */
    isRequired() {
        return true;
    }
}

module.exports = { BaseProcessor };
