// Express サーバ本体
// 競馬予想ゲームのバックエンド API を提供する
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
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

const JWT_SECRET = process.env.JWT_SECRET || 'keibasimu-dev-secret';
const SALT_ROUNDS = 10;

// JWT認証ミドルウェア
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '認証が必要です' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: 'トークンが無効です' });
  }
}

// ヘルスチェック
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// ===== 認証API =====

// 新規登録
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username と password は必須です' });
  }
  if (!/^[a-zA-Z0-9]{3,20}$/.test(username)) {
    return res.status(400).json({ error: 'ユーザー名は3〜20文字の英数字のみ使用できます' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'パスワードは6文字以上にしてください' });
  }
  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const { rows } = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, coins',
      [username, passwordHash]
    );
    const user = rows[0];
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, user });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'そのユーザー名は既に使用されています' });
    }
    console.error(err);
    res.status(500).json({ error: '登録に失敗しました' });
  }
});

// ログイン
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username と password は必須です' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT id, username, password_hash, coins FROM users WHERE username = $1',
      [username]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'ユーザー名またはパスワードが違います' });
    }
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'ユーザー名またはパスワードが違います' });
    }
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, username: user.username, coins: user.coins } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'ログインに失敗しました' });
  }
});

// 現在のユーザー情報取得
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, username, coins FROM users WHERE id = $1',
      [req.userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'ユーザーが見つかりません' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'ユーザー情報の取得に失敗しました' });
  }
});

// コイン更新
app.patch('/api/auth/coins', requireAuth, async (req, res) => {
  const { coins } = req.body || {};
  if (typeof coins !== 'number' || !Number.isInteger(coins) || coins < 0) {
    return res.status(400).json({ error: 'coins は0以上の整数である必要があります' });
  }
  try {
    const { rows } = await pool.query(
      'UPDATE users SET coins = $1 WHERE id = $2 RETURNING id, username, coins',
      [coins, req.userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'ユーザーが見つかりません' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'コインの更新に失敗しました' });
  }
});

// ===== ランキングAPI =====

const VALID_BET_TYPES = ['単勝', '複勝', '馬連', '馬単', '3連複', '3連単'];

// 総所持金TOP20
app.get('/api/rankings/coins', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT username, coins FROM users ORDER BY coins DESC LIMIT 20'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'ランキング取得に失敗しました' });
  }
});

// 全馬券合計の一撃最高払戻TOP20
app.get('/api/rankings/payout', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.username, b.bet_type, b.payout, b.odds
       FROM bet_records b
       JOIN users u ON b.user_id = u.id
       ORDER BY b.payout DESC
       LIMIT 20`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'ランキング取得に失敗しました' });
  }
});

// 馬券種別ごとの一撃最高払戻TOP20
app.get('/api/rankings/payout/:betType', async (req, res) => {
  const { betType } = req.params;
  if (!VALID_BET_TYPES.includes(betType)) {
    return res.status(400).json({ error: '無効な馬券種別です' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT u.username, b.bet_type, b.payout, b.odds
       FROM bet_records b
       JOIN users u ON b.user_id = u.id
       WHERE b.bet_type = $1
       ORDER BY b.payout DESC
       LIMIT 20`,
      [betType]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'ランキング取得に失敗しました' });
  }
});

// 馬券記録を保存
app.post('/api/rankings/record', requireAuth, async (req, res) => {
  const { bet_type, bet_amount, payout, odds } = req.body || {};
  if (!VALID_BET_TYPES.includes(bet_type)) {
    return res.status(400).json({ error: '無効な馬券種別です' });
  }
  if (!Number.isInteger(bet_amount) || bet_amount <= 0) {
    return res.status(400).json({ error: 'bet_amount は正の整数である必要があります' });
  }
  if (!Number.isInteger(payout) || payout < 0) {
    return res.status(400).json({ error: 'payout は0以上の整数である必要があります' });
  }
  if (typeof odds !== 'number' || odds <= 0) {
    return res.status(400).json({ error: 'odds は正の数である必要があります' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO bet_records (user_id, bet_type, bet_amount, payout, odds)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [req.userId, bet_type, bet_amount, payout, odds]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '記録の保存に失敗しました' });
  }
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
