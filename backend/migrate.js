// マイグレーション処理
// 新しいカラムは IF NOT EXISTS を使ってデフォルト値で補完する
const { pool } = require('./db');

// マイグレーション定義配列
// 各マイグレーションはべき等になるように IF NOT EXISTS を活用する
const migrations = [
  // horses テーブル
  `CREATE TABLE IF NOT EXISTS horses (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    speed INTEGER NOT NULL DEFAULT 70,
    stamina INTEGER NOT NULL DEFAULT 70,
    stability INTEGER NOT NULL DEFAULT 70,
    running_style TEXT NOT NULL DEFAULT '先行',
    owner_id INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,

  // races テーブル
  `CREATE TABLE IF NOT EXISTS races (
    id SERIAL PRIMARY KEY,
    held_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,

  // race_results テーブル
  `CREATE TABLE IF NOT EXISTS race_results (
    id SERIAL PRIMARY KEY,
    race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
    horse_id INTEGER NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
    rank INTEGER NOT NULL,
    true_condition REAL NOT NULL DEFAULT 0.5,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,

  // 将来カラム追加用テンプレート例（新フィールドはデフォルト値で補完）
  `ALTER TABLE horses ADD COLUMN IF NOT EXISTS owner_id INTEGER;`,
  `ALTER TABLE race_results ADD COLUMN IF NOT EXISTS true_condition REAL NOT NULL DEFAULT 0.5;`,
];

async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const sql of migrations) {
      await client.query(sql);
    }
    await client.query('COMMIT');
    console.log('マイグレーションが完了しました');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('マイグレーション失敗:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { runMigrations };
