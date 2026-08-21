#!/bin/bash
set -e

echo "=========================================="
echo "fufu-app container starting..."
echo "=========================================="
echo "Working directory: $(pwd)"
echo "Node version: $(node --version)"
echo ""
echo "--- Environment variables ---"
env | sort
echo ""
echo "--- Files in /app ---"
ls -la /app
echo ""
echo "--- Testing better-sqlite3 ---"
node -e "
try {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
  const stmt = db.prepare('INSERT INTO test (name) VALUES (?)');
  stmt.run('hello');
  const row = db.prepare('SELECT * FROM test').get();
  console.log('better-sqlite3: OK - test row:', JSON.stringify(row));
  db.close();
} catch(e) {
  console.error('better-sqlite3 ERROR:', e.message);
  console.error(e.stack);
  process.exit(1);
}
"
echo ""
echo "--- Testing config/sqliste loading ---"
node -e "
try {
  process.env.DB_TYPE = process.env.DB_TYPE || 'sqlite';
  process.env.SQLITE_PATH = process.env.SQLITE_PATH || '/app/data/app.db';
  const config = require('./config/config');
  console.log('Config loaded OK');
  console.log('Server port:', config.server.port);
  console.log('DB_TYPE:', process.env.DB_TYPE);
  console.log('SQLITE_PATH:', process.env.SQLITE_PATH);
} catch(e) {
  console.error('Config loading ERROR:', e.message);
  console.error(e.stack);
  process.exit(1);
}
"
echo ""
echo "=========================================="
echo "Starting node app.js..."
echo "=========================================="
exec node app.js
