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
const VALID_BET_TYPES = ['単勝', '複勝', '馬連', '馬単', '3連複', '3連単'];
const VALID_GACHA_TYPES = ['speed', 'stamina', 'stability', 'burst', 'turf', 'dirt', 'premium'];
const VALID_GACHA_COUNTS = [1, 10];
const RANK_LABELS = [
  'E-','E','E+','D-','D','D+','C-','C','C+','B-','B','B+',
  'A-','A','A+','S-','S','S+','SS-','SS','SS+','SSS-','SSS','SSS+','Z-','Z','Z+'
];
const RANK_SCORES = [68, 70, 72, 73, 74, 75, 76, 77, 79, 80, 82, 83, 84, 86, 87, 88, 90, 92, 93, 95, 96, 97, 99, 100, 101, 103, 104];
const NORMAL_GACHA_WEIGHTS = [
  { value: 0, weight: 40 },
  { value: 1, weight: 30 },
  { value: 2, weight: 15 },
  { value: 3, weight: 8 },
  { value: 4, weight: 5 },
  { value: 5, weight: 2 },
];
const PREMIUM_GACHA_WEIGHTS = [
  { value: 3, weight: 30 },
  { value: 4, weight: 25 },
  { value: 5, weight: 20 },
  { value: 6, weight: 12 },
  { value: 7, weight: 8 },
  { value: 8, weight: 3 },
  { value: 9, weight: 1.5 },
  { value: 10, weight: 0.5 },
];
const DISTANCE_GACHA_WEIGHTS = [
  { value: { min: 1000, max: 1600 }, weight: 33 },
  { value: { min: 1600, max: 2400 }, weight: 34 },
  { value: { min: 2400, max: 3200 }, weight: 33 },
];
const RUNNING_STYLE_WEIGHTS = [
  { value: '逃げ', weight: 25 },
  { value: '先行', weight: 25 },
  { value: '差し', weight: 25 },
  { value: '追込', weight: 25 },
];
const RUNNING_STYLES = {
  大逃げ:   { early: 1.75, middle: 1.45, late: 0.47 },
  逃げ:     { early: 0.85, middle: 0.92, late: 1.18 },
  先行:     { early: 0.76, middle: 0.99, late: 1.15 },
  差し:     { early: 0.78, middle: 1.05, late: 1.05 },
  追込:     { early: 0.70, middle: 0.86, late: 1.52 },
  直線一気: { early: 0.78, middle: 0.75, late: 1.97 },
  まくり:   { early: 0.72, middle: 1.68, late: 0.73 },
};
const TRAINING_CONFIG = {
  通常: { cost: 5000, multiplier: 0.125 },
  上質: { cost: 20000, multiplier: 0.25 },
  高級: { cost: 60000, multiplier: 0.5 },
  英才: { cost: 150000, multiplier: 1.0 },
};
const FEED_CONFIG = {
  普通: { cost: 10000, multiplier: 0.125 },
  上質: { cost: 40000, multiplier: 0.25 },
  特上: { cost: 100000, multiplier: 0.5 },
  幻: { cost: 300000, multiplier: 1.0 },
};
const SPECIAL_TRAINING_COST = 200000;
const GACHA_COSTS = {
  speed: { 1: 30000, 10: 270000 },
  stamina: { 1: 30000, 10: 270000 },
  stability: { 1: 30000, 10: 270000 },
  burst: { 1: 30000, 10: 270000 },
  turf: { 1: 30000, 10: 270000 },
  dirt: { 1: 30000, 10: 270000 },
  premium: { 1: 500000, 10: 4500000 },
};
const TRAINING_TARGETS = ['speed', 'stamina', 'stability', 'burst', 'turf_fit', 'dirt_fit', 'distance_min', 'distance_max'];
const FEED_TARGETS = ['speed', 'stamina', 'stability', 'burst', 'turf_fit', 'dirt_fit'];
const SPECIAL_RUNNING_STYLES = ['逃げ', '先行', '差し', '追込'];
const TARGET_TO_COLUMNS = {
  speed: { rank: 'speed_rank', growth: 'speed_growth' },
  stamina: { rank: 'stamina_rank', growth: 'stamina_growth' },
  stability: { rank: 'stability_rank', growth: 'stability_growth' },
  burst: { rank: 'burst_rank', growth: 'burst_growth' },
  turf_fit: { rank: 'turf_fit_rank', growth: 'turf_fit_growth' },
  dirt_fit: { rank: 'dirt_fit_rank', growth: 'dirt_fit_growth' },
  distance_min: { rank: 'distance_min', growth: 'distance_min_growth' },
  distance_max: { rank: 'distance_max', growth: 'distance_max_growth' },
};
const EXPERIENCE_REQUIREMENTS = [
  333, 333, 333, 333, 333, 333, 333, 333, 336,
  700, 700, 700, 700, 700, 700, 700, 700, 700, 700,
  1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000,
];
const EXP_MULTIPLIERS = {
  g1: 10,
  g2: 7,
  g3: 5,
  open: 2,
  listed: 1.5,
};
const BASE_PRIZES = {
  shinjuba: 200000,
  mishousen: 100000,
  '1sho': 200000,
  '2sho': 350000,
  '3sho': 500000,
  listed: 300000,
  open: 600000,
  g3: 1500000,
  g2: 3000000,
  g1: 10000000,
};
const INHERITANCE_RISK = {
  low: { min: 9, max: 10 },
  normal: { min: 7, max: 12 },
  high: { min: 5, max: 14 },
};
const RACE_GRADE_PROGRESS = {
  shinjuba: ['shinjuba'],
  mishousen: ['mishousen'],
  firstWin: ['1sho', 'listed'],
  win1: ['2sho', 'listed'],
  win2: ['3sho', 'listed'],
  win3: ['listed'],
  listed: ['listed', 'open'],
  open: ['listed', 'open', 'g3'],
  g3: ['listed', 'open', 'g3', 'g2'],
  g2: ['listed', 'open', 'g3', 'g2', 'g1'],
};
const RACE_STEPS = 200;
const RACE_COURSES = ['short', 'mile', 'long'];
const RACE_TRACKS = ['turf', 'dirt'];
const DISTANCE_OPTIONS = {
  short: [1000, 1100, 1200, 1300, 1400],
  mile: [1600, 1700, 1800],
  long: [2000, 2200, 2400, 2600, 2800, 3000, 3200],
};
const HORSE_UPDATE_COLUMNS = new Set([
  'speed_rank', 'stamina_rank', 'stability_rank', 'burst_rank', 'turf_fit_rank', 'dirt_fit_rank',
  'distance_min', 'distance_max', 'running_style', 'level', 'exp', 'total_coins_invested',
  'training_count', 'speed_growth', 'stamina_growth', 'stability_growth', 'burst_growth',
  'turf_fit_growth', 'dirt_fit_growth', 'distance_min_growth', 'distance_max_growth',
  'total_races', 'total_wins', 'total_prize', 'win_shinjuba', 'win_mishousen', 'win_1sho',
  'win_2sho', 'win_3sho', 'win_listed', 'win_open', 'win_g3', 'win_g2', 'win_g1', 'has_raced',
  'is_retired', 'is_deleted', 'is_hall_of_fame', 'inheritance_bonus_percent',
  'trained_this_week', 'fed_this_week',
]);

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

