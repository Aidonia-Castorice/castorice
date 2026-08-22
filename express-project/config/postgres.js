/**
 * PostgreSQL 数据库兼容层
 * 提供与 mysql2/promise 兼容的接口，用于 PandaStack PostgreSQL 部署
 */
const { Pool } = require('pg');
const crypto = require('crypto');

const DATABASE_URL = process.env.DATABASE_URL || process.env.PG_URL;

let pool = null;
let initPromise = null;

function getPool() {
  if (pool) return pool;
  const config = DATABASE_URL
    ? { connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : {
        host: process.env.PG_HOST || 'localhost',
        port: process.env.PG_PORT || 5432,
        user: process.env.PG_USER || 'postgres',
        password: process.env.PG_PASSWORD || '',
        database: process.env.PG_DATABASE || 'postgres',
        ssl: { rejectUnauthorized: false }
      };
  pool = new Pool(config);
  pool.on('error', (err) => console.error('[pg] Pool error:', err.message));
  return pool;
}

async function initDatabase() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const p = getPool();
    // 启用 pgcrypto 扩展（用于 SHA256）
    try { await p.query('CREATE EXTENSION IF NOT EXISTS pgcrypto'); } catch (e) { console.log('[pg] pgcrypto:', e.message); }
    await initializeSchema();
    console.log('[pg] Database initialized');
    return p;
  })();
  return initPromise;
}

/**
 * 将 MySQL 语法转换为 PostgreSQL 语法
 */
