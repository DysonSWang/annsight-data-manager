const winston = require('winston');
const path = require('path');
const fs = require('fs');

// 确保日志目录存在
const logDir = path.join(__dirname, '..', '..', 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

// 定义日志格式
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaString = Object.keys(meta).length > 0 ? JSON.stringify(meta, null, 2) : '';
        return `${timestamp} [${level.toUpperCase()}]: ${message} ${metaString}`;
    })
);

// 创建 logger 实例
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    transports: [
        // 控制台输出
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                logFormat
            )
        }),
        // 错误日志文件
        new winston.transports.File({
            filename: path.join(logDir, 'error.log'),
            level: 'error',
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5
        }),
        // 所有日志文件
        new winston.transports.File({
            filename: path.join(logDir, 'combined.log'),
            maxsize: 10 * 1024 * 1024,
            maxFiles: 5
        }),
        // API 访问日志
        new winston.transports.File({
            filename: path.join(logDir, 'access.log'),
            level: 'http',
            maxsize: 10 * 1024 * 1024,
            maxFiles: 5
        })
    ]
});

/**
 * 日志工具类
 */
const logUtils = {
    /**
     * 记录 Info 级别日志
     */
    info(message, meta = {}) {
        logger.info(message, meta);
    },

    /**
     * 记录 Warn 级别日志
     */
    warn(message, meta = {}) {
        logger.warn(message, meta);
    },

    /**
     * 记录 Error 级别日志
     */
    error(message, error, meta = {}) {
        logger.error(message, {
            error: error.message,
            stack: error.stack,
            ...meta
        });
    },

    /**
     * 记录 Debug 级别日志
     */
    debug(message, meta = {}) {
        logger.debug(message, meta);
    },

    /**
     * 记录 HTTP 访问日志
     */
    http(message, meta = {}) {
        logger.log('http', message, meta);
    },

    /**
     * 创建请求日志中间件
     */
    requestLogger() {
        return (req, res, next) => {
            const start = Date.now();
            res.on('finish', () => {
                const duration = Date.now() - start;
                logger.log('http', `${req.method} ${req.originalUrl}`, {
                    status: res.statusCode,
                    duration: `${duration}ms`,
                    ip: req.ip,
                    userAgent: req.get('user-agent')
                });
            });
            next();
        };
    },

    /**
     * 创建错误处理中间件
     */
    errorHandler() {
        return (err, req, res, next) => {
            logger.error('Unhandled error', err, {
                path: req.path,
                method: req.method,
                body: req.body
            });

            // 生产环境不暴露详细错误
            const isProduction = process.env.NODE_ENV === 'production';

            res.status(err.status || 500).json({
                success: false,
                error: isProduction ? '服务器内部错误' : err.message,
                code: err.code || 'INTERNAL_ERROR',
                ...(isProduction ? {} : { stack: err.stack })
            });
        };
    }
};

module.exports = logUtils;