const authMiddleware = requireAuth;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundToOneDecimal(value) {
  return Math.round(value * 10) / 10;
}

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function handleApiError(res, err, fallbackMessage) {
  if (err && err.status) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(err);
  return res.status(500).json({ error: fallbackMessage });
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickWeighted(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let cursor = Math.random() * total;
  for (const item of items) {
    cursor -= item.weight;
    if (cursor <= 0) {
      return item.value;
    }
  }
  return items[items.length - 1].value;
}

function shuffle(values) {
  const copied = [...values];
  for (let i = copied.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copied[i], copied[j]] = [copied[j], copied[i]];
  }
  return copied;
}

function normalizeRaceGrade(grade) {
  const raw = String(grade || '').trim();
  const lowered = raw.toLowerCase();
  const map = {
    shinjuba: 'shinjuba',
    '新馬戦': 'shinjuba',
    mishousen: 'mishousen',
    '未勝利戦': 'mishousen',
    '1sho': '1sho',
    '1勝クラス': '1sho',
    '2sho': '2sho',
    '2勝クラス': '2sho',
    '3sho': '3sho',
    '3勝クラス': '3sho',
    listed: 'listed',
    l: 'listed',
    open: 'open',
    op: 'open',
    g3: 'g3',
    g2: 'g2',
    g1: 'g1',
  };
  return map[raw] || map[lowered] || null;
}

function normalizeTrackType(trackType) {
  const raw = String(trackType || '').trim().toLowerCase();
  if (raw === 'turf' || raw === '芝') return 'turf';
  if (raw === 'dirt' || raw === 'ダート') return 'dirt';
  return null;
}

function normalizeGachaCount(count) {
  return Number.isInteger(count) ? count : Number(count);
}

function rankToLabel(rank) {
  return RANK_LABELS[clamp(rank, 0, RANK_LABELS.length - 1)] || RANK_LABELS[0];
}

function rankToScore(rank) {
  return RANK_SCORES[clamp(rank, 0, RANK_SCORES.length - 1)] || RANK_SCORES[0];
}

function buildGachaHorse(gachaType) {
  const statusWeights = gachaType === 'premium' ? PREMIUM_GACHA_WEIGHTS : NORMAL_GACHA_WEIGHTS;
  const distanceRange = pickWeighted(DISTANCE_GACHA_WEIGHTS);
  return {
    gacha_type: gachaType,
    speed_rank: pickWeighted(statusWeights),
    stamina_rank: pickWeighted(statusWeights),
    stability_rank: pickWeighted(statusWeights),
    burst_rank: pickWeighted(statusWeights),
    turf_fit_rank: pickWeighted(statusWeights),
    dirt_fit_rank: pickWeighted(statusWeights),
    distance_min: distanceRange.min,
    distance_max: distanceRange.max,
    running_style: pickWeighted(RUNNING_STYLE_WEIGHTS),
  };
}

function calculateGrowthChance(growthCount, gradeMultiplier, inheritanceBonusPercent = 0) {
  const baseChance = 80 * Math.pow(2 / 3, growthCount) * gradeMultiplier;
  return clamp(baseChance + inheritanceBonusPercent, 0, 100);
}

function calculateInvestmentBonus(totalCoinsInvested) {
  if (totalCoinsInvested >= 10000000) return 2;
  if (totalCoinsInvested >= 3000000) return 1;
  return 0;
}

function calculateLevelFromTotalExp(totalExp) {
  let level = 1;
  let restExp = totalExp;
  for (const requiredExp of EXPERIENCE_REQUIREMENTS) {
    if (level >= 30 || restExp < requiredExp) {
      break;
    }
    restExp -= requiredExp;
    level += 1;
  }
  return { level, exp: restExp };
}

function getLevelBonusPercent(level) {
  return level * 10;
}

function buildUpdateQuery(table, idColumn, idValue, fields, allowedColumns = null) {
  const entries = Object.entries(fields);
  if (allowedColumns) {
    for (const [key] of entries) {
      if (!allowedColumns.has(key)) {
        throw createHttpError(500, '更新対象カラムが不正です');
      }
    }
  }
  const assignments = entries.map(([key], index) => `${key} = $${index + 2}`);
  return {
    text: `UPDATE ${table} SET ${assignments.join(', ')}, updated_at = NOW() WHERE ${idColumn} = $1 RETURNING *`,
    values: [idValue, ...entries.map(([, value]) => value)],
  };
}

async function updateHorse(client, horseId, fields) {
  const query = buildUpdateQuery('trained_horses', 'id', horseId, fields, HORSE_UPDATE_COLUMNS);
  const { rows } = await client.query(query.text, query.values);
  return rows[0];
}

async function getUserById(client, userId, forUpdate = false) {
  const suffix = forUpdate ? ' FOR UPDATE' : '';
  const { rows } = await client.query(
    `SELECT id, username, coins, current_week, total_prize, next_race_distance, next_race_track
       FROM users
      WHERE id = $1${suffix}`,
    [userId]
  );
  return rows[0] || null;
}

async function getActiveHorse(client, userId, forUpdate = false) {
  const suffix = forUpdate ? ' FOR UPDATE' : '';
  const { rows } = await client.query(
    `SELECT *
       FROM trained_horses
      WHERE user_id = $1 AND is_deleted = FALSE AND is_retired = FALSE
      ORDER BY id DESC
      LIMIT 1${suffix}`,
    [userId]
  );
  return rows[0] || null;
}

async function getLatestManagedHorse(client, userId, forUpdate = false) {
  const suffix = forUpdate ? ' FOR UPDATE' : '';
  const { rows } = await client.query(
    `SELECT *
       FROM trained_horses
      WHERE user_id = $1 AND is_deleted = FALSE
      ORDER BY is_retired ASC, id DESC
      LIMIT 1${suffix}`,
    [userId]
  );
  return rows[0] || null;
}

async function getLatestRetiredHorse(client, userId, forUpdate = false) {
  const suffix = forUpdate ? ' FOR UPDATE' : '';
  const { rows } = await client.query(
    `SELECT *
       FROM trained_horses
      WHERE user_id = $1 AND is_deleted = FALSE AND is_retired = TRUE
      ORDER BY updated_at DESC, id DESC
      LIMIT 1${suffix}`,
    [userId]
  );
  return rows[0] || null;
}

