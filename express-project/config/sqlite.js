/**
 * SQLite 数据库兼容层
 * 提供与 mysql2/promise 兼容的接口，用于 Kubeletto 等单容器部署环境
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// 数据库文件路径
const DB_PATH = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'app.db');

// 确保数据目录存在
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// 创建数据库连接
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// MySQL → SQLite SQL 转换
function transformSql(sql) {
  let result = sql;

  // SHA2(?, 256) → 替换为 ? 并在参数中处理
  // 我们用特殊标记，后续替换参数
  result = result.replace(/SHA2\(\s*\?\s*,\s*256\s*\)/gi, '?');

  // SHA2('literal', 256)
  result = result.replace(/SHA2\(\s*'([^']*)'\s*,\s*256\s*\)/gi, (match, p1) => {
    return `'${crypto.createHash('sha256').update(p1).digest('hex')}'`;
  });

  // 注意：DATE_SUB(NOW(), ...) 和 DATE_SUB(CURDATE(), ...) 必须在 NOW()/CURDATE() 单独替换之前处理，
  // 否则 NOW() 会被先替换为 CURRENT_TIMESTAMP，导致 DATE_SUB 正则匹配失败。

  // DATE_SUB(NOW(), INTERVAL ? HOUR) → datetime('now', ?)
  result = result.replace(/DATE_SUB\s*\(\s*NOW\s*\(\s*\)\s*,\s*INTERVAL\s+\?\s+HOUR\s*\)/gi,
    "datetime('now', '-' || ? || ' hours')");

  // DATE_SUB(NOW(), INTERVAL ? DAY)
  result = result.replace(/DATE_SUB\s*\(\s*NOW\s*\(\s*\)\s*,\s*INTERVAL\s+\?\s+DAY\s*\)/gi,
    "datetime('now', '-' || ? || ' days')");

  // DATE_SUB(NOW(), INTERVAL ? MINUTE)
  result = result.replace(/DATE_SUB\s*\(\s*NOW\s*\(\s*\)\s*,\s*INTERVAL\s+\?\s+MINUTE\s*\)/gi,
    "datetime('now', '-' || ? || ' minutes')");

  // DATE_SUB(CURDATE(), INTERVAL ? DAY)
  result = result.replace(/DATE_SUB\s*\(\s*CURDATE\s*\(\s*\)\s*,\s*INTERVAL\s+\?\s+DAY\s*\)/gi,
    "date('now', '-' || ? || ' days')");

  // NOW() → CURRENT_TIMESTAMP
  result = result.replace(/\bNOW\(\)/gi, 'CURRENT_TIMESTAMP');

  // INSERT IGNORE → INSERT OR IGNORE
  result = result.replace(/INSERT\s+IGNORE\s+INTO/gi, 'INSERT OR IGNORE INTO');

  // CURDATE() → date('now')
  result = result.replace(/\bCURDATE\s*\(\)/gi, "date('now')");

  // UNIX_TIMESTAMP() → strftime('%s','now')
  result = result.replace(/\bUNIX_TIMESTAMP\s*\(\)/gi, "CAST(strftime('%s','now') AS INTEGER)");

  // UNIX_TIMESTAMP(column) → CAST(strftime('%s', column) AS INTEGER)
  result = result.replace(/UNIX_TIMESTAMP\s*\(\s*(\w+)\s*\)/gi, "CAST(strftime('%s', $1) AS INTEGER)");

  // DATEDIFF(a, b) → CAST(julianday(a) - julianday(b) AS INTEGER)
  result = result.replace(/DATEDIFF\s*\(\s*(\?|\w+)\s*,\s*(\?|\w+)\s*\)/gi,
    'CAST(julianday($1) - julianday($2) AS INTEGER)');

  // CAST(? AS CHAR) → CAST(? AS TEXT)
  result = result.replace(/CAST\s*\(\s*\?\s+AS\s+CHAR\s*\)/gi, 'CAST(? AS TEXT)');

  // CAST(? AS SIGNED) → CAST(? AS INTEGER)
  result = result.replace(/CAST\s*\(\s*\?\s+AS\s+SIGNED\s*\)/gi, 'CAST(? AS INTEGER)');

  // JSON_EXTRACT(col, '$.key') → json_extract(col, '$.key') (SQLite has json_extract)
  // Already compatible, just lowercase
  result = result.replace(/JSON_EXTRACT/gi, 'json_extract');

  // JSON_UNQUOTE(JSON_EXTRACT(...)) → json_extract (SQLite returns text directly)
  result = result.replace(/JSON_UNQUOTE\s*\(\s*json_extract/gi, 'json_extract');
  // Remove trailing closing paren for JSON_UNQUOTE - this is tricky, handle common case
  // Actually this is complex, let's handle it differently

  // LIMIT ? OFFSET ? - same in SQLite

  // Backtick identifiers → double quotes
  result = result.replace(/`/g, '"');

  // GROUP_CONCAT with SEPARATOR - same syntax in SQLite

  // IFNULL - same in SQLite

  // REGEXP - SQLite doesn't have built-in REGEXP, but we can define it
  // Most queries use LIKE instead, so this should be fine

  // BOOLEAN literals: TRUE/FALSE → 1/0
  result = result.replace(/\bTRUE\b/gi, '1');
  result = result.replace(/\bFALSE\b/gi, '0');

  return result;
}

// 处理参数：SHA2(?, 256) 的参数需要哈希
function transformParams(sql, params) {
  if (!params) return params;

  // 找到所有 SHA2(?, 256) 的位置
  const sha2Regex = /SHA2\(\s*\?\s*,\s*256\s*\)/gi;
  const matches = [...sql.matchAll(sha2Regex)];

  if (matches.length === 0) return params;

  const paramArray = Array.isArray(params) ? params : [params];
  const result = [];
  let paramIndex = 0;

  // 简单方法：遍历原始SQL，找到 SHA2 占位符的位置
  // 由于我们已经知道有多少个 SHA2(?, 256)，我们需要在参数数组中
  // 找到对应的参数并哈希它们
  // SHA2(?, 256) 中的 ? 对应参数数组中的一个参数
  // 我们需要按顺序找到这些参数并哈希

  let searchIndex = 0;
  const sha2Positions = [];
  let match;
  const regex = /SHA2\(\s*\?\s*,\s*256\s*\)/gi;
  while ((match = regex.exec(sql)) !== null) {
    // 计算这个 SHA2 之前有多少个 ?
    const before = sql.substring(0, match.index);
    const questionMarkCount = (before.match(/\?/g) || []).length;
    sha2Positions.push(questionMarkCount);
  }

  for (let i = 0; i < paramArray.length; i++) {
    if (sha2Positions.includes(i)) {
      // 这个参数需要 SHA256 哈希
      result.push(crypto.createHash('sha256').update(String(paramArray[i])).digest('hex'));
    } else {
      result.push(paramArray[i]);
    }
  }

  return result;
}

// 执行 SQL 并返回 Promise<[rows, fields]>
function execute(sql, params = []) {
  try {
    const transformedSql = transformSql(sql);
    const transformedParams = transformParams(sql, params);

    const isSelect = /^\s*(SELECT|WITH|PRAGMA)/i.test(transformedSql);
    const isInsert = /^\s*INSERT/i.test(transformedSql);

    if (isSelect) {
      const stmt = db.prepare(transformedSql);
      const rows = stmt.all(...(transformedParams || []));
      return Promise.resolve([rows, []]);
    } else {
      const stmt = db.prepare(transformedSql);
      const result = stmt.run(...(transformedParams || []));
      if (isInsert) {
        return Promise.resolve([{ insertId: result.lastInsertRowid, affectedRows: result.changes }, []]);
      }
      return Promise.resolve([{ affectedRows: result.changes, insertId: result.lastInsertRowid }, []]);
    }
  } catch (err) {
    if (err.message.includes('already exists')) {
      return Promise.resolve([{ affectedRows: 0 }, []]);
    }
    return Promise.reject(err);
  }
}

// 查询（返回行）
function query(sql, params = []) {
  return execute(sql, params);
}

// 连接对象（用于事务）
function getConnection() {
  return {
    execute,
    query,
    beginTransaction: async () => { db.exec('BEGIN TRANSACTION'); },
    commit: async () => { db.exec('COMMIT'); },
    rollback: async () => { db.exec('ROLLBACK'); },
    release: () => {}
  };
}

// 初始化数据库表结构
function initializeSchema() {
  const schema = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      nickname TEXT NOT NULL,
      avatar TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      location TEXT DEFAULT '未知',
      follow_count INTEGER DEFAULT 0,
      fans_count INTEGER DEFAULT 0,
      like_count INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      last_login_at TEXT,
      email TEXT DEFAULT '',
      gender TEXT DEFAULT '',
      zodiac_sign TEXT DEFAULT '',
      mbti TEXT DEFAULT '',
      education TEXT DEFAULT '',
      major TEXT DEFAULT '',
      interests TEXT DEFAULT '[]',
      verified INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category_title TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      use_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT,
      content TEXT,
      category_id INTEGER,
      type INTEGER DEFAULT 1,
      status INTEGER DEFAULT 0,
      view_count INTEGER DEFAULT 0,
      like_count INTEGER DEFAULT 0,
      collect_count INTEGER DEFAULT 0,
      comment_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS post_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      image_url TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS post_videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      video_url TEXT NOT NULL,
      duration INTEGER,
      thumbnail TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      parent_id INTEGER,
      content TEXT NOT NULL,
      like_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      target_type INTEGER NOT NULL,
      target_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, target_type, target_id)
    );

    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      post_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, post_id)
    );

    CREATE TABLE IF NOT EXISTS follows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      follower_id INTEGER NOT NULL,
      following_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(follower_id, following_id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      sender_id INTEGER,
      type TEXT NOT NULL,
      title TEXT,
      content TEXT,
      target_id INTEGER,
      comment_id INTEGER,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL,
      refresh_token TEXT,
      expires_at TEXT,
      user_agent TEXT,
      ip_address TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      id TEXT PRIMARY KEY,
      admin_id INTEGER NOT NULL,
      token TEXT NOT NULL,
      refresh_token TEXT,
      expires_at TEXT,
      user_agent TEXT,
      ip_address TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      status INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS post_tags (
      post_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (post_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS email_verification_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      type TEXT DEFAULT 'register',
      used INTEGER DEFAULT 0,
      expires_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS site_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      config_key TEXT NOT NULL UNIQUE,
      config_value TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_ban (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      end_time TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      status INTEGER DEFAULT 0,
      operator INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_verification (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      type INTEGER NOT NULL,
      status INTEGER DEFAULT 0,
      real_name TEXT NOT NULL,
      id_card TEXT NOT NULL,
      contact_name TEXT,
      contact_phone TEXT,
      title TEXT,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
    CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
    CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category_id);
    CREATE INDEX IF NOT EXISTS idx_post_images_post ON post_images(post_id);
    CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
    CREATE INDEX IF NOT EXISTS idx_likes_user ON likes(user_id);
    CREATE INDEX IF NOT EXISTS idx_likes_target ON likes(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_collections_user ON collections(user_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
  `;

  db.exec(schema);
}

// 定义 REGEXP 函数
db.function('REGEXP', { deterministic: true }, (regex, text) => {
  if (!text) return 0;
  try {
    return new RegExp(regex).test(text) ? 1 : 0;
  } catch {
    return 0;
  }
});

initializeSchema();

// 兼容 mysql2/promise 的 pool 接口
const pool = {
  execute,
  query,
  getConnection: async () => getConnection(),
  end: async () => db.close()
};

module.exports = { pool, db, execute, query };
