// 启动诊断脚本 - 逐步加载模块以定位崩溃点
console.log('[startup] 1. Node.js 启动成功, version:', process.version);
console.log('[startup] 2. 工作目录:', process.cwd());
console.log('[startup] 3. DB_TYPE:', process.env.DB_TYPE);
console.log('[startup] 4. PORT:', process.env.PORT);

// 确保 data 目录存在
const fs = require('fs');
const path = require('path');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
console.log('[startup] 5. data 目录已就绪');

// 尝试加载 better-sqlite3
try {
  console.log('[startup] 6. 正在加载 better-sqlite3...');
  const Database = require('better-sqlite3');
  console.log('[startup] 7. better-sqlite3 加载成功');
  // 测试创建数据库
  const testDb = new Database(path.join(dataDir, 'test.db'));
  testDb.exec('CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY)');
  testDb.close();
  console.log('[startup] 8. SQLite 数据库测试通过');
} catch (err) {
  console.error('[startup] !!! better-sqlite3 加载失败:', err.message);
  console.error(err.stack);
  process.exit(1);
}

// 加载配置
try {
  console.log('[startup] 9. 正在加载 config...');
  const config = require('./config/config');
  console.log('[startup] 10. config 加载成功');
} catch (err) {
  console.error('[startup] !!! config 加载失败:', err.message);
  console.error(err.stack);
  process.exit(1);
}

// 启动应用
console.log('[startup] 11. 正在启动应用...');
require('./app.js');