async function deductCoins(client, userId, amount) {
  const user = await getUserById(client, userId, true);
  if (!user) {
    throw createHttpError(404, 'ユーザーが見つかりません');
  }
  if (user.coins < amount) {
    throw createHttpError(400, 'コインが不足しています');
  }
  const { rows } = await client.query(
    `UPDATE users
        SET coins = coins - $1
      WHERE id = $2
      RETURNING id, username, coins, current_week, total_prize, next_race_distance, next_race_track`,
    [amount, userId]
  );
  return rows[0];
}

async function syncUserTotalPrize(client, userId) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(total_prize), 0) AS total_prize
       FROM trained_horses
      WHERE user_id = $1 AND is_deleted = FALSE`,
    [userId]
  );
  const totalPrize = Number(rows[0]?.total_prize || 0);
  await client.query('UPDATE users SET total_prize = $1 WHERE id = $2', [totalPrize, userId]);
  return totalPrize;
}

async function syncHorseRaceStats(client, horseId) {
  const { rows } = await client.query(
    `SELECT
        COUNT(*) FILTER (WHERE rank > 0)::INTEGER AS total_races,
        COUNT(*) FILTER (WHERE rank = 1)::INTEGER AS total_wins,
        COALESCE(SUM(CASE WHEN rank > 0 THEN prize ELSE 0 END), 0)::INTEGER AS total_prize,
        COUNT(*) FILTER (WHERE rank = 1 AND LOWER(race_grade) = 'shinjuba')::INTEGER AS win_shinjuba,
        COUNT(*) FILTER (WHERE rank = 1 AND LOWER(race_grade) = 'mishousen')::INTEGER AS win_mishousen,
        COUNT(*) FILTER (WHERE rank = 1 AND LOWER(race_grade) = '1sho')::INTEGER AS win_1sho,
        COUNT(*) FILTER (WHERE rank = 1 AND LOWER(race_grade) = '2sho')::INTEGER AS win_2sho,
        COUNT(*) FILTER (WHERE rank = 1 AND LOWER(race_grade) = '3sho')::INTEGER AS win_3sho,
        COUNT(*) FILTER (WHERE rank = 1 AND LOWER(race_grade) = 'listed')::INTEGER AS win_listed,
        COUNT(*) FILTER (WHERE rank = 1 AND LOWER(race_grade) = 'open')::INTEGER AS win_open,
        COUNT(*) FILTER (WHERE rank = 1 AND LOWER(race_grade) = 'g3')::INTEGER AS win_g3,
        COUNT(*) FILTER (WHERE rank = 1 AND LOWER(race_grade) = 'g2')::INTEGER AS win_g2,
        COUNT(*) FILTER (WHERE rank = 1 AND LOWER(race_grade) = 'g1')::INTEGER AS win_g1,
        COALESCE(SUM(CASE WHEN rank > 0 THEN exp_gained ELSE 0 END), 0)::INTEGER AS total_exp
       FROM horse_race_results
      WHERE horse_id = $1`,
    [horseId]
  );
  const summary = rows[0];
  const levelData = calculateLevelFromTotalExp(Number(summary.total_exp || 0));
  const query = buildUpdateQuery('trained_horses', 'id', horseId, {
    total_races: summary.total_races,
    total_wins: summary.total_wins,
    total_prize: summary.total_prize,
    win_shinjuba: summary.win_shinjuba,
    win_mishousen: summary.win_mishousen,
    win_1sho: summary.win_1sho,
    win_2sho: summary.win_2sho,
    win_3sho: summary.win_3sho,
    win_listed: summary.win_listed,
    win_open: summary.win_open,
    win_g3: summary.win_g3,
    win_g2: summary.win_g2,
    win_g1: summary.win_g1,
    has_raced: summary.total_races > 0,
    level: levelData.level,
    exp: levelData.exp,
  }, HORSE_UPDATE_COLUMNS);
  const { rows: updatedRows } = await client.query(query.text, query.values);
  return updatedRows[0];
}

function determineAvailableRaceGrades(horse) {
  const grades = [];
  const h = horse;

  // 新馬戦（初出走限定）
  if (!h.has_raced) {
    grades.push('shinjuba');
  }

  // 未勝利戦（勝利なし限定）
  if (h.has_raced && h.total_wins === 0) {
    grades.push('mishousen');
  }

  // 1勝クラス
  if (h.win_shinjuba > 0 || h.win_mishousen > 0) {
    grades.push('1sho');
  }

  // 2勝クラス
  if (h.win_1sho > 0) {
    grades.push('2sho');
  }

  // 3勝クラス
  if (h.win_2sho > 0) {
    grades.push('3sho');
  }

  // L（リステッド）
  if (h.win_shinjuba > 0 || h.win_mishousen > 0) {
    grades.push('listed');
  }

  // G3：新馬戦 or 3勝クラス勝利
  if (h.win_shinjuba > 0 || h.win_3sho > 0) {
    grades.push('g3');
  }

  // OP
  if (h.win_listed > 0) {
    grades.push('open');
  }

  // G2
  if (h.win_g3 > 0) {
    grades.push('g2');
  }

  // G1
  if (h.win_g2 > 0) {
    grades.push('g1');
  }

  return grades;
}

function buildInheritanceRanks(horse, inheritanceType) {
  const risk = INHERITANCE_RISK[inheritanceType];
  if (!risk) {
    throw createHttpError(400, '無効な継承タイプです');
  }
  const bonusStages = calculateInvestmentBonus(horse.total_coins_invested);
  const fields = ['speed_rank', 'stamina_rank', 'stability_rank', 'burst_rank', 'turf_fit_rank', 'dirt_fit_rank'];
  const inheritedRanks = {};
  for (const field of fields) {
    const down = randomInt(risk.min, risk.max);
    inheritedRanks[field] = clamp(horse[field] - down + bonusStages, 0, 26);
  }
  inheritedRanks.running_style = horse.running_style;
  inheritedRanks.level_bonus_percent = getLevelBonusPercent(horse.level);

  // 距離適性の継承計算
  const parentMin = horse.distance_min;
  const parentMax = horse.distance_max;

  const minVariation = Math.floor(Math.random() * 801) - 200;
  let inheritedMin = parentMin + minVariation;

  const maxVariation = Math.floor(Math.random() * 801) - 600;
  let inheritedMax = parentMax + maxVariation;

  inheritedMin = Math.max(1000, Math.min(3200, inheritedMin));
  inheritedMax = Math.max(1000, Math.min(3200, inheritedMax));

  if (inheritedMax - inheritedMin < 400) {
    const center = Math.floor((inheritedMin + inheritedMax) / 2);
    inheritedMin = Math.max(1000, center - 200);
    inheritedMax = Math.min(3200, center + 200);
  }

  inheritedRanks.distance_min = inheritedMin;
  inheritedRanks.distance_max = inheritedMax;

  return { inheritedRanks, bonusStages, inheritedDistanceMin: inheritedMin, inheritedDistanceMax: inheritedMax };
}

function normalizeInheritedRanks(input, parentHorse) {
  if (!input || typeof input !== 'object') {
    throw createHttpError(400, 'inheritedRanks は必須です');
  }
  const normalized = {};
  const fields = ['speed_rank', 'stamina_rank', 'stability_rank', 'burst_rank', 'turf_fit_rank', 'dirt_fit_rank'];
  for (const field of fields) {
    const value = input[field];
    if (!Number.isInteger(value)) {
      throw createHttpError(400, `${field} は整数である必要があります`);
    }
    normalized[field] = clamp(value, 0, 26);
  }
  normalized.distance_min = Number.isInteger(input.distance_min) ? clamp(input.distance_min, 1000, 3200) : parentHorse.distance_min;
  normalized.distance_max = Number.isInteger(input.distance_max) ? clamp(input.distance_max, normalized.distance_min, 3200) : parentHorse.distance_max;
  normalized.running_style = typeof input.running_style === 'string' && RUNNING_STYLES[input.running_style]
    ? input.running_style
    : parentHorse.running_style;
  return normalized;
}

function buildHorseStatChange(target, horse) {
  const columnInfo = TARGET_TO_COLUMNS[target];
  if (!columnInfo) {
    throw createHttpError(400, '無効な target です');
  }
  const nextHorse = { ...horse };
  nextHorse[columnInfo.growth] += 1;
  if (target === 'distance_min') {
    nextHorse.distance_min = clamp(horse.distance_min - 200, 1000, horse.distance_max);
  } else if (target === 'distance_max') {
    nextHorse.distance_max = clamp(horse.distance_max + 200, horse.distance_min, 3200);
  } else {
    nextHorse[columnInfo.rank] = clamp(horse[columnInfo.rank] + 1, 0, 26);
  }
  return nextHorse;
}

function gaussianNoise(mean = 0, sd = 1) {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * sd;
}

function getDistanceRange(horse) {
  return {
    min: horse.distance_min ?? 1000,
    max: horse.distance_max ?? 3200,
  };
}

function generateRaceConfig() {
  const courseType = RACE_COURSES[Math.floor(Math.random() * RACE_COURSES.length)];
  const trackType = RACE_TRACKS[Math.floor(Math.random() * RACE_TRACKS.length)];
  const options = DISTANCE_OPTIONS[courseType] ?? DISTANCE_OPTIONS.mile;
  const distance = options[Math.floor(Math.random() * options.length)];
  return { courseType, trackType, distance };
}

function rollActualCondition(trueCondition) {
  return clamp(trueCondition + gaussianNoise(0, 0.25), 0, 1);
}

function conditionMultiplier(actualCondition) {
  return 0.75 + actualCondition * 0.5;
}

function applyConditionToStats(horse, actualCondition, raceConfig) {
  const condition = conditionMultiplier(actualCondition);
  const { min, max } = getDistanceRange(horse);
  const deviation = Math.max(min - raceConfig.distance, raceConfig.distance - max, 0);
  const distanceMultiplier = 1.0 - clamp(deviation / 2000, 0, 0.25);
  const fitValue = raceConfig.trackType === 'turf' ? horse.turfFit : horse.dirtFit;
  const trackMultiplier = fitValue != null ? 1.0 + (fitValue - 93) / 200 : 1.0;
  const totalMultiplier = distanceMultiplier * trackMultiplier;
  return {
    speedReal: horse.speed * condition * totalMultiplier,
    staminaReal: horse.stamina * condition * totalMultiplier,
    stabilityReal: horse.stability * condition * totalMultiplier,
  };
}

function positionPhase(positionPercent) {
  if (positionPercent < 100 / 3) return 'early';
  if (positionPercent < (100 * 2) / 3) return 'middle';
  return 'late';
}

function globalPace(stepRatio) {
  if (stepRatio < 1 / 3) return 0.8;
  if (stepRatio < 2 / 3) return 1.0;
  return 1.2;
}

function calculateOdds(horses) {
  const strengths = horses.map((horse) => {
    const base = horse.speed * 0.25 + horse.stamina * 0.25 + horse.stability * 0.25 + horse.burst * 0.25;
    const conditionFactor = 0.8 + horse.displayCondition * 0.4;
    return base * conditionFactor;
  });
  const total = strengths.reduce((sum, value) => sum + value, 0);
  return horses.map((horse, index) => {
    const winProb = strengths[index] / total;
    const fairOdds = 1 / winProb;
    return {
      ...horse,
      winProb,
      odds: Math.max(1.1, roundToOneDecimal(fairOdds * 0.85)),
    };
  });
}

function initRaceState(horses, raceConfig) {
  return horses.map((horse) => {
    const actualCondition = rollActualCondition(horse.trueCondition);
    const adjusted = applyConditionToStats(horse, actualCondition, raceConfig);
    return {
      ...horse,
      actualCondition,
      ...adjusted,
      position: 0,
      finished: false,
      finishStep: null,
    };
  });
}

function stepRace(state, stepIndex) {
  const ratio = stepIndex / RACE_STEPS;
  const pace = globalPace(ratio);
  return state.map((horse) => {
    if (horse.finished) {
      return horse;
    }
    const phase = positionPhase(horse.position);
    const style = RUNNING_STYLES[horse.runningStyle] || RUNNING_STYLES['先行'];
    const styleMultiplier = style[phase];
    const realScore = horse.speedReal * 0.25 + horse.staminaReal * 0.25 + horse.stabilityReal * 0.25 + horse.burst * 0.25;
    const condition = conditionMultiplier(horse.actualCondition);
    const burstReal = horse.burst * condition;
    const burstMultiplier = phase === 'late' ? 1.0 + (burstReal - 68) / 300 : 1.0;
    const noiseRange = clamp(1.2 - horse.stabilityReal / 100, 0.05, 0.5);
    const randomFactor = 1 + (Math.random() * 2 - 1) * noiseRange;
    const advance = (realScore / 68) * styleMultiplier * pace * condition * burstMultiplier * randomFactor;
    const nextPosition = horse.position + advance;
    if (nextPosition >= 100) {
      return { ...horse, position: 100, finished: true, finishStep: stepIndex };
    }
    return { ...horse, position: nextPosition };
  });
}

function rankHorses(state) {
  return [...state]
    .sort((a, b) => {
      if (a.finished && b.finished) return a.finishStep - b.finishStep;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.position - a.position;
    })
    .map((horse, index) => ({ ...horse, rank: index + 1 }));
}

function transformHallOfFameHorse(row, index) {
  const trueCondition = Math.random();
  const displayCondition = clamp(trueCondition + gaussianNoise(0, 0.35), 0, 1);
  return {
    id: row.id,
    order: index + 1,
    name: row.horse_name,
    speed: rankToScore(row.speed_rank),
    stamina: rankToScore(row.stamina_rank),
    stability: rankToScore(row.stability_rank),
    burst: rankToScore(row.burst_rank),
    turfFit: rankToScore(row.turf_fit_rank),
    dirtFit: rankToScore(row.dirt_fit_rank),
    speedRank: row.speed_rank,
    staminaRank: row.stamina_rank,
    stabilityRank: row.stability_rank,
    burstRank: row.burst_rank,
    turfFitRank: row.turf_fit_rank,
    dirtFitRank: row.dirt_fit_rank,
    distance_min: row.distance_min,
    distance_max: row.distance_max,
    runningStyle: row.running_style,
    trueCondition,
    displayCondition,
  };
}

function buildPrizeForRank(raceGrade, rank) {
  const base = BASE_PRIZES[raceGrade] || 0;
  if (rank === 1) return base;
  if (rank === 2) return Math.floor(base * 0.4);
  if (rank === 3) return Math.floor(base * 0.2);
  return 0;
}

function buildExpForRank(raceGrade, rank) {
  const rankBase = rank === 1 ? 100 : rank === 2 ? 70 : rank === 3 ? 50 : rank === 4 ? 30 : rank === 5 ? 15 : 0;
  const multiplier = EXP_MULTIPLIERS[raceGrade] ?? 1.0;
  return Math.floor(rankBase * multiplier);
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
      'SELECT id, username, coins, next_race_distance, next_race_track FROM users WHERE id = $1',
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

app.get('/api/user', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const user = await getUserById(client, req.userId);
    if (!user) {
      return res.status(404).json({ error: 'ユーザーが見つかりません' });
    }
    res.json(user);
  } catch (err) {
    handleApiError(res, err, 'ユーザー情報の取得に失敗しました');
  } finally {
    client.release();
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
    for (const result of results) {
      if (!grouped.has(result.race_id)) grouped.set(result.race_id, []);
      grouped.get(result.race_id).push(result);
    }
    res.json(
      races.map((race) => ({
        ...race,
        results: grouped.get(race.id) || [],
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
    for (const result of results) {
      await client.query(
        `INSERT INTO race_results (race_id, horse_id, rank, true_condition)
         VALUES ($1, $2, $3, $4)`,
        [race.id, result.horse_id, result.rank, result.true_condition ?? 0.5]
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

// 現在の育成馬取得
app.get('/api/horse', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const horse = await getActiveHorse(client, req.userId);
    if (!horse) {
      return res.json(null);
    }
    const syncedHorse = await syncHorseRaceStats(client, horse.id);
    await syncUserTotalPrize(client, req.userId);
    res.json(syncedHorse);
  } catch (err) {
    handleApiError(res, err, '育成馬の取得に失敗しました');
  } finally {
    client.release();
  }
});

app.get('/api/horse/me', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const horse = await getActiveHorse(client, req.userId);
    if (!horse) {
      return res.json({ horse: null });
    }
    const syncedHorse = await syncHorseRaceStats(client, horse.id);
    await syncUserTotalPrize(client, req.userId);
    res.json({ horse: syncedHorse });
  } catch (err) {
    handleApiError(res, err, '育成馬の取得に失敗しました');
  } finally {
    client.release();
  }
});

// ガチャ実行
app.post('/api/gacha', authMiddleware, async (req, res) => {
  const { gachaType, count } = req.body || {};
  const normalizedCount = normalizeGachaCount(count);
  if (!VALID_GACHA_TYPES.includes(gachaType)) {
    return res.status(400).json({ error: '無効な gachaType です' });
  }
  if (!VALID_GACHA_COUNTS.includes(normalizedCount)) {
    return res.status(400).json({ error: 'count は 1 または 10 である必要があります' });
  }
  const totalCost = GACHA_COSTS[gachaType][normalizedCount];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const activeHorse = await getActiveHorse(client, req.userId, true);
    if (activeHorse) {
      throw createHttpError(400, '既に育成馬がいるため採用できません');
    }
    const user = await deductCoins(client, req.userId, totalCost);
    const inserted = [];
    const unitCost = Math.floor(totalCost / normalizedCount);
    for (let i = 0; i < normalizedCount; i += 1) {
      const candidate = buildGachaHorse(gachaType);
      const { rows } = await client.query(
        `INSERT INTO gacha_results (
          user_id, gacha_type, speed_rank, stamina_rank, stability_rank, burst_rank,
          turf_fit_rank, dirt_fit_rank, distance_min, distance_max, running_style, cost
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *`,
        [
          req.userId,
          candidate.gacha_type,
          candidate.speed_rank,
          candidate.stamina_rank,
          candidate.stability_rank,
          candidate.burst_rank,
          candidate.turf_fit_rank,
          candidate.dirt_fit_rank,
          candidate.distance_min,
          candidate.distance_max,
          candidate.running_style,
          unitCost,
        ]
      );
      inserted.push(rows[0]);
    }
    await client.query('COMMIT');
    res.status(201).json({ results: inserted, remainingCoins: user.coins });
  } catch (err) {
    await client.query('ROLLBACK');
    handleApiError(res, err, 'ガチャの実行に失敗しました');
  } finally {
    client.release();
  }
});

// ガチャ結果を採用して育成馬作成
app.post('/api/horse/adopt', authMiddleware, async (req, res) => {
  const { gachaId, name } = req.body || {};
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!Number.isInteger(gachaId)) {
    return res.status(400).json({ error: 'gachaId は整数である必要があります' });
  }
  if (!trimmedName) {
    return res.status(400).json({ error: 'name は必須です' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const activeHorse = await getActiveHorse(client, req.userId, true);
    if (activeHorse) {
      throw createHttpError(400, '既に育成馬がいます');
    }
    const { rows: gachaRows } = await client.query(
      'SELECT * FROM gacha_results WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [gachaId, req.userId]
    );
    if (gachaRows.length === 0) {
      throw createHttpError(404, 'ガチャ結果が見つかりません');
    }
    const gacha = gachaRows[0];
    if (gacha.adopted) {
      throw createHttpError(400, 'そのガチャ結果は既に採用済みです');
    }
    await client.query('UPDATE gacha_results SET adopted = TRUE WHERE id = $1', [gachaId]);
    const { rows } = await client.query(
      `INSERT INTO trained_horses (
        user_id, name, speed_rank, stamina_rank, stability_rank, burst_rank,
        turf_fit_rank, dirt_fit_rank, distance_min, distance_max, running_style,
        generation, parent_id, inheritance_bonus_percent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1, NULL, 0)
      RETURNING *`,
      [
        req.userId,
        trimmedName,
        gacha.speed_rank,
        gacha.stamina_rank,
        gacha.stability_rank,
        gacha.burst_rank,
        gacha.turf_fit_rank,
        gacha.dirt_fit_rank,
        gacha.distance_min,
        gacha.distance_max,
        gacha.running_style,
      ]
    );
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    handleApiError(res, err, '育成馬の採用に失敗しました');
  } finally {
    client.release();
  }
});

// 調教・飼葉実行
app.post('/api/horse/train', authMiddleware, async (req, res) => {
  const { type, grade, target } = req.body || {};
  if (type !== 'training' && type !== 'feed') {
    return res.status(400).json({ error: 'type は training または feed である必要があります' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let horse = await getActiveHorse(client, req.userId, true);
    if (!horse) {
      throw createHttpError(404, '育成馬が見つかりません');
    }
    horse = await syncHorseRaceStats(client, horse.id);
    if (type === 'training' && horse.trained_this_week) {
      throw createHttpError(400, '今週の調教は実施済みです');
    }
    if (type === 'feed' && horse.fed_this_week) {
      throw createHttpError(400, '今週の飼葉は与え済みです');
    }

    if (type === 'training' && SPECIAL_RUNNING_STYLES.includes(target)) {
      const user = await deductCoins(client, req.userId, SPECIAL_TRAINING_COST);
      if (horse.running_style === target) {
        throw createHttpError(400, '既にその脚質です');
      }
      horse = await updateHorse(client, horse.id, {
        running_style: target,
        training_count: horse.training_count + 1,
        total_coins_invested: horse.total_coins_invested + SPECIAL_TRAINING_COST,
        trained_this_week: true,
      });
      await client.query(
        `INSERT INTO training_logs (horse_id, user_id, type, grade, target, cost, success, stat_changed)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7)`,
        [horse.id, req.userId, type, grade || '特別', target, SPECIAL_TRAINING_COST, 'running_style']
      );
      await client.query('COMMIT');
      return res.json({
        success: true,
        type,
        grade: grade || '特別',
        target,
        cost: SPECIAL_TRAINING_COST,
        remainingCoins: user.coins,
        horse,
      });
    }

    if (type === 'training') {
      if (!TRAINING_CONFIG[grade]) {
        throw createHttpError(400, '無効な grade です');
      }
      if (!TRAINING_TARGETS.includes(target)) {
        throw createHttpError(400, '無効な target です');
      }
      const user = await deductCoins(client, req.userId, TRAINING_CONFIG[grade].cost);
      const targetColumn = TARGET_TO_COLUMNS[target];
      const chance = calculateGrowthChance(
        horse[targetColumn.growth],
        TRAINING_CONFIG[grade].multiplier,
        horse.inheritance_bonus_percent || 0
      );
      const success = Math.random() * 100 < chance;
      let updatedHorse = horse;
      if (success) {
        const nextHorse = buildHorseStatChange(target, horse);
        updatedHorse = await updateHorse(client, horse.id, {
          [targetColumn.rank]: nextHorse[targetColumn.rank],
          [targetColumn.growth]: nextHorse[targetColumn.growth],
          training_count: horse.training_count + 1,
          total_coins_invested: horse.total_coins_invested + TRAINING_CONFIG[grade].cost,
          trained_this_week: true,
        });
      } else {
        updatedHorse = await updateHorse(client, horse.id, {
          training_count: horse.training_count + 1,
          total_coins_invested: horse.total_coins_invested + TRAINING_CONFIG[grade].cost,
          trained_this_week: true,
        });
      }
      await client.query(
        `INSERT INTO training_logs (horse_id, user_id, type, grade, target, cost, success, stat_changed)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          horse.id,
          req.userId,
          type,
          grade,
          target,
          TRAINING_CONFIG[grade].cost,
          success,
          success ? target : null,
        ]
      );
      await client.query('COMMIT');
      return res.json({
        success,
        type,
        grade,
        target,
        chance: roundToOneDecimal(chance),
        cost: TRAINING_CONFIG[grade].cost,
        remainingCoins: user.coins,
        horse: updatedHorse,
      });
    }

    if (!FEED_CONFIG[grade]) {
      throw createHttpError(400, '無効な grade です');
    }
    const selectedTargets = shuffle(FEED_TARGETS).slice(0, 2);
    const user = await deductCoins(client, req.userId, FEED_CONFIG[grade].cost);
    const nextFields = {
      training_count: horse.training_count + 1,
      total_coins_invested: horse.total_coins_invested + FEED_CONFIG[grade].cost,
      fed_this_week: true,
    };
    const results = [];
    for (const selectedTarget of selectedTargets) {
      const targetColumn = TARGET_TO_COLUMNS[selectedTarget];
      const currentGrowth = nextFields[targetColumn.growth] ?? horse[targetColumn.growth];
      const currentRank = nextFields[targetColumn.rank] ?? horse[targetColumn.rank];
      const chance = calculateGrowthChance(
        currentGrowth,
        FEED_CONFIG[grade].multiplier,
        horse.inheritance_bonus_percent || 0
      );
      const success = Math.random() * 100 < chance;
      if (success) {
        nextFields[targetColumn.growth] = currentGrowth + 1;
        nextFields[targetColumn.rank] = clamp(currentRank + 1, 0, 26);
      }
      results.push({ target: selectedTarget, chance: roundToOneDecimal(chance), success });
    }
    const updatedHorse = await updateHorse(client, horse.id, nextFields);
    const changedTargets = results.filter((item) => item.success).map((item) => item.target);
    await client.query(
      `INSERT INTO training_logs (horse_id, user_id, type, grade, target, cost, success, stat_changed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        horse.id,
        req.userId,
        type,
        grade,
        selectedTargets.join(','),
        FEED_CONFIG[grade].cost,
        changedTargets.length > 0,
        changedTargets.length > 0 ? changedTargets.join(',') : null,
      ]
    );
    await client.query('COMMIT');
    res.json({
      type,
      grade,
      cost: FEED_CONFIG[grade].cost,
      remainingCoins: user.coins,
      results,
      horse: updatedHorse,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    handleApiError(res, err, '調教の実行に失敗しました');
  } finally {
    client.release();
  }
});

// 引退処理
app.post('/api/horse/retire', authMiddleware, async (req, res) => {
  const { hallOfFame, inheritanceType } = req.body || {};
  if (typeof hallOfFame !== 'boolean') {
    return res.status(400).json({ error: 'hallOfFame は boolean である必要があります' });
  }
  if (!INHERITANCE_RISK[inheritanceType]) {
    return res.status(400).json({ error: '無効な inheritanceType です' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let horse = await getActiveHorse(client, req.userId, true);
    if (!horse) {
      throw createHttpError(404, '育成馬が見つかりません');
    }
    horse = await syncHorseRaceStats(client, horse.id);
    await syncUserTotalPrize(client, req.userId);
    const { inheritedRanks, bonusStages, inheritedDistanceMin, inheritedDistanceMax } = buildInheritanceRanks(horse, inheritanceType);
    if (hallOfFame) {
      await client.query(
        `INSERT INTO hall_of_fame (
          user_id, horse_name, generation, speed_rank, stamina_rank, stability_rank, burst_rank,
          turf_fit_rank, dirt_fit_rank, distance_min, distance_max, running_style,
          total_races, total_wins, total_prize, win_g1, level
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          req.userId,
          horse.name,
          horse.generation,
          horse.speed_rank,
          horse.stamina_rank,
          horse.stability_rank,
          horse.burst_rank,
          horse.turf_fit_rank,
          horse.dirt_fit_rank,
          horse.distance_min,
          horse.distance_max,
          horse.running_style,
          horse.total_races,
          horse.total_wins,
          horse.total_prize,
          horse.win_g1,
          horse.level,
        ]
      );
    }
    horse = await updateHorse(client, horse.id, {
      is_retired: true,
      is_hall_of_fame: hallOfFame,
    });
    await client.query('COMMIT');
    res.json({
      horse,
      inheritanceType,
      bonusStages,
      levelBonusPercent: inheritedRanks.level_bonus_percent,
      inheritedRanks,
      inheritedDistanceMin,
      inheritedDistanceMax,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    handleApiError(res, err, '引退処理に失敗しました');
  } finally {
    client.release();
  }
});

