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

  // users テーブル
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(20) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    coins INTEGER NOT NULL DEFAULT 1000,
    created_at TIMESTAMP DEFAULT NOW()
  );`,

  // bet_records テーブル
  `CREATE TABLE IF NOT EXISTS bet_records (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    bet_type VARCHAR(10) NOT NULL,
    bet_amount INTEGER NOT NULL,
    payout INTEGER NOT NULL,
    odds NUMERIC(6,1) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  );`,

  // trained_horses テーブル（育成馬）
  `CREATE TABLE IF NOT EXISTS trained_horses (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    speed_rank SMALLINT NOT NULL DEFAULT 0,
    stamina_rank SMALLINT NOT NULL DEFAULT 0,
    stability_rank SMALLINT NOT NULL DEFAULT 0,
    burst_rank SMALLINT NOT NULL DEFAULT 0,
    turf_fit_rank SMALLINT NOT NULL DEFAULT 0,
    dirt_fit_rank SMALLINT NOT NULL DEFAULT 0,
    distance_min INTEGER NOT NULL DEFAULT 1000,
    distance_max INTEGER NOT NULL DEFAULT 3200,
    running_style TEXT NOT NULL DEFAULT '先行',
    generation INTEGER NOT NULL DEFAULT 1,
    parent_id INTEGER REFERENCES trained_horses(id),
    level INTEGER NOT NULL DEFAULT 1,
    exp INTEGER NOT NULL DEFAULT 0,
    total_coins_invested INTEGER NOT NULL DEFAULT 0,
    training_count INTEGER NOT NULL DEFAULT 0,
    speed_growth INTEGER NOT NULL DEFAULT 0,
    stamina_growth INTEGER NOT NULL DEFAULT 0,
    stability_growth INTEGER NOT NULL DEFAULT 0,
    burst_growth INTEGER NOT NULL DEFAULT 0,
    turf_fit_growth INTEGER NOT NULL DEFAULT 0,
    dirt_fit_growth INTEGER NOT NULL DEFAULT 0,
    distance_min_growth INTEGER NOT NULL DEFAULT 0,
    distance_max_growth INTEGER NOT NULL DEFAULT 0,
    total_races INTEGER NOT NULL DEFAULT 0,
    total_wins INTEGER NOT NULL DEFAULT 0,
    total_prize INTEGER NOT NULL DEFAULT 0,
    win_shinjuba INTEGER NOT NULL DEFAULT 0,
    win_mishousen INTEGER NOT NULL DEFAULT 0,
    win_1sho INTEGER NOT NULL DEFAULT 0,
    win_2sho INTEGER NOT NULL DEFAULT 0,
    win_3sho INTEGER NOT NULL DEFAULT 0,
    win_listed INTEGER NOT NULL DEFAULT 0,
    win_open INTEGER NOT NULL DEFAULT 0,
    win_g3 INTEGER NOT NULL DEFAULT 0,
    win_g2 INTEGER NOT NULL DEFAULT 0,
    win_g1 INTEGER NOT NULL DEFAULT 0,
    has_raced BOOLEAN NOT NULL DEFAULT FALSE,
    is_retired BOOLEAN NOT NULL DEFAULT FALSE,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    is_hall_of_fame BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,

  // gacha_results テーブル（ガチャ履歴）
  `CREATE TABLE IF NOT EXISTS gacha_results (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    gacha_type TEXT NOT NULL,
    speed_rank SMALLINT NOT NULL DEFAULT 0,
    stamina_rank SMALLINT NOT NULL DEFAULT 0,
    stability_rank SMALLINT NOT NULL DEFAULT 0,
    burst_rank SMALLINT NOT NULL DEFAULT 0,
    turf_fit_rank SMALLINT NOT NULL DEFAULT 0,
    dirt_fit_rank SMALLINT NOT NULL DEFAULT 0,
    distance_min INTEGER NOT NULL DEFAULT 1000,
    distance_max INTEGER NOT NULL DEFAULT 3200,
    running_style TEXT NOT NULL DEFAULT '先行',
    adopted BOOLEAN NOT NULL DEFAULT FALSE,
    cost INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,

  // training_logs テーブル（調教・飼葉ログ）
  `CREATE TABLE IF NOT EXISTS training_logs (
    id SERIAL PRIMARY KEY,
    horse_id INTEGER NOT NULL REFERENCES trained_horses(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    grade TEXT NOT NULL,
    target TEXT,
    cost INTEGER NOT NULL,
    success BOOLEAN NOT NULL DEFAULT FALSE,
    stat_changed TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,

  // horse_race_results テーブル（育成馬のレース結果）
  `CREATE TABLE IF NOT EXISTS horse_race_results (
    id SERIAL PRIMARY KEY,
    horse_id INTEGER NOT NULL REFERENCES trained_horses(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
    race_grade TEXT NOT NULL,
    race_name TEXT NOT NULL,
    distance INTEGER NOT NULL,
    track_type TEXT NOT NULL,
    rank INTEGER NOT NULL,
    prize INTEGER NOT NULL DEFAULT 0,
    exp_gained INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,

  // hall_of_fame テーブル（殿堂入り馬）
  `CREATE TABLE IF NOT EXISTS hall_of_fame (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    horse_name TEXT NOT NULL,
    generation INTEGER NOT NULL,
    speed_rank SMALLINT NOT NULL,
    stamina_rank SMALLINT NOT NULL,
    stability_rank SMALLINT NOT NULL,
    burst_rank SMALLINT NOT NULL,
    turf_fit_rank SMALLINT NOT NULL,
    dirt_fit_rank SMALLINT NOT NULL,
    distance_min INTEGER NOT NULL,
    distance_max INTEGER NOT NULL,
    running_style TEXT NOT NULL,
    total_races INTEGER NOT NULL DEFAULT 0,
    total_wins INTEGER NOT NULL DEFAULT 0,
    total_prize INTEGER NOT NULL DEFAULT 0,
    win_g1 INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,

  // users テーブルに週番号・総賞金カラムを追加
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS current_week INTEGER NOT NULL DEFAULT 1;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS total_prize INTEGER NOT NULL DEFAULT 0;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS next_race_distance INTEGER;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS next_race_track TEXT;`,
  `ALTER TABLE trained_horses ADD COLUMN IF NOT EXISTS inheritance_bonus_percent INTEGER NOT NULL DEFAULT 0;`,
  `ALTER TABLE trained_horses ADD COLUMN IF NOT EXISTS trained_this_week BOOLEAN NOT NULL DEFAULT FALSE;`,
  `ALTER TABLE trained_horses ADD COLUMN IF NOT EXISTS fed_this_week BOOLEAN NOT NULL DEFAULT FALSE;`,
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
