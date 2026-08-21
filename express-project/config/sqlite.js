/**
 * SQLite 数据库兼容层（sql.js 版本 - 纯 WebAssembly，无原生模块）
 * 提供与 mysql2/promise 兼容的接口，用于 Kubeletto 等单容器部署环境
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'app.db');

let db = null;
let initPromise = null;

async function initDatabase() {
  if (db) return db;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    const dbDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
    if (fs.existsSync(DB_PATH)) {
      try {
        const fileBuffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(fileBuffer);
        console.log('[sql.js] Database loaded from', DB_PATH);
      } catch (e) {
        console.error('[sql.js] Failed to load database, creating new one:', e.message);
        db = new SQL.Database();
      }
    } else {
      db = new SQL.Database();
      console.log('[sql.js] New database created at', DB_PATH);
    }
    db.create_function('REGEXP', (regex, text) => {
      if (!text) return 0;
      try { return new RegExp(regex).test(text) ? 1 : 0; } catch { return 0; }
    });
    db.run('PRAGMA foreign_keys = ON');
    initializeSchema();
    saveToDisk();
    return db;
  })();
  return initPromise;
}

function saveToDisk() {
  if (!db) return;
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (e) { console.error('[sql.js] Save error:', e.message); }
}

function transformSql(sql) {
  let result = sql;
  result = result.replace(/SHA2\(\s*\?\s*,\s*256\s*\)/gi, '?');
  result = result.replace(/SHA2\(\s*'([^']*)'\s*,\s*256\s*\)/gi, (m, p1) => `'${crypto.createHash('sha256').update(p1).digest('hex')}'`);
  result = result.replace(/TIMESTAMPDIFF\s*\(\s*HOUR\s*,\s*([^,]+?)\s*,\s*(NOW\(\)|CURRENT_TIMESTAMP|[^,)]+?)\s*\)/gi, 'CAST((julianday($2) - julianday($1)) * 24 AS INTEGER)');
  result = result.replace(/\bLEAST\s*\(/gi, 'min(');
  result = result.replace(/\bGREATEST\s*\(/gi, 'max(');
  result = result.replace(/DATE_SUB\s*\(\s*NOW\s*\(\s*\)\s*,\s*INTERVAL\s+\?\s+HOUR\s*\)/gi, "datetime('now', '-' || ? || ' hours')");
  result = result.replace(/DATE_SUB\s*\(\s*NOW\s*\(\s*\)\s*,\s*INTERVAL\s+\?\s+DAY\s*\)/gi, "datetime('now', '-' || ? || ' days')");
  result = result.replace(/DATE_SUB\s*\(\s*NOW\s*\(\s*\)\s*,\s*INTERVAL\s+\?\s+MINUTE\s*\)/gi, "datetime('now', '-' || ? || ' minutes')");
  result = result.replace(/DATE_SUB\s*\(\s*CURDATE\s*\(\s*\)\s*,\s*INTERVAL\s+\?\s+DAY\s*\)/gi, "date('now', '-' || ? || ' days')");
  result = result.replace(/DATE_ADD\s*\(\s*NOW\s*\(\s*\)\s*,\s*INTERVAL\s+(\d+)\s+(DAY|HOUR|MINUTE|SECOND)\s*\)/gi, (m, num, unit) => { const u = {DAY:'days',HOUR:'hours',MINUTE:'minutes',SECOND:'seconds'}; return `datetime('now', '+${num} ${u[unit.toUpperCase()]||'days'}')`; });
  result = result.replace(/DATE_ADD\s*\(\s*NOW\s*\(\s*\)\s*,\s*INTERVAL\s+\?\s+(DAY|HOUR|MINUTE|SECOND)\s*\)/gi, (m, unit) => { const u = {DAY:'days',HOUR:'hours',MINUTE:'minutes',SECOND:'seconds'}; return `datetime('now', '+' || ? || ' ${u[unit.toUpperCase()]||'days'}')`; });
  result = result.replace(/DATE_SUB\s*\(\s*NOW\s*\(\s*\)\s*,\s*INTERVAL\s+(\d+)\s+(DAY|HOUR|MINUTE|SECOND)\s*\)/gi, (m, num, unit) => { const u = {DAY:'days',HOUR:'hours',MINUTE:'minutes',SECOND:'seconds'}; return `datetime('now', '-${num} ${u[unit.toUpperCase()]||'days'}')`; });
  result = result.replace(/\bNOW\(\)/gi, 'CURRENT_TIMESTAMP');
  result = result.replace(/INSERT\s+IGNORE\s+INTO/gi, 'INSERT OR IGNORE INTO');
  result = result.replace(/\bCURDATE\s*\(\)/gi, "date('now')");
  result = result.replace(/\bUNIX_TIMESTAMP\s*\(\)/gi, "CAST(strftime('%s','now') AS INTEGER)");
  result = result.replace(/UNIX_TIMESTAMP\s*\(\s*(\w+)\s*\)/gi, "CAST(strftime('%s', $1) AS INTEGER)");
  result = result.replace(/DATEDIFF\s*\(\s*(\?|\w+)\s*,\s*(\?|\w+)\s*\)/gi, 'CAST(julianday($1) - julianday($2) AS INTEGER)');
  result = result.replace(/CAST\s*\(\s*\?\s+AS\s+CHAR\s*\)/gi, 'CAST(? AS TEXT)');
  result = result.replace(/CAST\s*\(\s*\?\s+AS\s+SIGNED\s*\)/gi, 'CAST(? AS INTEGER)');
  result = result.replace(/JSON_EXTRACT/gi, 'json_extract');
  result = result.replace(/JSON_UNQUOTE\s*\(\s*json_extract/gi, 'json_extract');
  result = result.replace(/`/g, '"');
  result = result.replace(/\bTRUE\b/gi, '1');
  result = result.replace(/\bFALSE\b/gi, '0');
  return result;
}

function transformParams(sql, params) {
  if (!params) return params;
  const matches = [...sql.matchAll(/SHA2\(\s*\?\s*,\s*256\s*\)/gi)];
  if (matches.length === 0) return params;
  const paramArray = Array.isArray(params) ? params : [params];
  const sha2Positions = [];
  let match;
  const regex = /SHA2\(\s*\?\s*,\s*256\s*\)/gi;
  while ((match = regex.exec(sql)) !== null) {
    const before = sql.substring(0, match.index);
    sha2Positions.push((before.match(/\?/g) || []).length);
  }
  return paramArray.map((p, i) => sha2Positions.includes(i) ? crypto.createHash('sha256').update(String(p)).digest('hex') : p);
}

function expandArrayParams(sql, params) {
  if (!params) return { sql, params };
  const paramArray = Array.isArray(params) ? params : [params];
  if (!paramArray.some(p => Array.isArray(p))) return { sql, params: paramArray };
  let result = '';
  let paramIndex = 0;
  let inString = false;
  let stringChar = '';
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    if (inString) { result += char; if (char === stringChar && sql[i-1] !== '\\') inString = false; continue; }
    if (char === "'" || char === '"') { inString = true; stringChar = char; result += char; continue; }
    if (char === '?') { const p = paramArray[paramIndex]; result += Array.isArray(p) ? p.map(()=>'?').join(', ') : '?'; paramIndex++; }
    else result += char;
  }
  const flat = [];
  for (const p of paramArray) { if (Array.isArray(p)) flat.push(...p); else flat.push(p); }
  return { sql: result, params: flat };
}

async function execute(sql, params = []) {
  await initDatabase();
  try {
    let transformedSql = transformSql(sql);
    let transformedParams = transformParams(sql, params);
    const expanded = expandArrayParams(transformedSql, transformedParams);
    transformedSql = expanded.sql;
    transformedParams = expanded.params;
    const isSelect = /^\s*(SELECT|WITH|PRAGMA)/i.test(transformedSql);
    const isInsert = /^\s*INSERT/i.test(transformedSql);
    if (isSelect) {
      const stmt = db.prepare(transformedSql);
      if (transformedParams && transformedParams.length > 0) stmt.bind(transformedParams);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return [rows, []];
    } else {
      const stmt = db.prepare(transformedSql);
      if (transformedParams && transformedParams.length > 0) stmt.bind(transformedParams);
      stmt.step();
      stmt.free();
      saveToDisk();
      let lastInsertRowid = 0, changes = 0;
      try {
        const ir = db.exec('SELECT last_insert_rowid() as id');
        if (ir.length > 0 && ir[0].values.length > 0) lastInsertRowid = ir[0].values[0][0];
        const cr = db.exec('SELECT changes() as c');
        if (cr.length > 0 && cr[0].values.length > 0) changes = cr[0].values[0][0];
      } catch (e) {}
      if (isInsert) return [{ insertId: lastInsertRowid, affectedRows: changes }, []];
      return [{ affectedRows: changes, insertId: lastInsertRowid }, []];
    }
  } catch (err) {
    if (err.message && err.message.includes('already exists')) return [{ affectedRows: 0 }, []];
    console.error('[sql.js] SQL Error:', err.message);
    console.error('[sql.js] SQL:', sql.substring(0, 200));
    return Promise.reject(err);
  }
}

async function query(sql, params = []) { return execute(sql, params); }

function getConnection() {
  return {
    execute, query,
    beginTransaction: async () => { await initDatabase(); db.run('BEGIN TRANSACTION'); },
    commit: async () => { db.run('COMMIT'); saveToDisk(); },
    rollback: async () => { db.run('ROLLBACK'); },
    release: () => {}
  };
}

function initializeSchema() {
  const schema = `
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL UNIQUE, password TEXT NOT NULL, nickname TEXT NOT NULL, avatar TEXT DEFAULT '', bio TEXT DEFAULT '', location TEXT DEFAULT '未知', follow_count INTEGER DEFAULT 0, fans_count INTEGER DEFAULT 0, like_count INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, last_login_at TEXT, email TEXT DEFAULT '', gender TEXT DEFAULT '', zodiac_sign TEXT DEFAULT '', mbti TEXT DEFAULT '', education TEXT DEFAULT '', major TEXT DEFAULT '', interests TEXT DEFAULT '[]', verified INTEGER DEFAULT 0, is_bot INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS admin (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, last_login_at TEXT);
    CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category_title TEXT NOT NULL, sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, use_count INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT, content TEXT, category_id INTEGER, type INTEGER DEFAULT 1, status INTEGER DEFAULT 0, view_count INTEGER DEFAULT 0, like_count INTEGER DEFAULT 0, collect_count INTEGER DEFAULT 0, comment_count INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS post_images (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, image_url TEXT NOT NULL, sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS post_videos (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, video_url TEXT NOT NULL, cover_url TEXT, duration INTEGER, thumbnail TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, parent_id INTEGER, content TEXT NOT NULL, like_count INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS likes (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, target_type INTEGER NOT NULL, target_id INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, target_type, target_id));
    CREATE TABLE IF NOT EXISTS collections (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, post_id INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, post_id));
    CREATE TABLE IF NOT EXISTS follows (id INTEGER PRIMARY KEY AUTOINCREMENT, follower_id INTEGER NOT NULL, following_id INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(follower_id, following_id));
    CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, sender_id INTEGER, type TEXT NOT NULL, title TEXT, content TEXT, target_id INTEGER, comment_id INTEGER, is_read INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS user_sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, token TEXT NOT NULL, refresh_token TEXT, expires_at TEXT, user_agent TEXT, ip_address TEXT, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS admin_sessions (id TEXT PRIMARY KEY, admin_id INTEGER NOT NULL, token TEXT NOT NULL, refresh_token TEXT, expires_at TEXT, user_agent TEXT, ip_address TEXT, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, target_id INTEGER NOT NULL, status INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS post_tags (post_id INTEGER NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY (post_id, tag_id));
    CREATE TABLE IF NOT EXISTS email_verification_codes (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, code TEXT NOT NULL, type TEXT DEFAULT 'register', used INTEGER DEFAULT 0, expires_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS site_config (id INTEGER PRIMARY KEY AUTOINCREMENT, config_key TEXT NOT NULL UNIQUE, config_value TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS user_ban (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, reason TEXT NOT NULL, end_time TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, status INTEGER DEFAULT 0, operator INTEGER NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS user_verification (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL UNIQUE, type INTEGER NOT NULL, status INTEGER DEFAULT 0, real_name TEXT NOT NULL, id_card TEXT NOT NULL, contact_name TEXT, contact_phone TEXT, title TEXT, description TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE);
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
  db.run(schema);
  try {
    const cols = db.exec("PRAGMA table_info(users)");
    if (cols.length > 0) { const names = cols[0].values.map(r => r[1]); if (!names.includes('is_bot')) db.run('ALTER TABLE users ADD COLUMN is_bot INTEGER DEFAULT 0'); }
  } catch (e) {}
  try {
    const cols = db.exec("PRAGMA table_info(post_videos)");
    if (cols.length > 0) { const names = cols[0].values.map(r => r[1]); if (!names.includes('cover_url')) db.run('ALTER TABLE post_videos ADD COLUMN cover_url TEXT'); }
  } catch (e) {}
}

const pool = {
  execute, query,
  getConnection: async () => getConnection(),
  end: async () => { if (db) { saveToDisk(); db.close(); } }
};

module.exports = { pool, execute, query, initDatabase };
