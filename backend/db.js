// PostgreSQL 接続プール定義
// Railway managed DB を想定し、DATABASE_URL から接続する
const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;

// SSL は本番（Railway 等）で必要になるため NODE_ENV で切り替え
const pool = new Pool({
  connectionString,
  ssl:
    process.env.PGSSL === 'true' || process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
});

module.exports = { pool };
