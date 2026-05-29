// 競馬予想ゲームのコアロジック
// UI 層に依存しない純粋関数として実装する
// 仕様の要約：
//   - 馬は 8 頭。speed/stamina/stability は 50〜90 のランダム値。
//   - trueCondition（非表示）と displayCondition（表示）で「調子」を二重構造化。
//   - 脚質は 7 種類。各脚質ごとに序盤/中盤/終盤の倍率を持つ。
//   - レースは 145 ステップ、120ms 間隔。各馬の現在位置で位置フェーズを判定する。
//   - グローバルペース：序盤×0.8 / 中盤×1.0 / 終盤×1.2。

// ---------- 定数 ----------

// 脚質テーブル（フェーズ倍率の合計が 3.10 になる）
export const RUNNING_STYLES = {
  大逃げ: { early: 1.8, middle: 1.0, late: 0.3, description: '序盤から全力。終盤でバテる' },
  逃げ: { early: 1.45, middle: 0.95, late: 0.7, description: '先頭を走りながらスタミナ温存' },
  先行: { early: 1.15, middle: 1.05, late: 0.9, description: '先団に位置し粘り強く走る' },
  差し: { early: 0.75, middle: 1.0, late: 1.35, description: '中団で足をため終盤に加速' },
  追込: { early: 0.6, middle: 0.8, late: 1.7, description: '後方から最後に一気に追い込む' },
  直線一気: { early: 0.4, middle: 0.65, late: 2.05, description: '最後方から直線で全力追い込み' },
  まくり: { early: 0.7, middle: 1.6, late: 0.8, description: '中盤から大外を豪快にまくる' },
};
export const RUNNING_STYLE_NAMES = Object.keys(RUNNING_STYLES);

// レース定数
export const RACE_STEPS = 145; // 総ステップ数
export const STEP_INTERVAL_MS = 120; // ステップ間隔

// ゲーム設定
export const HORSE_COUNT = 8;
export const INITIAL_COINS = 1000;
export const MIN_BET = 10;
export const HOUSE_MARGIN = 0.85; // 控除率15%
export const MIN_ODDS = 1.1;

// 馬名候補（ランダム生成用）
const HORSE_NAME_PARTS_A = [
  'スーパー', 'ゴールデン', 'ミラクル', 'シャイニング', 'グレート', 'ロイヤル',
  'クリスタル', 'サンダー', 'ライトニング', 'ホワイト', 'ダーク', 'ブレイブ',
  'ヴィクトリー', 'スカイ', 'シルバー', 'エメラルド',
];
const HORSE_NAME_PARTS_B = [
  'アロー', 'スター', 'ウィング', 'ラン', 'ハート', 'クラウン', 'ブレイズ',
  'ストーム', 'ドラゴン', 'フェニックス', 'ジェット', 'ロード', 'キング',
  'クイーン', 'ホープ', 'ドリーム',
];

// ---------- 乱数ユーティリティ ----------

// 標準正規分布に従う乱数（Box-Muller）
export function gaussianNoise(mean = 0, sd = 1) {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * sd;
}

