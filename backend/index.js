// Express サーバ本体
// 競馬予想ゲームのバックエンド API を提供する
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { pool } = require('./db');
const { runMigrations } = require('./migrate');

const app = express();
app.use(cors());
app.use(express.json());

// レート制限: 1 IP あたり 1 分間に 120 リクエストまで
// （ゲームクライアントのポーリングに余裕を持たせつつ、悪意のある DB 連打を抑制する）
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

// ヘルスチェック
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// 馬一覧取得
app.get('/api/horses', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, speed, stamina, stability, running_style, owner_id, created_at FROM horses ORDER BY id DESC LIMIT 200'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '馬一覧の取得に失敗しました' });
  }
});

// 馬を保存
app.post('/api/horses', async (req, res) => {
  const { name, speed, stamina, stability, running_style, owner_id } = req.body || {};
  if (!name) {
    return res.status(400).json({ error: 'name は必須です' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO horses (name, speed, stamina, stability, running_style, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, speed, stamina, stability, running_style, owner_id, created_at`,
      [name, speed ?? 70, stamina ?? 70, stability ?? 70, running_style ?? '先行', owner_id ?? null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '馬の保存に失敗しました' });
  }
});

// レース履歴取得（直近の結果と紐付けて返す）
app.get('/api/races', async (_req, res) => {
  try {
    const { rows: races } = await pool.query(
      'SELECT id, held_at, created_at FROM races ORDER BY id DESC LIMIT 50'
    );
    if (races.length === 0) return res.json([]);

    const ids = races.map((r) => r.id);
    const { rows: results } = await pool.query(
      `SELECT race_id, horse_id, rank, true_condition
       FROM race_results
       WHERE race_id = ANY($1::int[])
       ORDER BY race_id DESC, rank ASC`,
      [ids]
    );
    const grouped = new Map();
    for (const r of results) {
      if (!grouped.has(r.race_id)) grouped.set(r.race_id, []);
      grouped.get(r.race_id).push(r);
    }
    res.json(
      races.map((r) => ({
        ...r,
        results: grouped.get(r.id) || [],
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'レース履歴の取得に失敗しました' });
  }
});

// レース結果を保存
// body: { held_at?: string, results: [{ horse_id, rank, true_condition }] }
app.post('/api/races', async (req, res) => {
  const { held_at, results } = req.body || {};
  if (!Array.isArray(results) || results.length === 0) {
    return res.status(400).json({ error: 'results が必要です' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: raceRows } = await client.query(
      'INSERT INTO races (held_at) VALUES ($1) RETURNING id, held_at, created_at',
      [held_at ? new Date(held_at) : new Date()]
    );
    const race = raceRows[0];
    for (const r of results) {
      await client.query(
        `INSERT INTO race_results (race_id, horse_id, rank, true_condition)
         VALUES ($1, $2, $3, $4)`,
        [race.id, r.horse_id, r.rank, r.true_condition ?? 0.5]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ ...race, results });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'レース結果の保存に失敗しました' });
  } finally {
    client.release();
  }
});

const PORT = process.env.PORT || 3001;

// サーバ起動時にマイグレーションを実行する
async function start() {
  if (process.env.DATABASE_URL) {
    try {
      await runMigrations();
    } catch (err) {
      console.error('マイグレーションに失敗しましたが、サーバは起動します:', err.message);
    }
  } else {
    console.warn('DATABASE_URL が未設定のためマイグレーションをスキップします');
  }
  app.listen(PORT, () => {
    console.log(`サーバ起動: http://localhost:${PORT}`);
  });
}

start();