// 育成馬削除
app.post('/api/horse/delete', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const horse = await getLatestManagedHorse(client, req.userId, true);
    if (!horse) {
      throw createHttpError(404, '削除対象の育成馬が見つかりません');
    }
    const deletedHorse = await updateHorse(client, horse.id, { is_deleted: true });
    await client.query('COMMIT');
    res.json(deletedHorse);
  } catch (err) {
    await client.query('ROLLBACK');
    handleApiError(res, err, '育成馬の削除に失敗しました');
  } finally {
    client.release();
  }
});

// 継承馬作成
app.post('/api/horse/inherit', authMiddleware, async (req, res) => {
  const { name, inheritedRanks, distanceMin, distanceMax } = req.body || {};
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName) {
    return res.status(400).json({ error: 'name は必須です' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const activeHorse = await getActiveHorse(client, req.userId, true);
    if (activeHorse) {
      throw createHttpError(400, '既に育成馬がいます');
    }
    const parentHorse = await getLatestRetiredHorse(client, req.userId, true);
    if (!parentHorse) {
      throw createHttpError(404, '継承元の育成馬が見つかりません');
    }
    // body の distanceMin / distanceMax を distance_min / distance_max として反映
    const ranksWithDistance = {
      ...inheritedRanks,
      ...(Number.isInteger(distanceMin) ? { distance_min: distanceMin } : {}),
      ...(Number.isInteger(distanceMax) ? { distance_max: distanceMax } : {}),
    };
    const normalizedRanks = normalizeInheritedRanks(ranksWithDistance, parentHorse);
    const inheritanceBonusPercent = getLevelBonusPercent(parentHorse.level);
    const { rows } = await client.query(
      `INSERT INTO trained_horses (
        user_id, name, speed_rank, stamina_rank, stability_rank, burst_rank,
        turf_fit_rank, dirt_fit_rank, distance_min, distance_max, running_style,
        generation, parent_id, inheritance_bonus_percent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        req.userId,
        trimmedName,
        normalizedRanks.speed_rank,
        normalizedRanks.stamina_rank,
        normalizedRanks.stability_rank,
        normalizedRanks.burst_rank,
        normalizedRanks.turf_fit_rank,
        normalizedRanks.dirt_fit_rank,
        normalizedRanks.distance_min,
        normalizedRanks.distance_max,
        normalizedRanks.running_style,
        parentHorse.generation + 1,
        parentHorse.id,
        inheritanceBonusPercent,
      ]
    );
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    handleApiError(res, err, '継承馬の作成に失敗しました');
  } finally {
    client.release();
  }
});

// 出走可能レース取得
app.get('/api/horse/races', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    let horse = await getActiveHorse(client, req.userId);
    if (!horse) {
      throw createHttpError(404, '育成馬が見つかりません');
    }
    horse = await syncHorseRaceStats(client, horse.id);
    await syncUserTotalPrize(client, req.userId);
    res.json({ grades: determineAvailableRaceGrades(horse) });
  } catch (err) {
    handleApiError(res, err, '出走可能レースの取得に失敗しました');
  } finally {
    client.release();
  }
});

// レース登録
app.post('/api/horse/enter', authMiddleware, async (req, res) => {
  const { raceName, raceGrade, distance, trackType } = req.body || {};
  const normalizedRaceGrade = normalizeRaceGrade(raceGrade);
  const normalizedTrackType = normalizeTrackType(trackType);
  if (!raceName || typeof raceName !== 'string') {
    return res.status(400).json({ error: 'raceName は必須です' });
  }
  if (!Number.isInteger(distance) || distance < 1000 || distance > 3200) {
    return res.status(400).json({ error: 'distance は1000〜3200の整数である必要があります' });
  }
  if (!normalizedTrackType) {
    return res.status(400).json({ error: '無効な trackType です' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let horse = await getActiveHorse(client, req.userId, true);
    if (!horse) {
      throw createHttpError(404, '育成馬が見つかりません');
    }
    horse = await syncHorseRaceStats(client, horse.id);
    const availableGrades = determineAvailableRaceGrades(horse);
    const selectedRaceGrade = normalizedRaceGrade || availableGrades[0];
    if (!selectedRaceGrade) {
      throw createHttpError(400, '出走可能なレースグレードがありません');
    }
    if (!availableGrades.includes(selectedRaceGrade)) {
      throw createHttpError(400, 'そのレースグレードにはまだ出走できません');
    }
    const { rows } = await client.query(
      `UPDATE users
          SET next_race_distance = $1,
              next_race_track = $2
        WHERE id = $3
        RETURNING id, username, coins, current_week, total_prize, next_race_distance, next_race_track`,
      [distance, normalizedTrackType, req.userId]
    );
    if (rows.length === 0) {
      throw createHttpError(404, 'ユーザーが見つかりません');
    }
    await client.query('COMMIT');
    res.status(201).json({
      message: '出走登録が完了しました',
      raceName: raceName.trim(),
      raceGrade: selectedRaceGrade,
      distance,
      trackType: normalizedTrackType,
      horse,
      user: rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    handleApiError(res, err, 'レース登録に失敗しました');
  } finally {
    client.release();
  }
});

app.post('/api/horse/race-result', authMiddleware, async (req, res) => {
  const {
    rank,
    prize,
    expGained,
    raceName,
    raceGrade,
    distance,
    trackType,
  } = req.body || {};
  const normalizedRaceGrade = normalizeRaceGrade(raceGrade);
  const normalizedTrackType = normalizeTrackType(trackType);

  if (!raceName || typeof raceName !== 'string') {
    return res.status(400).json({ error: 'raceName は必須です' });
  }
  if (!normalizedRaceGrade) {
    return res.status(400).json({ error: '無効な raceGrade です' });
  }
  if (!Number.isInteger(rank) || rank < 1 || rank > 8) {
    return res.status(400).json({ error: 'rank は1〜8の整数である必要があります' });
  }
  if (!Number.isInteger(prize) || prize < 0) {
    return res.status(400).json({ error: 'prize は0以上の整数である必要があります' });
  }
  if (!Number.isInteger(expGained) || expGained < 0) {
    return res.status(400).json({ error: 'expGained は0以上の整数である必要があります' });
  }
  if (!Number.isInteger(distance) || distance < 1000 || distance > 3200) {
    return res.status(400).json({ error: 'distance は1000〜3200の整数である必要があります' });
  }
  if (!normalizedTrackType) {
    return res.status(400).json({ error: '無効な trackType です' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const horse = await getActiveHorse(client, req.userId, true);
    if (!horse) {
      throw createHttpError(404, '育成馬が見つかりません');
    }
    const user = await getUserById(client, req.userId, true);
    if (!user) {
      throw createHttpError(404, 'ユーザーが見つかりません');
    }

    const beforeLevel = horse.level || 1;
    const { rows: raceRows } = await client.query(
      'INSERT INTO races (held_at) VALUES (NOW()) RETURNING id, held_at, created_at'
    );
    const createdRace = raceRows[0];

    const { rows: resultRows } = await client.query(
      `INSERT INTO horse_race_results (
        horse_id, user_id, race_id, race_grade, race_name, distance, track_type, rank, prize, exp_gained
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        horse.id,
        req.userId,
        createdRace.id,
        normalizedRaceGrade,
        raceName.trim(),
        distance,
        normalizedTrackType,
        rank,
        prize,
        expGained,
      ]
    );

    const syncedHorse = await syncHorseRaceStats(client, horse.id);
    const levelUp = (syncedHorse.level || 1) > beforeLevel;

    await client.query(
      `UPDATE users
          SET coins = coins + $1,
              next_race_distance = NULL,
              next_race_track = NULL
        WHERE id = $2`,
      [prize, req.userId]
    );
    await syncUserTotalPrize(client, req.userId);
    const updatedUser = await getUserById(client, req.userId);

    await client.query('COMMIT');
    res.json({
      levelUp,
      horse: syncedHorse,
      user: updatedUser,
      raceResult: resultRows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    handleApiError(res, err, 'レース結果の保存に失敗しました');
  } finally {
    client.release();
  }
});

// 週送り
app.post('/api/week/advance', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE users
          SET current_week = CASE WHEN current_week >= 52 THEN 1 ELSE current_week + 1 END
        WHERE id = $1
        RETURNING id, username, coins, current_week`,
      [req.userId]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'ユーザーが見つかりません' });
    }
    await client.query(
      `UPDATE trained_horses
          SET trained_this_week = FALSE,
              fed_this_week = FALSE,
              updated_at = NOW()
        WHERE user_id = $1
          AND is_deleted = FALSE
          AND is_retired = FALSE`,
      [req.userId]
    );
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: '週送りに失敗しました' });
  } finally {
    client.release();
  }
});

// 殿堂入り馬一覧
app.get('/api/hall-of-fame', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM hall_of_fame WHERE user_id = $1 ORDER BY id DESC',
      [req.userId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '殿堂入り一覧の取得に失敗しました' });
  }
});

// 殿堂入り戦
app.post('/api/hall-of-fame/battle', authMiddleware, async (req, res) => {
  const { horseIds } = req.body || {};
  if (!Array.isArray(horseIds)) {
    return res.status(400).json({ error: 'horseIds は配列である必要があります' });
  }
  const uniqueHorseIds = [...new Set(horseIds)];
  if (uniqueHorseIds.length < 2 || uniqueHorseIds.length > 8 || uniqueHorseIds.some((id) => !Number.isInteger(id))) {
    return res.status(400).json({ error: 'horseIds は2〜8頭の整数IDで指定してください' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT * FROM hall_of_fame WHERE user_id = $1 AND id = ANY($2::int[]) ORDER BY id ASC',
      [req.userId, uniqueHorseIds]
    );
    if (rows.length !== uniqueHorseIds.length) {
      return res.status(404).json({ error: '指定された殿堂入り馬が見つかりません' });
    }
    const selected = uniqueHorseIds.map((id) => rows.find((row) => row.id === id));
    const raceConfig = generateRaceConfig();
    const horses = calculateOdds(selected.map((row, index) => transformHallOfFameHorse(row, index)));
    let state = initRaceState(horses, raceConfig);
    for (let stepIndex = 0; stepIndex <= RACE_STEPS; stepIndex += 1) {
      if (state.every((horse) => horse.finished)) {
        break;
      }
      state = stepRace(state, stepIndex);
    }
    const ranked = rankHorses(state).map((horse) => ({
      id: horse.id,
      name: horse.name,
      rank: horse.rank,
      odds: horse.odds,
      runningStyle: horse.runningStyle,
      speedRank: horse.speedRank,
      staminaRank: horse.staminaRank,
      stabilityRank: horse.stabilityRank,
      burstRank: horse.burstRank,
      finishStep: horse.finishStep,
      actualCondition: roundToOneDecimal(horse.actualCondition),
    }));
    res.json({ raceConfig, results: ranked });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '殿堂入り戦の実行に失敗しました' });
  }
});

// G1勝利数ランキング
app.get('/api/ranking/g1wins', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
          u.id AS user_id,
          u.username,
          COALESCE(th.total_g1, 0) + COALESCE(hf.total_g1, 0) AS total_g1_wins
         FROM users u
         LEFT JOIN (
           SELECT user_id, SUM(win_g1)::BIGINT AS total_g1
             FROM trained_horses
            WHERE is_deleted = FALSE
            GROUP BY user_id
         ) th ON th.user_id = u.id
         LEFT JOIN (
           SELECT user_id, SUM(win_g1)::BIGINT AS total_g1
             FROM hall_of_fame
            GROUP BY user_id
         ) hf ON hf.user_id = u.id
         ORDER BY total_g1_wins DESC, u.username ASC
         LIMIT 20`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'ランキング取得に失敗しました' });
  }
});

// 総賞金ランキング
app.get('/api/ranking/prize', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
          u.id AS user_id,
          u.username,
          COALESCE(th.total_prize, 0) + COALESCE(hf.total_prize, 0) AS total_prize
         FROM users u
         LEFT JOIN (
           SELECT user_id, SUM(total_prize)::BIGINT AS total_prize
             FROM trained_horses
            WHERE is_deleted = FALSE
            GROUP BY user_id
         ) th ON th.user_id = u.id
         LEFT JOIN (
           SELECT user_id, SUM(total_prize)::BIGINT AS total_prize
             FROM hall_of_fame
            GROUP BY user_id
         ) hf ON hf.user_id = u.id
         ORDER BY total_prize DESC, u.username ASC
         LIMIT 20`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'ランキング取得に失敗しました' });
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