// 値を [min, max] にクランプ
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// 整数乱数 [min, max]
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 重複を避けつつランダムな馬名を返す
function makeHorseName(used) {
  for (let i = 0; i < 50; i += 1) {
    const a = HORSE_NAME_PARTS_A[randInt(0, HORSE_NAME_PARTS_A.length - 1)];
    const b = HORSE_NAME_PARTS_B[randInt(0, HORSE_NAME_PARTS_B.length - 1)];
    const name = `${a}${b}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  // フォールバック
  const fallback = `ホース${used.size + 1}`;
  used.add(fallback);
  return fallback;
}

// ---------- 馬生成 ----------

// 1 頭の馬データを生成する
export function generateHorse(id, usedNames) {
  const speed = randInt(50, 90);
  const stamina = randInt(50, 90);
  const stability = randInt(50, 90);
  const runningStyle = RUNNING_STYLE_NAMES[randInt(0, RUNNING_STYLE_NAMES.length - 1)];
  const trueCondition = Math.random(); // 非表示
  const displayCondition = clamp(trueCondition + gaussianNoise(0, 0.2), 0, 1);
  return {
    id,
    name: makeHorseName(usedNames),
    speed,
    stamina,
    stability,
    runningStyle,
    trueCondition,
    displayCondition,
  };
}

// 出走馬一覧を生成する
export function generateHorses(count = HORSE_COUNT) {
  const used = new Set();
  return Array.from({ length: count }, (_, i) => generateHorse(i + 1, used));
}

// ---------- 調子バッジ ----------

// displayCondition からバッジ表記を返す
export function conditionBadge(displayCondition) {
  if (displayCondition >= 0.75) return { label: '絶好調', color: 'bg-rose-100 text-rose-700' };
  if (displayCondition >= 0.5) return { label: '好調', color: 'bg-amber-100 text-amber-700' };
  if (displayCondition >= 0.25) return { label: '普通', color: 'bg-slate-100 text-slate-700' };
  return { label: '不調', color: 'bg-sky-100 text-sky-700' };
}

// ---------- オッズ計算 ----------

// 各馬の強さスコア（オッズ用）。ベース値と displayCondition を使う。
function oddsStrength(horse) {
  const base = horse.speed * 0.5 + horse.stamina * 0.3 + horse.stability * 0.2;
  const conditionFactor = 0.8 + horse.displayCondition * 0.4; // 0.8〜1.2
  return base * conditionFactor;
}

// 出走馬全頭のオッズを計算する
export function calculateOdds(horses) {
  const strengths = horses.map(oddsStrength);
  const total = strengths.reduce((s, v) => s + v, 0);
  return horses.map((horse, i) => {
    const winProb = strengths[i] / total; // 推定勝率
    // 控除率15%（ハウスマージン0.85）を適用
    const fairOdds = 1 / winProb;
    const odds = Math.max(MIN_ODDS, fairOdds * HOUSE_MARGIN);
    return {
      ...horse,
      winProb,
      odds: Math.round(odds * 10) / 10, // 小数1桁
    };
  });
}

// ---------- レースシミュレーション ----------

// レース開始時に各馬の actualCondition を決定する
export function rollActualCondition(trueCondition) {
  return clamp(trueCondition + gaussianNoise(0, 0.25), 0, 1);
}

// actualCondition から調子係数を算出（0.85〜1.15）
export function conditionMultiplier(actualCondition) {
  return 0.85 + actualCondition * 0.3;
}

// 補正済みステータス値を返す
export function applyConditionToStats(horse, actualCondition) {
  const m = conditionMultiplier(actualCondition);
  return {
    speedReal: horse.speed * m,
    staminaReal: horse.stamina * m,
    stabilityReal: horse.stability * m,
  };
}

// 各馬の位置からフェーズを判定（0〜33% 序盤 / 33〜66% 中盤 / 66〜100% 終盤）
export function positionPhase(positionPercent) {
  if (positionPercent < 100 / 3) return 'early';
  if (positionPercent < (100 * 2) / 3) return 'middle';
  return 'late';
}

// グローバルペース（ステップ進行率による）
export function globalPace(stepRatio) {
  if (stepRatio < 1 / 3) return 0.8;
  if (stepRatio < 2 / 3) return 1.0;
  return 1.2;
}

// レースに参加する馬の内部状態を初期化する
export function initRaceState(horsesWithOdds) {
  return horsesWithOdds.map((h) => {
    const actualCondition = rollActualCondition(h.trueCondition);
    const stats = applyConditionToStats(h, actualCondition);
    return {
      ...h,
      actualCondition,
      ...stats,
      position: 0, // 0〜100
      finished: false,
      finishStep: null,
    };
  });
}

// 1 ステップ進める。状態（配列）を直接 mutate せず、新しい配列を返す。
export function stepRace(state, stepIndex) {
  const ratio = stepIndex / RACE_STEPS;
  const pace = globalPace(ratio);
  return state.map((h) => {
    if (h.finished) return h;
    const phase = positionPhase(h.position);
    const styleMult = RUNNING_STYLES[h.runningStyle][phase];
    const realScore = h.speedReal * 0.5 + h.staminaReal * 0.3 + h.stabilityReal * 0.2;
    const condMult = conditionMultiplier(h.actualCondition);
    // stability 実値が低いほど乱数幅が大きい
    const noiseRange = clamp(1.2 - h.stabilityReal / 120, 0.15, 0.7);
    const random = 1 + (Math.random() * 2 - 1) * noiseRange;
    const advance = (realScore / 75) * styleMult * pace * condMult * random;
    let newPos = h.position + advance;
    let finished = h.finished;
    let finishStep = h.finishStep;
    if (newPos >= 100) {
      newPos = 100;
      finished = true;
      finishStep = stepIndex;
    }
    return { ...h, position: newPos, finished, finishStep };
  });
}

// 終了判定（全馬完走 or ステップ上限）
export function isRaceFinished(state, stepIndex) {
  if (stepIndex >= RACE_STEPS) return true;
  return state.every((h) => h.finished);
}

// 着順を算出する（finishStep 昇順、未完走は position 降順）
export function rankHorses(state) {
  const sorted = [...state].sort((a, b) => {
    if (a.finished && b.finished) return a.finishStep - b.finishStep;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.position - a.position;
  });
  return sorted.map((h, i) => ({ ...h, rank: i + 1 }));
}

// ---------- ベット結果 ----------

// 払戻金額を返す（的中時のみ）
export function calcPayout(betAmount, odds) {
  return Math.floor(betAmount * odds);
}

// 的中判定
export function isWinningBet(rankedState, betHorseId) {
  if (betHorseId == null) return false;
  const top = rankedState.find((h) => h.rank === 1);
  return top && top.id === betHorseId;
}