function transformSql(sql) {
  let result = sql;

  // 反引号 -> 双引号
  result = result.replace(/`/g, '"');

  // SHA2(?, 256) -> encode(digest($n, 'sha256'), 'hex')
  // 注意：需要在参数转换时处理，这里先标记
  result = result.replace(/SHA2\(\s*\?\s*,\s*256\s*\)/gi, 'SHA2_MARKER(?)');
  result = result.replace(/SHA2\(\s*'([^']*)'\s*,\s*256\s*\)/gi, (m, p1) => `'${crypto.createHash('sha256').update(p1).digest('hex')}'`);

  // NOW() -> NOW() (PostgreSQL 支持，保持不变)
  // CURDATE() -> CURRENT_DATE
  result = result.replace(/\bCURDATE\s*\(\s*\)/gi, 'CURRENT_DATE');

  // UNIX_TIMESTAMP() -> EXTRACT(EPOCH FROM NOW())::INTEGER
  result = result.replace(/\bUNIX_TIMESTAMP\s*\(\s*\)/gi, "EXTRACT(EPOCH FROM NOW())::INTEGER");
  result = result.replace(/UNIX_TIMESTAMP\s*\(\s*(\w+)\s*\)/gi, "EXTRACT(EPOCH FROM $1)::INTEGER");

  // INSERT IGNORE INTO -> INSERT INTO ... ON CONFLICT DO NOTHING
  // 这个比较复杂，需要特殊处理
  result = result.replace(/INSERT\s+IGNORE\s+INTO/gi, 'INSERT INTO');

  // LEAST/GREATEST -> LEAST/GREATEST (PostgreSQL 支持)

  // DATE_SUB(NOW(), INTERVAL ? HOUR) -> NOW() - ($1 || ' hours')::INTERVAL
  result = result.replace(/DATE_SUB\s*\(\s*NOW\s*\(\s*\)\s*,\s*INTERVAL\s+\?\s+HOUR\s*\)/gi, "NOW() - (? || ' hours')::INTERVAL");
  result = result.replace(/DATE_SUB\s*\(\s*NOW\s*\(\s*\)\s*,\s*INTERVAL\s+\?\s+DAY\s*\)/gi, "NOW() - (? || ' days')::INTERVAL");
  result = result.replace(/DATE_SUB\s*\(\s*NOW\s*\(\s*\)\s*,\s*INTERVAL\s+\?\s+MINUTE\s*\)/gi, "NOW() - (? || ' minutes')::INTERVAL");
  result = result.replace(/DATE_SUB\s*\(\s*CURDATE\s*\(\s*\)\s*,\s*INTERVAL\s+\?\s+DAY\s*\)/gi, "CURRENT_DATE - (? || ' days')::INTERVAL");

  // DATE_ADD(NOW(), INTERVAL N DAY) -> NOW() + (N || ' days')::INTERVAL
  result = result.replace(/DATE_ADD\s*\(\s*NOW\s*\(\s*\)\s*,\s*INTERVAL\s+(\d+)\s+(DAY|HOUR|MINUTE|SECOND)\s*\)/gi, (m, num, unit) => {
    const u = {DAY:'days',HOUR:'hours',MINUTE:'minutes',SECOND:'seconds'};
    return `NOW() + ('${num} ${u[unit.toUpperCase()]||'days'}')::INTERVAL`;
  });

  // TIMESTAMPDIFF(HOUR, col, NOW()) -> EXTRACT(EPOCH FROM (NOW() - col))::INTEGER / 3600
  result = result.replace(/TIMESTAMPDIFF\s*\(\s*HOUR\s*,\s*([^,]+?)\s*,\s*(NOW\(\)|CURRENT_TIMESTAMP|[^,)]+?)\s*\)/gi, "EXTRACT(EPOCH FROM ($2 - $1))::INTEGER / 3600");

  // DATEDIFF(a, b) -> (a::date - b::date)
  result = result.replace(/DATEDIFF\s*\(\s*(\?|\w+)\s*,\s*(\?|\w+)\s*\)/gi, '($1::date - $2::date)');

  // CAST(? AS CHAR) -> $1::TEXT
  result = result.replace(/CAST\s*\(\s*\?\s+AS\s+CHAR\s*\)/gi, '?::TEXT');
  result = result.replace(/CAST\s*\(\s*\?\s+AS\s+SIGNED\s*\)/gi, '?::INTEGER');

  // IFNULL -> COALESCE
  result = result.replace(/\bIFNULL\s*\(/gi, 'COALESCE(');

  // TRUE/FALSE -> TRUE/FALSE (PostgreSQL 支持)

  // JSON_EXTRACT -> json_extract (PostgreSQL 不支持，需要用 ->>)
  result = result.replace(/JSON_EXTRACT\s*\(\s*([^,]+?)\s*,\s*'([^']+)'\s*\)/gi, "$1->>'$2'");
  result = result.replace(/JSON_UNQUOTE\s*\(\s*/gi, '');

  // LIMIT ?, ? -> LIMIT $1 OFFSET $2 (参数顺序需要调整)
  // 这个在参数转换时处理

  return result;
}

/**
 * 将 ? 占位符转换为 $1, $2, ...
 * 同时处理参数数组展开和 SHA2 标记
 */
function convertParams(sql, params) {
  let resultSql = sql;
  let resultParams = [];

  if (!params || params.length === 0) {
    // 没有参数，直接替换 SHA2 标记
    resultSql = resultSql.replace(/SHA2_MARKER\(\?\)/g, "encode(digest('', 'sha256'), 'hex')");
    return { sql: resultSql, params: [] };
  }

  const paramArray = Array.isArray(params) ? params : [params];
  let paramIndex = 0;
  let pgIndex = 1;

  // 展开数组参数
  const flatParams = [];
  for (const p of paramArray) {
    if (Array.isArray(p)) flatParams.push(...p);
    else flatParams.push(p);
  }

  // 替换 ? 为 $n，同时处理数组展开和 SHA2 标记
  let inString = false;
  let stringChar = '';
  let output = '';

  for (let i = 0; i < resultSql.length; i++) {
    const char = resultSql[i];

    if (inString) {
      output += char;
      if (char === stringChar && resultSql[i-1] !== '\\') inString = false;
      continue;
    }

    if (char === "'" || char === '"') {
      inString = true;
      stringChar = char;
      output += char;
      continue;
    }

    if (char === '?') {
      // 检查是否是 SHA2_MARKER(?)
      if (output.endsWith('SHA2_MARKER(')) {
        // SHA2 参数
        const p = flatParams[paramIndex];
        const hash = crypto.createHash('sha256').update(String(p)).digest('hex');
        output = output.slice(0, -'SHA2_MARKER('.length) + `'${hash}'`;
        // 跳过后面的 )
        let j = i + 1;
        while (j < resultSql.length && resultSql[j] !== ')') j++;
        i = j; // 跳过 )
        paramIndex++;
      } else {
        // 普通参数
        output += `$${pgIndex}`;
        resultParams.push(flatParams[paramIndex]);
        pgIndex++;
        paramIndex++;
      }
    } else {
      output += char;
    }
  }

  // 处理 LIMIT ?, ? 顺序问题：MySQL 是 LIMIT offset, count，PostgreSQL 是 LIMIT count OFFSET offset
  // 这个比较复杂，暂时不处理，假设代码中使用的是 LIMIT ? OFFSET ? 格式

  return { sql: output, params: resultParams };
}

async function execute(sql, params = []) {
  await initDatabase();
  const p = getPool();

  try {
    let transformedSql = transformSql(sql);
    const { sql: pgSql, params: pgParams } = convertParams(transformedSql, params);

    const isSelect = /^\s*(SELECT|WITH|PRAGMA|SHOW|EXPLAIN)/i.test(pgSql);
    const isInsert = /^\s*INSERT/i.test(pgSql);

    // 对于 INSERT，添加 RETURNING id 以获取 insertId
    let finalSql = pgSql;
    if (isInsert && !/RETURNING/i.test(pgSql)) {
      finalSql = pgSql + ' RETURNING id';
    }

    const result = await p.query(finalSql, pgParams);

    if (isSelect) {
      return [result.rows, result.fields || []];
    } else if (isInsert) {
      const insertId = result.rows.length > 0 ? result.rows[0].id : 0;
      return [{ insertId, affectedRows: result.rowCount }, []];
    } else {
      return [{ affectedRows: result.rowCount, insertId: 0 }, []];
    }
  } catch (err) {
    if (err.message && (err.message.includes('already exists') || err.message.includes('duplicate key') || err.message.includes('UNIQUE constraint'))) {
      return [{ affectedRows: 0, insertId: 0 }, []];
    }
    console.error('[pg] SQL Error:', err.message);
    console.error('[pg] SQL:', sql.substring(0, 200));
    return Promise.reject(err);
  }
}

async function query(sql, params = []) {
  return execute(sql, params);
}

function getConnection() {
  return {
    execute,
    query,
    beginTransaction: async () => {
      await initDatabase();
      const p = getPool();
      const client = await p.connect();
      await client.query('BEGIN');
      return {
        execute: async (sql, params = []) => {
          let transformedSql = transformSql(sql);
          const { sql: pgSql, params: pgParams } = convertParams(transformedSql, params);
          const result = await client.query(pgSql, pgParams);
          if (/^\s*(SELECT|WITH)/i.test(pgSql)) return [result.rows, []];
          return [{ affectedRows: result.rowCount, insertId: 0 }, []];
        },
        query: async (sql, params = []) => {
          let transformedSql = transformSql(sql);
          const { sql: pgSql, params: pgParams } = convertParams(transformedSql, params);
          const result = await client.query(pgSql, pgParams);
          if (/^\s*(SELECT|WITH)/i.test(pgSql)) return [result.rows, []];
          return [{ affectedRows: result.rowCount, insertId: 0 }, []];
        },
        commit: async () => { await client.query('COMMIT'); client.release(); },
        rollback: async () => { await client.query('ROLLBACK'); client.release(); },
        release: () => { client.release(); }
      };
    },
    commit: async () => {},
    rollback: async () => {},
    release: () => {}
  };
}

async function initializeSchema() {
  const p = getPool();

  const schema = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
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
      last_login_at TIMESTAMP,
      email TEXT DEFAULT '',
      gender TEXT DEFAULT '',
      zodiac_sign TEXT DEFAULT '',
      mbti TEXT DEFAULT '',
      education TEXT DEFAULT '',
      major TEXT DEFAULT '',
      interests TEXT DEFAULT '[]',
      verified INTEGER DEFAULT 0,
      is_bot INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_login_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category_title TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tags (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      use_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS post_images (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL,
      image_url TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS post_videos (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL,
      video_url TEXT NOT NULL,
      cover_url TEXT,
      duration INTEGER,
      thumbnail TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      parent_id INTEGER,
      content TEXT NOT NULL,
      like_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS likes (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      target_type INTEGER NOT NULL,
      target_id INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, target_type, target_id)
    );

    CREATE TABLE IF NOT EXISTS collections (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      post_id INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, post_id)
    );

    CREATE TABLE IF NOT EXISTS follows (
      id SERIAL PRIMARY KEY,
      follower_id INTEGER NOT NULL,
      following_id INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(follower_id, following_id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      sender_id INTEGER,
      type TEXT NOT NULL,
      title TEXT,
      content TEXT,
      target_id INTEGER,
      comment_id INTEGER,
      is_read INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL,
      refresh_token TEXT,
      expires_at TIMESTAMP,
      user_agent TEXT,
      ip_address TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      id TEXT PRIMARY KEY,
      admin_id INTEGER NOT NULL,
      token TEXT NOT NULL,
      refresh_token TEXT,
      expires_at TIMESTAMP,
      user_agent TEXT,
      ip_address TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      status INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS post_tags (
      post_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (post_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS email_verification_codes (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      type TEXT DEFAULT 'register',
      used INTEGER DEFAULT 0,
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS site_config (
      id SERIAL PRIMARY KEY,
      config_key TEXT NOT NULL UNIQUE,
      config_value TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_ban (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      end_time TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      status INTEGER DEFAULT 0,
      operator INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_verification (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE,
      type INTEGER NOT NULL,
      status INTEGER DEFAULT 0,
      real_name TEXT NOT NULL,
      id_card TEXT NOT NULL,
      contact_name TEXT,
      contact_phone TEXT,
      title TEXT,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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

  await p.query(schema);
  console.log('[pg] Schema initialized');
}

const pgPool = {
  execute,
  query,
  getConnection: async () => getConnection(),
  end: async () => { if (pool) await pool.end(); }
};

module.exports = { pool: pgPool, execute, query, initDatabase };
