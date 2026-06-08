// 競馬予想ゲーム メイン画面
// 3 フェーズ（betting / racing / result）の UI と状態管理
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Trophy, Coins, Play, RotateCcw, Star, Wind, LogIn, LogOut, BarChart2, X } from 'lucide-react';
import {
  RUNNING_STYLES,
  STEP_INTERVAL_MS,
  RACE_STEPS,
  INITIAL_COINS,
  MIN_BET,
  HORSE_COUNT,
  BET_TYPES,
  DEBUG_RACE_DISTANCES,
  generateHorses,
  generateRaceConfig,
  buildRaceConfigByConditions,
  generateDebugHorses,
  generateDebugRaceConfig,
  generateRaceHorses,
  setNPCHorseGenerator,
  calculateOdds,
  calculateBetOdds,
  initRaceState,
  initDebugRaceState,
  stepRace,
  isRaceFinished,
  rankHorses,
  calcPayout,
  isWinningBetType,
  conditionBadge,
} from '../utils/game-logic.js';

const API_URL = import.meta.env.VITE_API_URL ?? '';

// ===== API ヘルパー =====

function getToken() {
  return localStorage.getItem('token');
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTPエラー ${res.status}`);
  return data;
}

async function apiRegister(username, password) {
  const data = await apiFetch('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  localStorage.setItem('token', data.token);
  return data.user;
}

async function apiLogin(username, password) {
  const data = await apiFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  localStorage.setItem('token', data.token);
  return data.user;
}

async function apiMe() {
  return apiFetch('/api/auth/me');
}

async function apiGetUser() {
  return apiFetch('/api/user');
}

async function apiUpdateCoins(coins) {
  return apiFetch('/api/auth/coins', {
    method: 'PATCH',
    body: JSON.stringify({ coins }),
  });
}

async function apiRecordBet(bet_type, bet_amount, payout, odds) {
  return apiFetch('/api/rankings/record', {
    method: 'POST',
    body: JSON.stringify({ bet_type, bet_amount, payout, odds }),
  });
}

async function apiRankingCoins() {
  return apiFetch('/api/rankings/coins');
}

async function apiRankingPayout(betType) {
  const path = betType ? `/api/rankings/payout/${encodeURIComponent(betType)}` : '/api/rankings/payout';
  return apiFetch(path);
}

// ===== 育成モード 定数 =====

// ステータスランクラベル（0=E- 〜 26=Z+）
const RANK_LABELS = [
  'E-','E','E+','D-','D','D+','C-','C','C+',
  'B-','B','B+','A-','A','A+','S-','S','S+',
  'SS-','SS','SS+','SSS-','SSS','SSS+','Z-','Z','Z+',
];

// ガチャ種別定義
const GACHA_TYPES = [
  { key: 'speed',     label: 'スピードガチャ',   single: 30000,   multi: 270000  },
  { key: 'stamina',   label: 'スタミナガチャ',   single: 30000,   multi: 270000  },
  { key: 'stability', label: '安定ガチャ',        single: 30000,   multi: 270000  },
  { key: 'burst',     label: '瞬発ガチャ',        single: 30000,   multi: 270000  },
  { key: 'turf',      label: '芝ガチャ',          single: 30000,   multi: 270000  },
  { key: 'dirt',      label: 'ダートガチャ',      single: 30000,   multi: 270000  },
  { key: 'premium',   label: 'プレミアムガチャ',  single: 500000,  multi: 4500000 },
];

// 調教種別定義
const TRAIN_TYPES = [
  { key: 'speed',        label: 'スピード',   special: false },
  { key: 'stamina',      label: 'スタミナ',   special: false },
  { key: 'stability',    label: '安定性',     special: false },
  { key: 'burst',        label: '瞬発力',     special: false },
  { key: 'turf_fit',     label: '芝適性',     special: false },
  { key: 'dirt_fit',     label: 'ダート適性', special: false },
  { key: 'distance_min', label: '短距離適性', special: false },
  { key: 'distance_max', label: '長距離適性', special: false },
  { key: 'running_style',label: '脚質変更',   special: true  },
];

// 調教グレード定義（コスト・成功率倍率）
const TRAIN_GRADES = [
  { key: '通常', label: '通常',  cost: 5000,   rateMult: 1.0  },
  { key: '上質', label: '上質',  cost: 20000,  rateMult: 1.1  },
  { key: '高級', label: '高級',  cost: 60000,  rateMult: 1.25 },
  { key: '英才', label: '英才',  cost: 150000, rateMult: 1.5  },
];

// 飼葉種別定義
const FEED_TYPES = [
  { key: 'normal',  label: '普通の飼葉',  cost: 500,   effect: '体力を少し回復する'    },
  { key: 'good',    label: '上質な飼葉',  cost: 2000,  effect: '体力を中程度回復する'  },
  { key: 'special', label: '特上飼葉',    cost: 8000,  effect: '体力を大きく回復する'  },
  { key: 'legend',  label: '幻の飼葉',    cost: 30000, effect: '体力を完全回復する'    },
];

// 固定レース（3勝クラス以下で表示）
const FIXED_RACES = [
  { name: 'フィクションレース', distance: 1600, track: 'turf' },
  { name: 'フィクションレース', distance: 1600, track: 'dirt' },
  { name: 'フィクションレース', distance: 2000, track: 'turf' },
  { name: 'フィクションレース', distance: 2000, track: 'dirt' },
  { name: 'フィクションレース', distance: 2400, track: 'turf' },
  { name: 'フィクションレース', distance: 2400, track: 'dirt' },
];

const TRAINING_RACE_BASE_PRIZES = {
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
const TRAINING_RACE_EXP_MULTIPLIERS = {
  g1: 10,
  g2: 7,
  g3: 5,
  open: 2,
  listed: 1.5,
};

// ===== 育成モード API =====

// 現在の育成馬を取得
async function apiGetHorse() {
  return apiFetch('/api/horse/me');
}

// ガチャを引く（gachaType: キー名, count: 1 or 10）
async function apiGacha(gachaType, count) {
  return apiFetch('/api/gacha', {
    method: 'POST',
    body: JSON.stringify({ gachaType, count }),
  });
}

// 馬を育成登録する
async function apiAdoptHorse(horseData, name) {
  const gachaId = horseData?.gachaId ?? horseData?.id;
  return apiFetch('/api/horse/adopt', {
    method: 'POST',
    body: JSON.stringify({ gachaId, name }),
  });
}

// 馬を引退させる（inheritType: 'low' | 'normal' | 'high'）
async function apiRetireHorse(inheritType) {
  return apiFetch('/api/horse/retire', {
    method: 'POST',
    body: JSON.stringify({ inherit_type: inheritType }),
  });
}

// 継承馬を登録する
async function apiInheritHorse(retireResultData, name) {
  return apiFetch('/api/horse/inherit', {
    method: 'POST',
    body: JSON.stringify({ ...retireResultData, name }),
  });
}

// 馬を抹消する
async function apiDeleteHorse() {
  return apiFetch('/api/horse/delete', { method: 'POST' });
}

// 調教を実施する
async function apiTrainHorse(target, grade) {
  return apiFetch('/api/horse/train', {
    method: 'POST',
    body: JSON.stringify({ type: 'training', grade, target }),
  });
}

// 飼葉を与える
async function apiFeedHorse(feedType) {
  return apiFetch('/api/horse/train', {
    method: 'POST',
    body: JSON.stringify({ type: 'feed', grade: feedType }),
  });
}

// 出走可能レース一覧を取得
async function apiGetRaces() {
  return apiFetch('/api/horse/races');
}

// レースに出走登録する
async function apiEnterRace(race) {
  return apiFetch('/api/horse/enter', {
    method: 'POST',
    body: JSON.stringify(race),
  });
}

async function apiSaveHorseRaceResult(payload) {
  return apiFetch('/api/horse/race-result', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// 殿堂入り馬一覧を取得
async function apiGetHallOfFame() {
  return apiFetch('/api/hall-of-fame');
}

// 殿堂馬でバトルを実施する
async function apiBattle(horseIds) {
  return apiFetch('/api/hall-of-fame/battle', {
    method: 'POST',
    body: JSON.stringify({ horse_ids: horseIds }),
  });
}

// ===== コンポーネント =====

// ステータス（グレードのみ）
function StatBar({ label, grade }) {
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-700">{grade}</span>
    </div>
  );
}

// 選択順・着順に対応するメダルバッジ情報（0始まりの index を渡す）
const MEDAL_BADGES = [
  { emoji: '🥇', label: '1着予想', bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-400' },
  { emoji: '🥈', label: '2着予想', bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-400' },
  { emoji: '🥉', label: '3着予想', bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-400' },
];

const COURSE_LABELS = {
  short: '短距離',
  mile: '中距離',
  long: '長距離',
};

function formatDistanceFit(distanceFit) {
  const map = {
    'short':      '1000〜1600m',
    'mile':       '1600〜2400m',
    'long':       '2400〜3200m',
    'short-mile': '1000〜2400m',
    'mile-long':  '1600〜3200m',
    'short-long': '1000〜3200m',
    'all':        '全距離対応',
  };
  return map[distanceFit] ?? distanceFit;
}

function normalizeRaceGrade(raceGrade) {
  return String(raceGrade || '').trim().toLowerCase();
}

function buildPrizeForTrainingRace(raceGrade, rank) {
  const base = TRAINING_RACE_BASE_PRIZES[normalizeRaceGrade(raceGrade)] ?? 0;
  if (rank === 1) return base;
  if (rank === 2) return Math.floor(base * 0.4);
  if (rank === 3) return Math.floor(base * 0.2);
  return 0;
}

function buildExpForTrainingRace(raceGrade, rank) {
  const base = rank === 1 ? 100 : rank === 2 ? 70 : rank === 3 ? 50 : rank === 4 ? 30 : rank === 5 ? 15 : 0;
  const mult = TRAINING_RACE_EXP_MULTIPLIERS[normalizeRaceGrade(raceGrade)] ?? 1.0;
  return Math.floor(base * mult);
}

// 馬カード（ベットフェーズ）
// selectionIndex: null=未選択, 0/1/2=選択順（0始まり）
// betType: 現在の賭け方（馬単/3連単のとき金銀銅バッジを表示）
function HorseCard({ horse, selectionIndex, betType, onSelect }) {
  const badge = conditionBadge(horse.displayCondition);
  const isSelected = selectionIndex !== null;
  const isPlayerHorse = Boolean(horse.isPlayerHorse);
  const useOrderedBadge = isSelected && (betType === '馬単' || betType === '3連単');
  const medalBadge = useOrderedBadge ? MEDAL_BADGES[selectionIndex] : null;
  return (
    <button
      type="button"
      onClick={() => onSelect(horse.id)}
      className={`text-left rounded-2xl shadow-sm hover:shadow-md transition border-2 ${
        isSelected
          ? medalBadge
            ? `${medalBadge.border} ring-2 ring-orange-100`
            : 'border-accent ring-2 ring-orange-200'
          : isPlayerHorse
            ? 'border-emerald-400'
            : 'border-transparent'
      } ${isPlayerHorse ? 'bg-emerald-50' : 'bg-white'} p-4 flex flex-col gap-2`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {medalBadge ? (
            <span
              className={`text-base leading-none ${medalBadge.bg} ${medalBadge.text} rounded-full w-7 h-7 flex items-center justify-center font-bold shrink-0`}
              title={medalBadge.label}
            >
              {medalBadge.emoji}
            </span>
          ) : isSelected ? (
            <span className="text-xs bg-accent text-white rounded-full w-5 h-5 flex items-center justify-center font-bold shrink-0">
              {selectionIndex + 1}
            </span>
          ) : null}
          <span className="text-xs bg-slate-100 text-slate-700 rounded-full px-2 py-0.5">
            #{horse.id}
          </span>
          <h3 className={`font-bold ${isPlayerHorse ? 'text-emerald-700' : 'text-slate-800'}`}>{horse.name}</h3>
        </div>
        <span className="text-accent font-bold">{horse.odds.toFixed(1)}倍</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs bg-indigo-100 text-indigo-700 rounded-full px-2 py-0.5">
          {horse.runningStyle}
        </span>
        <span className={`text-xs rounded-full px-2 py-0.5 ${badge.color}`}>
          {badge.label}
        </span>
        <span className="text-xs bg-slate-100 text-slate-500 rounded-full px-2 py-0.5">
          距離：{formatDistanceFit(horse.distanceFit)}
        </span>
      </div>
      <div className="flex flex-col gap-1 mt-1">
        <StatBar label="速さ" grade={horse.speedGrade} />
        <StatBar label="スタミナ" grade={horse.staminaGrade} />
        <StatBar label="安定性" grade={horse.stabilityGrade} />
        <StatBar label="瞬発力" grade={horse.burstGrade} />
        <StatBar label="芝適性" grade={horse.turfFitGrade} />
        <StatBar label="ダート適" grade={horse.dirtFitGrade} />
      </div>
    </button>
  );
}

// 脚質ガイド（サイドパネル）
function StyleGuide() {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-4">
      <div className="flex items-center gap-2 mb-3">
        <Wind className="w-4 h-4 text-accent" />
        <h3 className="font-bold text-slate-800">脚質ガイド</h3>
      </div>
      <ul className="space-y-2 text-xs">
        {Object.entries(RUNNING_STYLES).map(([name, info]) => (
          <li key={name} className="border-b border-slate-100 pb-2 last:border-b-0">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-700">{name}</span>
              <span className="text-slate-400">
                序{info.early} / 中{info.middle} / 終{info.late}
              </span>
            </div>
            <p className="text-slate-500 mt-0.5">{info.description}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

// レース情報バナー
function RaceInfoBanner({ raceConfig }) {
  if (!raceConfig) return null;
  const { courseType, trackType, distance } = raceConfig;
  const trackLabel = trackType === 'turf' ? '芝' : 'ダート';
  const courseLabel = COURSE_LABELS[courseType] ?? courseType;
  return (
    <div className="bg-white rounded-2xl shadow-sm px-4 py-2 flex items-center gap-4 text-sm text-slate-700 flex-wrap">
      <span className="font-bold text-slate-500">レース情報</span>
      <span>
        <span className="text-slate-400">距離：</span>
        <span className="font-bold text-slate-800">{distance}m</span>
      </span>
      <span>
        <span className="text-slate-400">馬場：</span>
        <span className="font-bold text-slate-800">{trackLabel}</span>
      </span>
      <span>
        <span className="text-slate-400">コース：</span>
        <span className="font-bold text-slate-800">{courseLabel}</span>
      </span>
    </div>
  );
}

// レース中のプログレスバー
function RaceTrack({ raceState, betHorseIds, betType }) {
  const useOrderedBadge = betType === '馬単' || betType === '3連単';

  // 順位順に並び替えて表示する
  const ordered = useMemo(() => {
    return [...raceState].sort((a, b) => {
      if (a.finished && b.finished) return a.finishStep - b.finishStep;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.position - a.position;
    });
  }, [raceState]);

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 flex flex-col gap-2">
      {ordered.map((h, idx) => {
        const betIdx = betHorseIds.indexOf(h.id);
        const isBet = betIdx !== -1;
        const isPlayerHorse = Boolean(h.isPlayerHorse);
        const medalBadge = isBet && useOrderedBadge ? MEDAL_BADGES[betIdx] : null;
        return (
          <div key={h.id} className="flex items-center gap-2">
            <span className="w-6 text-xs text-slate-400 text-right">{idx + 1}位</span>
            <span
              className={`w-36 truncate text-sm font-semibold flex items-center gap-1 ${
                isPlayerHorse ? 'text-emerald-700' : isBet ? 'text-accent' : 'text-slate-700'
              }`}
            >
              {medalBadge ? (
                <span
                  className={`text-base leading-none ${medalBadge.bg} ${medalBadge.text} rounded-full w-6 h-6 flex items-center justify-center shrink-0`}
                  title={medalBadge.label}
                >
                  {medalBadge.emoji}
                </span>
              ) : isBet ? (
                <Star className="w-3 h-3 shrink-0 fill-current" />
              ) : null}
              {h.name}
            </span>
            <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden relative">
              <div
                className={`h-full ${
                  isPlayerHorse ? 'bg-emerald-500' : isBet ? 'bg-accent' : 'bg-slate-400'
                }`}
                style={{ width: `${Math.min(100, h.position)}%`, transition: 'width 150ms linear' }}
              />
            </div>
            <span className="w-16 text-xs text-right text-slate-500">
              {h.runningStyle}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// 結果一覧
function ResultList({ ranking, betHorseIds, betType }) {
  const useOrderedBadge = betType === '馬単' || betType === '3連単';

  // 1着のfinishStepを取得
  const winnerFinishStep = useMemo(() => {
    const winner = ranking.find((h) => h.rank === 1);
    return winner ? winner.finishStep : null;
  }, [ranking]);

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4">
      <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
        <Trophy className="w-4 h-4 text-accent" />
        最終着順
      </h3>
      <ol className="space-y-1">
        {ranking.map((h) => {
          const betIdx = betHorseIds.indexOf(h.id);
          const isBet = betIdx !== -1;
          const isPlayerHorse = Boolean(h.isPlayerHorse);
          const medalBadge = isBet && useOrderedBadge ? MEDAL_BADGES[betIdx] : null;
          const badge = conditionBadge(h.displayCondition);

          // タイム差（1着からの差を秒換算）
          let timeDiff = null;
          if (h.rank === 1) {
            timeDiff = '+0.0秒';
          } else if (h.finishStep != null && winnerFinishStep != null) {
            const diffSec = ((h.finishStep - winnerFinishStep) * STEP_INTERVAL_MS) / 1000;
            timeDiff = `+${diffSec.toFixed(1)}秒`;
          }

          return (
            <li
              key={h.id}
              className={`flex items-center justify-between text-sm py-1 px-2 rounded ${
                isPlayerHorse ? 'bg-emerald-100' : isBet ? 'bg-orange-50' : ''
              }`}
            >
              <span className="flex items-center gap-2">
                {h.rank <= 3 ? (
                  <span
                    className="w-6 text-center text-base leading-none"
                    title={`${h.rank}着`}
                  >
                    {MEDAL_BADGES[h.rank - 1].emoji}
                  </span>
                ) : (
                  <span className="w-6 text-center text-xs font-bold rounded bg-slate-50 text-slate-500">
                    {h.rank}
                  </span>
                )}
                <span className={`font-semibold ${isPlayerHorse ? 'text-emerald-700' : isBet ? 'text-accent' : 'text-slate-700'}`}>
                  {medalBadge ? (
                    <span
                      className={`inline-flex items-center justify-center text-xs ${medalBadge.bg} ${medalBadge.text} rounded-full w-5 h-5 mr-1 font-bold`}
                      title={medalBadge.label}
                    >
                      {medalBadge.emoji}
                    </span>
                  ) : isBet ? (
                    <Star className="w-3 h-3 inline mr-1 fill-current" />
                  ) : null}
                  {h.name}
                </span>
                <span className="text-xs text-slate-400">({h.runningStyle})</span>
                <span className={`text-xs rounded-full px-1.5 py-0.5 ${badge.color}`}>
                  {badge.label}
                </span>
              </span>
              <span className="text-xs text-slate-400 ml-2 shrink-0">
                {timeDiff ?? '未完走'}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ===== 認証モーダル =====
function AuthModal({ onClose, onAuth }) {
  const [tab, setTab] = useState('login'); // login | register
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      let user;
      if (tab === 'login') {
        user = await apiLogin(username, password);
      } else {
        user = await apiRegister(username, password);
      }
      onAuth(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
        >
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
          <LogIn className="w-5 h-5 text-accent" />
          アカウント
        </h2>
        {/* タブ切り替え */}
        <div className="flex mb-4 border border-slate-200 rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => { setTab('login'); setError(''); }}
            className={`flex-1 py-2 text-sm font-semibold transition ${
              tab === 'login' ? 'bg-accent text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            ログイン
          </button>
          <button
            type="button"
            onClick={() => { setTab('register'); setError(''); }}
            className={`flex-1 py-2 text-sm font-semibold transition ${
              tab === 'register' ? 'bg-accent text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            新規登録
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">ユーザー名（3〜20文字の英数字）</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              maxLength={20}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-200 text-sm"
              placeholder="username"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">パスワード（6文字以上）</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-200 text-sm"
              placeholder="password"
            />
          </div>
          {error && <p className="text-xs text-rose-500">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="bg-accent hover:bg-orange-600 disabled:bg-slate-300 text-white font-bold py-2 rounded-xl transition"
          >
            {loading ? '処理中...' : tab === 'login' ? 'ログイン' : '新規登録'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ===== ランキングモーダル =====
const RANKING_BET_TABS = ['全馬券', '単勝', '複勝', '馬連', '馬単', '3連複', '3連単'];

function RankingModal({ onClose, authUser }) {
  const [tab, setTab] = useState('coins'); // coins | payout
  const [betTab, setBetTab] = useState('全馬券');
  const [coinsRanking, setCoinsRanking] = useState([]);
  const [payoutRanking, setPayoutRanking] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadCoins = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiRankingCoins();
      setCoinsRanking(data);
    } catch {
      // ランキング取得失敗時は空のまま
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPayout = useCallback(async (bt) => {
    setLoading(true);
    try {
      const data = await apiRankingPayout(bt === '全馬券' ? null : bt);
      setPayoutRanking(data);
    } catch {
      setPayoutRanking([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'coins') {
      loadCoins();
    } else {
      loadPayout(betTab);
    }
  }, [tab, betTab, loadCoins, loadPayout]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 relative max-h-[90vh] flex flex-col">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
        >
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
          <BarChart2 className="w-5 h-5 text-accent" />
          ランキング
        </h2>
        {/* メインタブ */}
        <div className="flex mb-3 border border-slate-200 rounded-lg overflow-hidden shrink-0">
          <button
            type="button"
            onClick={() => setTab('coins')}
            className={`flex-1 py-2 text-sm font-semibold transition ${
              tab === 'coins' ? 'bg-accent text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            総所持金
          </button>
          <button
            type="button"
            onClick={() => setTab('payout')}
            className={`flex-1 py-2 text-sm font-semibold transition ${
              tab === 'payout' ? 'bg-accent text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            一撃最高払戻
          </button>
        </div>
        {/* 馬券種別タブ（払戻時のみ） */}
        {tab === 'payout' && (
          <div className="flex flex-wrap gap-1 mb-3 shrink-0">
            {RANKING_BET_TABS.map((bt) => (
              <button
                key={bt}
                type="button"
                onClick={() => setBetTab(bt)}
                className={`px-2 py-1 text-xs rounded-lg font-semibold transition ${
                  betTab === bt ? 'bg-accent text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {bt}
              </button>
            ))}
          </div>
        )}
        <div className="overflow-y-auto flex-1">
          {loading ? (
            <p className="text-center text-slate-400 py-8">読み込み中...</p>
          ) : tab === 'coins' ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 text-xs border-b">
                  <th className="text-left pb-2 w-8">順位</th>
                  <th className="text-left pb-2">ユーザー名</th>
                  <th className="text-right pb-2">所持金</th>
                </tr>
              </thead>
              <tbody>
                {coinsRanking.length === 0 ? (
                  <tr><td colSpan={3} className="text-center text-slate-400 py-6">データがありません</td></tr>
                ) : coinsRanking.map((row, i) => (
                  <tr
                    key={i}
                    className={`border-b border-slate-50 ${authUser && row.username === authUser.username ? 'bg-orange-50 font-semibold' : ''}`}
                  >
                    <td className="py-2 text-slate-400">{i + 1}</td>
                    <td className="py-2 text-slate-800">{row.username}</td>
                    <td className="py-2 text-right text-accent font-bold">{row.coins.toLocaleString()}C</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 text-xs border-b">
                  <th className="text-left pb-2 w-8">順位</th>
                  <th className="text-left pb-2">ユーザー名</th>
                  <th className="text-left pb-2">馬券</th>
                  <th className="text-right pb-2">払戻</th>
                  <th className="text-right pb-2">倍率</th>
                </tr>
              </thead>
              <tbody>
                {payoutRanking.length === 0 ? (
                  <tr><td colSpan={5} className="text-center text-slate-400 py-6">データがありません</td></tr>
                ) : payoutRanking.map((row, i) => (
                  <tr
                    key={i}
                    className={`border-b border-slate-50 ${authUser && row.username === authUser.username ? 'bg-orange-50 font-semibold' : ''}`}
                  >
                    <td className="py-2 text-slate-400">{i + 1}</td>
                    <td className="py-2 text-slate-800">{row.username}</td>
                    <td className="py-2 text-slate-600">{row.bet_type}</td>
                    <td className="py-2 text-right text-accent font-bold">{Number(row.payout).toLocaleString()}C</td>
                    <td className="py-2 text-right text-slate-500">{Number(row.odds).toFixed(1)}倍</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ===== ログイン画面 =====
function LoginPage({ onAuth }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (mode === 'register' && password !== confirmPassword) {
      setError('パスワードが一致しません');
      return;
    }
    setLoading(true);
    try {
      let user;
      if (mode === 'login') {
        user = await apiLogin(username, password);
      } else {
        user = await apiRegister(username, password);
      }
      onAuth(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setUsername('');
    setPassword('');
    setConfirmPassword('');
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#F4F6F9' }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-8">
        <h1 className="text-2xl font-bold text-slate-800 text-center mb-6">🏇 KeibaSimu</h1>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">ユーザー名</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              maxLength={20}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-200 text-sm"
              placeholder="username"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">パスワード</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-200 text-sm"
              placeholder="password"
            />
          </div>
          {mode === 'register' && (
            <div>
              <label className="text-xs text-slate-500 mb-1 block">パスワード確認</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-200 text-sm"
                placeholder="パスワードを再入力"
              />
            </div>
          )}
          {error && <p className="text-xs text-rose-500">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="bg-accent hover:bg-orange-600 disabled:bg-slate-300 text-white font-bold py-2.5 rounded-xl transition"
          >
            {loading ? '処理中...' : mode === 'login' ? 'ログイン' : '登録'}
          </button>
        </form>
        <div className="mt-4 text-center">
          {mode === 'login' ? (
            <button
              type="button"
              onClick={() => switchMode('register')}
              className="text-xs text-slate-500 hover:text-slate-700 underline"
            >
              アカウントをお持ちでない方はこちら
            </button>
          ) : (
            <button
              type="button"
              onClick={() => switchMode('login')}
              className="text-xs text-slate-500 hover:text-slate-700 underline"
            >
              すでにアカウントをお持ちの方はこちら
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ===== 育成モード =====
// coins / setCoins: 親Pageから受け取るコイン状態
// authUser: 認証済みユーザー情報
function TrainingMode({ coins, setCoins, authUser, onRaceEntryRegistered }) {
  // タブ管理
  const [activeTab, setActiveTab] = useState('myHorse'); // myHorse | gacha | train | race | hallOfFame
  // 育成馬
  const [currentHorse, setCurrentHorse] = useState(null);
  const [horseLoading, setHorseLoading] = useState(false);
  // ガチャ
  const [gachaResult, setGachaResult] = useState([]);
  const [gachaLoading, setGachaLoading] = useState(false);
  const [adoptName, setAdoptName] = useState('');
  const [adoptLoading, setAdoptLoading] = useState(false);
  const [selectedGachaHorse, setSelectedGachaHorse] = useState(null);
  // 引退モーダル（false | 'confirm' | 'inherit' | 'inherit_name'）
  const [retireModal, setRetireModal] = useState(false);
  const [inheritType, setInheritType] = useState('normal');
  const [retireResultData, setRetireResultData] = useState(null);
  const [inheritName, setInheritName] = useState('');
  const [retireLoading, setRetireLoading] = useState(false);
  // 抹消モーダル
  const [deleteModal, setDeleteModal] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  // 調教・飼葉
  const [trainType, setTrainType] = useState('speed');
  const [trainGrade, setTrainGrade] = useState('通常');
  const [trainLoading, setTrainLoading] = useState(false);
  const [trainResult, setTrainResult] = useState(null);
  // 脚質変更で選択中の脚質
  const [selectedRunningStyle, setSelectedRunningStyle] = useState(null);
  // レース
  const [apiRaces, setApiRaces] = useState([]);
  const [racesLoading, setRacesLoading] = useState(false);
  const [raceResult, setRaceResult] = useState(null);
  const [enterLoading, setEnterLoading] = useState(false);
  // 殿堂入り
  const [hallOfFame, setHallOfFame] = useState([]);
  const [hofLoading, setHofLoading] = useState(false);
  const [battleSel, setBattleSel] = useState([]);
  const [battleResult, setBattleResult] = useState(null);
  const [battleLoading, setBattleLoading] = useState(false);
  // エラー
  const [error, setError] = useState('');

  // 育成馬データを取得
  const loadHorse = useCallback(async () => {
    setHorseLoading(true);
    try {
      const data = await apiGetHorse();
      setCurrentHorse(data.horse ?? null);
    } catch {
      setCurrentHorse(null);
    } finally {
      setHorseLoading(false);
    }
  }, []);

  // 初回マウント時に馬データ取得
  useEffect(() => {
    loadHorse();
  }, [loadHorse]);

  // タブ切り替え時の副作用（レース・殿堂情報の取得）
  useEffect(() => {
    if (activeTab === 'race' && currentHorse) {
      setRacesLoading(true);
      apiGetRaces()
        .then((data) => setApiRaces(data.races ?? []))
        .catch(() => setApiRaces([]))
        .finally(() => setRacesLoading(false));
    }
    if (activeTab === 'hallOfFame') {
      setHofLoading(true);
      apiGetHallOfFame()
        .then((data) => setHallOfFame(data.horses ?? []))
        .catch(() => setHallOfFame([]))
        .finally(() => setHofLoading(false));
    }
  }, [activeTab, currentHorse]);

  // ランクラベルを返すヘルパー
  const statLabel = (val) => RANK_LABELS[Math.max(0, Math.min(26, val ?? 0))];
  const gachaResults = Array.isArray(gachaResult) ? gachaResult : [];
  const isMultiGacha = gachaResults.length > 1;
  const selectedHorse = selectedGachaHorse ?? gachaResults[0] ?? null;
  const getHorseRank = (horse, key) => horse?.[`${key}_rank`] ?? horse?.[key];
  const closeGachaModal = () => {
    setGachaResult([]);
    setSelectedGachaHorse(null);
    setAdoptName('');
  };

  // 調教成功率の表示計算（UIのみ）
  // 式: 80 * (2/3)^成長段階数 * グレード倍率
  const calcSuccessRate = (growthStages, rateMult) => {
    const rate = 80 * Math.pow(2 / 3, growthStages ?? 0) * rateMult;
    return Math.min(100, rate).toFixed(1);
  };
  const isTrainingDoneThisWeek = Boolean(currentHorse?.trained_this_week);
  const isFeedDoneThisWeek = Boolean(currentHorse?.fed_this_week);

  // ガチャを引く
  const handleGacha = async (gachaType, count) => {
    const info = GACHA_TYPES.find((g) => g.key === gachaType);
    const cost = count === 1 ? info.single : info.multi;
    if (coins < cost) {
      setError(`コインが不足しています（必要: ${cost.toLocaleString()}C）`);
      return;
    }
    setError('');
    setGachaLoading(true);
    try {
      const data = await apiGacha(gachaType, count);
      const newCoins = coins - cost;
      setCoins(newCoins);
      if (authUser) apiUpdateCoins(newCoins).catch(() => {});
      setGachaResult(Array.isArray(data?.results) ? data.results : []);
      setSelectedGachaHorse(null);
      setAdoptName('');
    } catch (err) {
      setError(err.message);
    } finally {
      setGachaLoading(false);
    }
  };

  // 馬を育成登録する
  const handleAdopt = async (horse = null) => {
    const targetHorse = horse ?? selectedHorse;
    if (!targetHorse?.id) return;
    if (!adoptName.trim()) return;
    setAdoptLoading(true);
    try {
      await apiAdoptHorse({ gachaId: targetHorse.id }, adoptName.trim());
      const latestHorse = await apiGetHorse();
      setCurrentHorse(latestHorse?.horse ?? null);
      closeGachaModal();
      setActiveTab('myHorse');
    } catch (err) {
      setError(err.message);
    } finally {
      setAdoptLoading(false);
    }
  };

  // 引退処理（殿堂入り）
  const handleRetire = async () => {
    setRetireLoading(true);
    try {
      const data = await apiRetireHorse(inheritType);
      setRetireResultData(data);
      setCurrentHorse(null);
      onRaceEntryRegistered(null);
      setRetireModal('inherit_name');
    } catch (err) {
      setError(err.message);
      setRetireModal(false);
    } finally {
      setRetireLoading(false);
    }
  };

  // 継承処理
  const handleInherit = async () => {
    if (!inheritName.trim()) return;
    setRetireLoading(true);
    try {
      const data = await apiInheritHorse(retireResultData, inheritName.trim());
      setCurrentHorse(data.horse ?? null);
      onRaceEntryRegistered(null);
      setRetireModal(false);
      setRetireResultData(null);
      setInheritName('');
      setActiveTab('myHorse');
    } catch (err) {
      setError(err.message);
    } finally {
      setRetireLoading(false);
    }
  };

  // 抹消処理
  const handleDelete = async () => {
    setDeleteLoading(true);
    try {
      await apiDeleteHorse();
      setCurrentHorse(null);
      onRaceEntryRegistered(null);
      setDeleteModal(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleteLoading(false);
    }
  };

  // 調教を実施する
  const handleTrain = async () => {
    if (isTrainingDoneThisWeek) {
      setError('今週の調教は実施済みです');
      return;
    }
    const gradeInfo = TRAIN_GRADES.find((g) => g.key === trainGrade);
    if (coins < gradeInfo.cost) {
      setError(`コインが不足しています（必要: ${gradeInfo.cost.toLocaleString()}C）`);
      return;
    }
    setError('');
    setTrainLoading(true);
    try {
      const data = await apiTrainHorse(trainType, trainGrade);
      const cost = data.cost ?? gradeInfo.cost;
      const newCoins = coins - cost;
      setCoins(newCoins);
      if (authUser) apiUpdateCoins(newCoins).catch(() => {});
      if (data.horse) setCurrentHorse(data.horse);
      setTrainResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setTrainLoading(false);
    }
  };

  // 脚質変更を実施する（200,000C）
  const RUNNING_STYLE_CHANGE_COST = 200000;
  const handleChangeRunningStyle = async () => {
    if (isTrainingDoneThisWeek) {
      setError('今週の調教は実施済みです');
      return;
    }
    if (!selectedRunningStyle) {
      setError('変更先の脚質を選択してください');
      return;
    }
    if (coins < RUNNING_STYLE_CHANGE_COST) {
      setError(`コインが不足しています（必要: ${RUNNING_STYLE_CHANGE_COST.toLocaleString()}C）`);
      return;
    }
    setError('');
    setTrainLoading(true);
    try {
      const data = await apiFetch('/api/horse/train', {
        method: 'POST',
        body: JSON.stringify({ type: 'training', grade: 'special', target: 'running_style', runningStyle: selectedRunningStyle }),
      });
      const cost = data.cost ?? RUNNING_STYLE_CHANGE_COST;
      const newCoins = coins - cost;
      setCoins(newCoins);
      if (authUser) apiUpdateCoins(newCoins).catch(() => {});
      if (data.horse) setCurrentHorse(data.horse);
      setTrainResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setTrainLoading(false);
    }
  };

  // 飼葉を与える
  const handleFeed = async (feedKey) => {
    if (isFeedDoneThisWeek) {
      setError('今週の飼葉は与え済みです');
      return;
    }
    const info = FEED_TYPES.find((f) => f.key === feedKey);
    if (coins < info.cost) {
      setError(`コインが不足しています（必要: ${info.cost.toLocaleString()}C）`);
      return;
    }
    setError('');
    setTrainLoading(true);
    try {
      const data = await apiFeedHorse(feedKey);
      const newCoins = coins - info.cost;
      setCoins(newCoins);
      if (authUser) apiUpdateCoins(newCoins).catch(() => {});
      if (data.horse) setCurrentHorse(data.horse);
      setTrainResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setTrainLoading(false);
    }
  };

  // レースに出走登録する
  const handleEnterRace = async (race) => {
    setEnterLoading(true);
    setError('');
    try {
      const payload = {
        raceName: race.name,
        raceGrade: race.grade ?? null,
        distance: race.distance,
        trackType: race.track ?? race.trackType,
      };
      const data = await apiEnterRace(payload);
      onRaceEntryRegistered({
        raceName: data.raceName ?? payload.raceName,
        raceGrade: data.raceGrade ?? payload.raceGrade ?? 'open',
        distance: payload.distance,
        trackType: payload.trackType,
        horse: currentHorse,
      });
      setRaceResult({
        message: `「${payload.raceName}」に出走登録しました。次のレースで出走します。`,
        rank: null,
        prize: 0,
        expGained: 0,
        response: data,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setEnterLoading(false);
    }
  };

  // 殿堂馬でバトルを実施する
  const handleBattle = async () => {
    setBattleLoading(true);
    setError('');
    try {
      const data = await apiBattle(battleSel.map((h) => h.id));
      setBattleResult(data);
      setBattleSel([]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBattleLoading(false);
    }
  };

  // タブ定義
  const TABS = [
    { key: 'myHorse',    label: '🐴 マイホース' },
    { key: 'gacha',      label: '🎰 ガチャ'      },
    { key: 'train',      label: '💪 調教・飼葉'  },
    { key: 'race',       label: '🏁 レース出走'  },
    { key: 'hallOfFame', label: '🏆 殿堂入り'    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* エラー表示バー */}
      {error && (
        <div className="bg-rose-900/60 border border-rose-700 rounded-xl px-4 py-2 text-sm text-rose-300 flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="ml-2 text-rose-400 hover:text-rose-200">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* タブナビゲーション */}
      <div className="flex flex-wrap gap-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => { setActiveTab(tab.key); setError(''); }}
            className={`px-3 py-2 text-sm font-semibold rounded-xl transition ${
              activeTab === tab.key
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── タブ①：マイホース ── */}
      {activeTab === 'myHorse' && (
        <div>
          {horseLoading ? (
            <p className="text-slate-400 text-center py-8">読み込み中...</p>
          ) : !currentHorse ? (
            <div className="bg-slate-800 rounded-2xl p-6 text-center text-slate-300">
              <p>育成馬がいません。ガチャで馬を入手しましょう！</p>
              <button
                type="button"
                onClick={() => setActiveTab('gacha')}
                className="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition"
              >
                ガチャへ
              </button>
            </div>
          ) : (
            <div className="bg-slate-800 rounded-2xl p-6 flex flex-col gap-4">
              {/* 馬名・世代・脚質 */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h2 className="text-xl font-bold text-white">{currentHorse.name}</h2>
                  <span className="text-slate-400 text-sm">第{currentHorse.generation}世代</span>
                </div>
                <span className="px-3 py-1 bg-indigo-700 text-indigo-100 rounded-full text-sm font-semibold">
                  {currentHorse.runningStyle ?? currentHorse.running_style}
                </span>
              </div>

              {/* ステータス一覧 */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  ['スピード',   currentHorse.speed],
                  ['スタミナ',   currentHorse.stamina],
                  ['安定性',     currentHorse.stability],
                  ['瞬発力',     currentHorse.burst],
                  ['芝適性',     currentHorse.turfFit ?? currentHorse.turf_fit],
                  ['ダート適性', currentHorse.dirtFit ?? currentHorse.dirt_fit],
                ].map(([label, val]) => (
                  <div key={label} className="bg-slate-700 rounded-lg px-3 py-2 flex items-center justify-between">
                    <span className="text-slate-400 text-xs">{label}</span>
                    <span className="text-white font-bold text-sm">{statLabel(val)}</span>
                  </div>
                ))}
              </div>

              {/* 距離適性 */}
              <p className="text-slate-300 text-sm">
                距離適性: {currentHorse.distance_min}〜{currentHorse.distance_max}m
              </p>

              {/* レベル・EXPバー */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-300 font-semibold">Lv.{currentHorse.level}</span>
                  <span className="text-slate-400 text-xs">
                    EXP {currentHorse.exp}/{currentHorse.exp_next ?? '???'}
                  </span>
                </div>
                {currentHorse.exp_next ? (
                  <div className="h-2 bg-slate-600 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: `${Math.min(100, ((currentHorse.exp ?? 0) / currentHorse.exp_next) * 100)}%` }}
                    />
                  </div>
                ) : null}
              </div>

              {/* 戦績 */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-slate-700 rounded-xl py-2">
                  <p className="text-slate-400 text-xs">総レース</p>
                  <p className="text-white font-bold">{currentHorse.total_races ?? 0}戦</p>
                </div>
                <div className="bg-slate-700 rounded-xl py-2">
                  <p className="text-slate-400 text-xs">勝利数</p>
                  <p className="text-white font-bold">{currentHorse.wins ?? 0}勝</p>
                </div>
                <div className="bg-slate-700 rounded-xl py-2">
                  <p className="text-slate-400 text-xs">獲得賞金</p>
                  <p className="text-white font-bold text-xs">{(currentHorse.prize_money ?? 0).toLocaleString()}C</p>
                </div>
              </div>

              {/* 引退・抹消ボタン */}
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => { setRetireModal('confirm'); setError(''); }}
                  className="flex-1 py-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-xl transition text-sm"
                >
                  引退
                </button>
                <button
                  type="button"
                  onClick={() => { setDeleteModal(true); setError(''); }}
                  className="flex-1 py-2 bg-rose-700 hover:bg-rose-800 text-white font-semibold rounded-xl transition text-sm"
                >
                  抹消
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── タブ②：ガチャ ── */}
      {activeTab === 'gacha' && (
        <div className="flex flex-col gap-4">
          {currentHorse ? (
            <div className="bg-slate-800 rounded-2xl p-6 text-center text-slate-300">
              現在育成中の馬がいます。引退または抹消してから引いてください。
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {GACHA_TYPES.map((g) => (
                <div key={g.key} className="bg-slate-800 rounded-2xl p-4 flex flex-col gap-3">
                  <h3 className="text-white font-bold">{g.label}</h3>
                  <div className="text-slate-400 text-xs space-y-0.5">
                    <p>1回: {g.single.toLocaleString()}C</p>
                    <p>10連: {g.multi.toLocaleString()}C</p>
                  </div>
                  <div className="flex gap-2 mt-auto pt-1">
                    <button
                      type="button"
                      disabled={gachaLoading || coins < g.single}
                      onClick={() => handleGacha(g.key, 1)}
                      className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:text-slate-400 text-white text-xs font-semibold rounded-lg transition"
                    >
                      1回
                    </button>
                    <button
                      type="button"
                      disabled={gachaLoading || coins < g.multi}
                      onClick={() => handleGacha(g.key, 10)}
                      className="flex-1 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 disabled:text-slate-400 text-white text-xs font-semibold rounded-lg transition"
                    >
                      10連
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── タブ③：調教・飼葉 ── */}
      {activeTab === 'train' && (
        <div className="flex flex-col gap-4">
          {!currentHorse ? (
            <div className="bg-slate-800 rounded-2xl p-6 text-center text-slate-300">
              育成馬がいません。
              <button
                type="button"
                onClick={() => setActiveTab('myHorse')}
                className="ml-2 text-blue-400 underline hover:text-blue-300"
              >
                マイホースへ
              </button>
            </div>
          ) : (
            <>
              {/* 調教セクション */}
              <div className="bg-slate-800 rounded-2xl p-4 flex flex-col gap-4">
                <h3 className="text-white font-bold text-base">調教</h3>
                {/* 調教種別ボタン */}
                <div className="flex flex-wrap gap-2">
                  {TRAIN_TYPES.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setTrainType(t.key)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition border ${
                        trainType === t.key
                          ? 'bg-blue-600 text-white border-blue-500'
                          : t.special
                            ? 'bg-slate-700 text-purple-300 border-purple-600 hover:bg-slate-600'
                            : 'bg-slate-700 text-slate-300 border-transparent hover:bg-slate-600'
                      }`}
                    >
                      {t.special ? '⚡ ' : ''}{t.label}
                    </button>
                  ))}
                </div>
                {/* グレード選択（脚質変更選択時は非表示） */}
                {trainType !== 'running_style' && (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {TRAIN_GRADES.map((g) => {
                        const rate = calcSuccessRate(currentHorse.growth_stages, g.rateMult);
                        return (
                          <button
                            key={g.key}
                            type="button"
                            onClick={() => setTrainGrade(g.key)}
                            className={`p-3 rounded-xl text-left flex flex-col gap-1 transition border-2 ${
                              trainGrade === g.key
                                ? 'border-blue-500 bg-blue-900/40'
                                : 'border-transparent bg-slate-700 hover:bg-slate-600'
                            }`}
                          >
                            <span className="text-white text-sm font-bold">{g.label}</span>
                            <span className="text-slate-400 text-xs">{g.cost.toLocaleString()}C</span>
                            <span className="text-green-400 text-xs">成功率 {rate}%</span>
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      disabled={trainLoading || isTrainingDoneThisWeek}
                      onClick={handleTrain}
                      className="py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white font-bold rounded-xl transition"
                    >
                      {trainLoading ? '調教中...' : isTrainingDoneThisWeek ? '今週実施済み' : '調教する'}
                    </button>
                  </>
                )}
                {/* 脚質変更UI（脚質変更選択時のみ表示） */}
                {trainType === 'running_style' && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {['逃げ', '先行', '差し', '追込', '大逃げ', '直線一気', 'まくり'].map((style) => (
                        <button
                          key={style}
                          type="button"
                          onClick={() => setSelectedRunningStyle(style)}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition border ${
                            selectedRunningStyle === style
                              ? 'bg-purple-600 text-white border-purple-500'
                              : 'bg-slate-700 text-slate-300 border-transparent hover:bg-slate-600'
                          }`}
                        >
                          {style}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      disabled={trainLoading || isTrainingDoneThisWeek || !selectedRunningStyle}
                      onClick={handleChangeRunningStyle}
                      className="py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 text-white font-bold rounded-xl transition"
                    >
                      {trainLoading ? '変更中...' : isTrainingDoneThisWeek ? '今週実施済み' : `脚質変更する（200,000C）`}
                    </button>
                  </>
                )}
              </div>

              {/* 飼葉セクション */}
              <div className="bg-slate-800 rounded-2xl p-4 flex flex-col gap-4">
                <h3 className="text-white font-bold text-base">飼葉</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {FEED_TYPES.map((f) => (
                    <div key={f.key} className="bg-slate-700 rounded-xl p-3 flex flex-col gap-2">
                      <p className="text-white text-sm font-semibold">{f.label}</p>
                      <p className="text-slate-400 text-xs">{f.cost.toLocaleString()}C</p>
                      <p className="text-slate-300 text-xs">{f.effect}</p>
                      <button
                        type="button"
                        disabled={trainLoading || coins < f.cost || isFeedDoneThisWeek}
                        onClick={() => handleFeed(f.key)}
                        className="mt-auto py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-slate-600 disabled:text-slate-400 text-white text-xs font-semibold rounded-lg transition"
                      >
                        {isFeedDoneThisWeek ? '今週実施済み' : '与える'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── タブ④：レース出走 ── */}
      {activeTab === 'race' && (
        <div className="flex flex-col gap-4">
          {!currentHorse ? (
            <div className="bg-slate-800 rounded-2xl p-6 text-center text-slate-300">
              育成馬がいません。
              <button
                type="button"
                onClick={() => setActiveTab('myHorse')}
                className="ml-2 text-blue-400 underline hover:text-blue-300"
              >
                マイホースへ
              </button>
            </div>
          ) : racesLoading ? (
            <p className="text-slate-400 text-center py-8">レース情報読み込み中...</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {/* 固定レース（3勝クラス以下）＋ APIから取得したレース */}
              {[...FIXED_RACES, ...apiRaces].map((race, idx) => (
                <div key={idx} className="bg-slate-800 rounded-2xl p-4 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-white font-semibold text-sm">{race.name}</h3>
                    {race.grade && (
                      <span className="text-xs bg-yellow-700 text-yellow-100 px-2 py-0.5 rounded-full">
                        {race.grade}
                      </span>
                    )}
                  </div>
                  <div className="text-slate-400 text-xs flex gap-3">
                    <span>距離: {race.distance}m</span>
                    <span>馬場: {race.track === 'turf' ? '芝' : 'ダート'}</span>
                  </div>
                  {race.prize ? (
                    <span className="text-amber-400 text-xs">賞金: {race.prize.toLocaleString()}C</span>
                  ) : null}
                  <button
                    type="button"
                    disabled={enterLoading}
                    onClick={() => handleEnterRace(race)}
                    className="mt-auto py-2 bg-emerald-700 hover:bg-emerald-600 disabled:bg-slate-600 text-white text-sm font-semibold rounded-xl transition"
                  >
                    出走登録
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── タブ⑤：殿堂入り ── */}
      {activeTab === 'hallOfFame' && (
        <div className="flex flex-col gap-4">
          {hofLoading ? (
            <p className="text-slate-400 text-center py-8">読み込み中...</p>
          ) : hallOfFame.length === 0 ? (
            <div className="bg-slate-800 rounded-2xl p-6 text-center text-slate-300">
              殿堂入りした馬がいません。
            </div>
          ) : (
            <>
              <p className="text-slate-300 text-sm">
                2〜8頭を選択して「バトル開始」ボタンを押してください。
                <span className="ml-2 text-blue-400 font-semibold">（選択中: {battleSel.length}頭）</span>
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {hallOfFame.map((horse, idx) => {
                  const isSelected = battleSel.some((h) => h.id === horse.id);
                  return (
                    <div
                      key={idx}
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        setBattleSel((prev) =>
                          isSelected
                            ? prev.filter((h) => h.id !== horse.id)
                            : prev.length < 8
                              ? [...prev, horse]
                              : prev
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          setBattleSel((prev) =>
                            isSelected
                              ? prev.filter((h) => h.id !== horse.id)
                              : prev.length < 8
                                ? [...prev, horse]
                                : prev
                          );
                        }
                      }}
                      className={`bg-slate-800 rounded-2xl p-4 flex flex-col gap-2 border-2 cursor-pointer transition ${
                        isSelected ? 'border-blue-500' : 'border-transparent hover:border-slate-600'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <h3 className="text-white font-bold">{horse.name}</h3>
                        <span className="text-slate-400 text-xs">第{horse.generation}世代</span>
                      </div>
                      <p className="text-slate-400 text-xs">Lv.{horse.level}</p>
                      {/* ステータス一覧 */}
                      <div className="grid grid-cols-3 gap-1">
                        {[
                          ['速', horse.speed],
                          ['ス', horse.stamina],
                          ['安', horse.stability],
                          ['瞬', horse.burst],
                          ['芝', horse.turfFit ?? horse.turf_fit],
                          ['ダ', horse.dirtFit ?? horse.dirt_fit],
                        ].map(([lbl, val]) => (
                          <div key={lbl} className="bg-slate-700 rounded px-1 py-1 text-center">
                            <span className="text-slate-400 text-xs">{lbl} </span>
                            <span className="text-white text-xs font-bold">{statLabel(val)}</span>
                          </div>
                        ))}
                      </div>
                      {/* 戦績 */}
                      <div className="grid grid-cols-2 gap-1 text-xs text-center">
                        <div className="bg-slate-700 rounded py-1">
                          <p className="text-slate-400">戦績</p>
                          <p className="text-white">{horse.total_races ?? 0}戦{horse.wins ?? 0}勝</p>
                        </div>
                        <div className="bg-slate-700 rounded py-1">
                          <p className="text-slate-400">G1勝利</p>
                          <p className="text-white">{horse.g1_wins ?? 0}勝</p>
                        </div>
                      </div>
                      {/* 獲得賞金 */}
                      <p className="text-amber-400 text-xs text-center">
                        {(horse.prize_money ?? 0).toLocaleString()}C獲得
                      </p>
                      {isSelected && (
                        <p className="text-center text-blue-400 text-xs font-semibold">✓ 選択中</p>
                      )}
                    </div>
                  );
                })}
              </div>
              {battleSel.length >= 2 && (
                <button
                  type="button"
                  disabled={battleLoading}
                  onClick={handleBattle}
                  className="py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 text-white font-bold rounded-xl transition"
                >
                  {battleLoading ? 'バトル中...' : `バトル開始（${battleSel.length}頭）`}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* ──── モーダル群 ──── */}

      {/* 引退確認・継承モーダル */}
      {retireModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4">
            {/* STEP 1: 引退確認 */}
            {retireModal === 'confirm' && (
              <>
                <h3 className="text-white font-bold text-lg">引退確認</h3>
                <p className="text-slate-300 text-sm">
                  {currentHorse?.name}を殿堂入りさせますか？
                </p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setRetireModal('inherit')}
                    className="flex-1 py-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-xl transition"
                  >
                    殿堂入りへ
                  </button>
                  <button
                    type="button"
                    onClick={() => setRetireModal(false)}
                    className="flex-1 py-2 bg-slate-600 hover:bg-slate-500 text-white font-semibold rounded-xl transition"
                  >
                    キャンセル
                  </button>
                </div>
              </>
            )}
            {/* STEP 2: 継承タイプ選択 */}
            {retireModal === 'inherit' && (
              <>
                <h3 className="text-white font-bold text-lg">継承タイプ選択</h3>
                <div className="flex flex-col gap-2">
                  {[
                    { key: 'low',    label: 'ローリスク', desc: '低リスク・低リターン' },
                    { key: 'normal', label: '通常',       desc: '標準的な継承'         },
                    { key: 'high',   label: 'ハイリスク', desc: '高リスク・高リターン' },
                  ].map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setInheritType(t.key)}
                      className={`p-3 rounded-xl text-left border-2 transition ${
                        inheritType === t.key
                          ? 'border-blue-500 bg-blue-900/40'
                          : 'border-transparent bg-slate-700 hover:bg-slate-600'
                      }`}
                    >
                      <p className="text-white font-semibold text-sm">{t.label}</p>
                      <p className="text-slate-400 text-xs">{t.desc}</p>
                    </button>
                  ))}
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    disabled={retireLoading}
                    onClick={handleRetire}
                    className="flex-1 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-600 text-white font-semibold rounded-xl transition"
                  >
                    {retireLoading ? '処理中...' : '引退させる'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRetireModal(false)}
                    className="flex-1 py-2 bg-slate-600 hover:bg-slate-500 text-white font-semibold rounded-xl transition"
                  >
                    キャンセル
                  </button>
                </div>
              </>
            )}
            {/* STEP 3: 継承結果表示・馬名入力 */}
            {retireModal === 'inherit_name' && retireResultData && (
              <>
                <h3 className="text-white font-bold text-lg">継承結果</h3>
                <div className="bg-slate-700 rounded-xl p-3 text-sm text-slate-200 space-y-1 max-h-40 overflow-y-auto">
                  {retireResultData.stats
                    ? Object.entries(retireResultData.stats).map(([k, v]) => (
                        <p key={k}>{k}: <span className="text-white font-semibold">{statLabel(v)}</span></p>
                      ))
                    : <p className="text-slate-400">ステータス情報がありません</p>}
                </div>
                <p className="text-slate-300 text-sm">継承馬の名前を入力してください：</p>
                <input
                  type="text"
                  value={inheritName}
                  onChange={(e) => setInheritName(e.target.value)}
                  placeholder="馬名（必須）"
                  maxLength={20}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="flex gap-3">
                  <button
                    type="button"
                    disabled={retireLoading || !inheritName.trim()}
                    onClick={handleInherit}
                    className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white font-semibold rounded-xl transition"
                  >
                    {retireLoading ? '処理中...' : '継承する'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setRetireModal(false); setRetireResultData(null); setInheritName(''); }}
                    className="flex-1 py-2 bg-slate-600 hover:bg-slate-500 text-white font-semibold rounded-xl transition"
                  >
                    スキップ
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 抹消確認モーダル */}
      {deleteModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4">
            <h3 className="text-white font-bold text-lg">抹消確認</h3>
            <p className="text-slate-300 text-sm">
              {currentHorse?.name}を抹消しますか？この操作は取り消せません。
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                disabled={deleteLoading}
                onClick={handleDelete}
                className="flex-1 py-2 bg-rose-700 hover:bg-rose-800 disabled:bg-slate-600 text-white font-semibold rounded-xl transition"
              >
                {deleteLoading ? '処理中...' : '抹消する'}
              </button>
              <button
                type="button"
                onClick={() => setDeleteModal(false)}
                className="flex-1 py-2 bg-slate-600 hover:bg-slate-500 text-white font-semibold rounded-xl transition"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ガチャ結果モーダル */}
      {gachaResults.length > 0 && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-4xl flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-white font-bold text-lg">🎰 ガチャ結果</h3>
            {isMultiGacha ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {gachaResults.map((horse, idx) => (
                    <div key={horse.id ?? idx} className="bg-slate-700 rounded-xl p-4 flex flex-col gap-2 text-sm">
                      <p className="text-slate-300">No.{idx + 1}</p>
                      <p className="text-slate-300">脚質: <span className="text-white font-semibold">{horse.running_style}</span></p>
                      {[
                        ['スピード', getHorseRank(horse, 'speed')],
                        ['スタミナ', getHorseRank(horse, 'stamina')],
                        ['安定性', getHorseRank(horse, 'stability')],
                        ['瞬発力', getHorseRank(horse, 'burst')],
                        ['芝適性', getHorseRank(horse, 'turf_fit')],
                        ['ダート適性', getHorseRank(horse, 'dirt_fit')],
                      ].map(([lbl, val]) => (
                        <p key={lbl} className="text-slate-300">
                          {lbl}: <span className="text-white font-semibold">{statLabel(val)}</span>
                        </p>
                      ))}
                      <p className="text-slate-300">距離: {horse.distance_min}〜{horse.distance_max}m</p>
                      <button
                        type="button"
                        onClick={() => setSelectedGachaHorse(horse)}
                        className={`mt-1 py-2 text-white font-semibold rounded-xl transition ${
                          selectedGachaHorse?.id === horse.id
                            ? 'bg-blue-500 hover:bg-blue-600'
                            : 'bg-blue-600 hover:bg-blue-700'
                        }`}
                      >
                        この馬を選ぶ
                      </button>
                    </div>
                  ))}
                </div>
                {selectedGachaHorse && (
                  <>
                    <p className="text-slate-300 text-sm">選択した馬の名前を入力してください：</p>
                    <input
                      type="text"
                      value={adoptName}
                      onChange={(e) => setAdoptName(e.target.value)}
                      placeholder="馬名を入力（必須）"
                      maxLength={20}
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <div className="flex gap-3">
                      <button
                        type="button"
                        disabled={adoptLoading || !adoptName.trim()}
                        onClick={() => handleAdopt(selectedGachaHorse)}
                        className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white font-semibold rounded-xl transition"
                      >
                        {adoptLoading ? '処理中...' : 'この馬で育成する'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setSelectedGachaHorse(null); setAdoptName(''); }}
                        className="flex-1 py-2 bg-slate-600 hover:bg-slate-500 text-white font-semibold rounded-xl transition"
                      >
                        選択を解除
                      </button>
                    </div>
                  </>
                )}
                <button
                  type="button"
                  onClick={closeGachaModal}
                  className="w-full py-2 bg-slate-600 hover:bg-slate-500 text-white font-semibold rounded-xl transition"
                >
                  全部戻す
                </button>
              </>
            ) : (
              <>
                <div className="bg-slate-700 rounded-xl p-4 flex flex-col gap-1 text-sm">
                  <p className="text-slate-300">
                    脚質: <span className="text-white font-semibold">{selectedHorse?.running_style}</span>
                  </p>
                  {[
                    ['スピード', getHorseRank(selectedHorse, 'speed')],
                    ['スタミナ', getHorseRank(selectedHorse, 'stamina')],
                    ['安定性', getHorseRank(selectedHorse, 'stability')],
                    ['瞬発力', getHorseRank(selectedHorse, 'burst')],
                    ['芝適性', getHorseRank(selectedHorse, 'turf_fit')],
                    ['ダート適性', getHorseRank(selectedHorse, 'dirt_fit')],
                  ].map(([lbl, val]) => (
                    <p key={lbl} className="text-slate-300">
                      {lbl}: <span className="text-white font-semibold">{statLabel(val)}</span>
                    </p>
                  ))}
                  <p className="text-slate-300">
                    距離: {selectedHorse?.distance_min}〜{selectedHorse?.distance_max}m
                  </p>
                </div>
                <p className="text-slate-300 text-sm">馬名を入力して育成を開始しますか？</p>
                <input
                  type="text"
                  value={adoptName}
                  onChange={(e) => setAdoptName(e.target.value)}
                  placeholder="馬名を入力（必須）"
                  maxLength={20}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="flex gap-3">
                  <button
                    type="button"
                    disabled={adoptLoading || !adoptName.trim()}
                    onClick={() => handleAdopt(selectedHorse)}
                    className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white font-semibold rounded-xl transition"
                  >
                    {adoptLoading ? '処理中...' : 'この馬を育成する'}
                  </button>
                  <button
                    type="button"
                    onClick={closeGachaModal}
                    className="flex-1 py-2 bg-slate-600 hover:bg-slate-500 text-white font-semibold rounded-xl transition"
                  >
                    戻す
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 調教・飼葉結果モーダル */}
      {trainResult && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4">
            <h3 className="text-white font-bold text-lg">
              {trainResult.success ? '✅ 成功！' : '❌ 失敗'}
            </h3>
            {trainResult.message && (
              <p className="text-slate-300 text-sm">{trainResult.message}</p>
            )}
            {trainResult.changes && Object.keys(trainResult.changes).length > 0 && (
              <div className="bg-slate-700 rounded-xl p-3 text-sm space-y-1">
                {Object.entries(trainResult.changes).map(([k, v]) => (
                  <p key={k} className="text-slate-200">
                    {k}:{' '}
                    <span className={Number(v) > 0 ? 'text-green-400' : Number(v) < 0 ? 'text-rose-400' : 'text-slate-400'}>
                      {Number(v) > 0 ? '+' : ''}{v}
                    </span>
                  </p>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setTrainResult(null)}
              className="py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition"
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* レース結果モーダル */}
      {raceResult && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-white font-bold text-lg">🏁 レース結果</h3>
            {raceResult.rank != null && (
              <p className="text-3xl font-bold text-center text-white">{raceResult.rank}着</p>
            )}
            {raceResult.message && (
              <p className="text-slate-300 text-sm">{raceResult.message}</p>
            )}
            {raceResult.prize > 0 && (
              <p className="text-amber-400 font-bold text-center text-lg">
                +{raceResult.prize.toLocaleString()}C 獲得！
              </p>
            )}
            {Array.isArray(raceResult.results) && raceResult.results.length > 0 && (
              <ol className="space-y-1 text-sm">
                {raceResult.results.map((r, i) => (
                  <li key={i} className="flex items-center gap-2 text-slate-300">
                    <span className="w-6 text-center font-bold text-slate-400">{i + 1}</span>
                    <span className={r.is_player ? 'text-white font-bold' : ''}>{r.name ?? r}</span>
                  </li>
                ))}
              </ol>
            )}
            <button
              type="button"
              onClick={() => setRaceResult(null)}
              className="py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition"
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* バトル結果モーダル */}
      {battleResult && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-white font-bold text-lg">🏆 バトル結果</h3>
            {battleResult.winner && (
              <p className="text-center text-2xl font-bold text-amber-400">
                🥇 {battleResult.winner}
              </p>
            )}
            {Array.isArray(battleResult.results) && battleResult.results.length > 0 && (
              <ol className="space-y-1 text-sm">
                {battleResult.results.map((r, i) => (
                  <li key={i} className="flex items-center gap-2 text-slate-300">
                    <span className="w-6 text-center font-bold text-slate-400">{i + 1}</span>
                    <span>{r.name ?? r}</span>
                  </li>
                ))}
              </ol>
            )}
            <button
              type="button"
              onClick={() => setBattleResult(null)}
              className="py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition"
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== メインページ =====
export default function Page() {
  const [phase, setPhase] = useState('betting'); // betting | racing | result
  const [coins, setCoins] = useState(INITIAL_COINS);
  const [raceConfig, setRaceConfig] = useState(() => generateRaceConfig());
  const [horses, setHorses] = useState(() => calculateOdds(generateHorses(HORSE_COUNT)));
  const [betType, setBetType] = useState('単勝');
  const [selectedHorseIds, setSelectedHorseIds] = useState([]);
  const [betAmount, setBetAmount] = useState(MIN_BET);
  const [raceState, setRaceState] = useState([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [ranking, setRanking] = useState([]);
  const [lastPayout, setLastPayout] = useState(0);
  const [lastBet, setLastBet] = useState({ horseIds: [], betType: '単勝', amount: 0, odds: 0 });
  const [registeredRaceEntry, setRegisteredRaceEntry] = useState(null);
  const [trainedRaceResult, setTrainedRaceResult] = useState(null);
  const timerRef = useRef(null);

  // 認証状態
  const [authUser, setAuthUser] = useState(null);
  const [screen, setScreen] = useState(() => (localStorage.getItem('token') ? 'game' : 'auth'));
  const [showAuth, setShowAuth] = useState(false);
  const [showRanking, setShowRanking] = useState(false);

  // アプリモード（馬券 / 育成）
  const [appMode, setAppMode] = useState('bet'); // 'bet' | 'train'

  // デバッグレース
  const [debugDistanceIndex, setDebugDistanceIndex] = useState(0);
  const [isDebugRace, setIsDebugRace] = useState(false);

  // JWT自動ログイン（初期化）
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    apiMe()
      .then((user) => {
        setAuthUser(user);
        setCoins(user.coins);
      })
      .catch(() => {
        localStorage.removeItem('token');
        setScreen('auth');
      });
  }, []);

  useEffect(() => {
    const modulePath = '../utils/race-horse-pool.js';
    import(/* @vite-ignore */ modulePath)
      .then((mod) => {
        if (typeof mod.generateNPCHorses === 'function') {
          setNPCHorseGenerator(mod.generateNPCHorses);
        }
      })
      .catch(() => {
      });
  }, []);

  // ログイン・登録成功時
  const handleAuth = useCallback((user) => {
    setAuthUser(user);
    setCoins(user.coins);
    setRegisteredRaceEntry(null);
    setTrainedRaceResult(null);
    setScreen('game');
    setShowAuth(false);
  }, []);

  // ログアウト
  const handleLogout = useCallback(() => {
    localStorage.removeItem('token');
    setAuthUser(null);
    setCoins(INITIAL_COINS);
    setRegisteredRaceEntry(null);
    setTrainedRaceResult(null);
    setScreen('auth');
  }, []);

  // 現在の賭け方情報
  const betTypeInfo = useMemo(
    () => BET_TYPES.find((b) => b.key === betType) ?? BET_TYPES[0],
    [betType]
  );
  const requiredCount = betTypeInfo.horseCount;
  const hasPlayerHorseInRace = useMemo(
    () => horses.some((horse) => horse.isPlayerHorse),
    [horses]
  );

  // 賭け方変更時に選択をリセット
  const handleBetTypeChange = useCallback((key) => {
    setBetType(key);
    setSelectedHorseIds([]);
  }, []);

  // 馬の選択・解除
  const handleSelectHorse = useCallback((id) => {
    setSelectedHorseIds((prev) => {
      const idx = prev.indexOf(id);
      if (idx !== -1) {
        // すでに選択済み → 解除
        return prev.filter((hid) => hid !== id);
      }
      if (prev.length < requiredCount) {
        return [...prev, id];
      }
      // 選択数が上限に達している場合は最も古い選択を置き換え
      if (requiredCount === 1) return [id];
      return [...prev.slice(1), id];
    });
  }, [requiredCount]);

  // 払戻予定額（リアルタイム）
  const expectedPayout = useMemo(() => {
    if (selectedHorseIds.length < requiredCount) return 0;
    const odds = calculateBetOdds(horses, betType, selectedHorseIds);
    return calcPayout(betAmount, odds);
  }, [selectedHorseIds, requiredCount, horses, betType, betAmount]);

  // 現在の組み合わせオッズ
  const currentOdds = useMemo(() => {
    if (selectedHorseIds.length < requiredCount) return null;
    return calculateBetOdds(horses, betType, selectedHorseIds);
  }, [selectedHorseIds, requiredCount, horses, betType]);

  // ベット額バリデーション
  const canStart = useMemo(() => {
    if (hasPlayerHorseInRace) {
      return phase === 'betting';
    }
    return (
      selectedHorseIds.length === requiredCount &&
      betAmount >= MIN_BET &&
      betAmount <= coins &&
      phase === 'betting'
    );
  }, [selectedHorseIds, requiredCount, betAmount, coins, phase, hasPlayerHorseInRace]);

  // クイックベット
  const handleQuickBet = useCallback(
    (amount) => {
      if (amount === 'all') {
        setBetAmount(Math.max(MIN_BET, coins));
      } else {
        setBetAmount(Math.min(coins, Math.max(MIN_BET, amount)));
      }
    },
    [coins]
  );

  // 新しいレースを準備
  const prepareNewRace = useCallback(async () => {
    let nextRaceDistance = null;
    let nextRaceTrack = null;
    let registeredHorse = registeredRaceEntry?.horse ?? null;
    const raceMeta = registeredRaceEntry ?? { raceGrade: 'open', raceName: 'フィクションレース' };
    if (authUser) {
      try {
        const user = await apiGetUser();
        nextRaceDistance = user.next_race_distance;
        nextRaceTrack = user.next_race_track;
      } catch {
      }
    }
    if (!registeredHorse && Number.isInteger(nextRaceDistance) && (nextRaceTrack === 'turf' || nextRaceTrack === 'dirt')) {
      try {
        const horseData = await apiGetHorse();
        registeredHorse = horseData?.horse ?? null;
      } catch {
        registeredHorse = null;
      }
    }
    const shouldUseRegisteredRace = Boolean(
      registeredHorse &&
      Number.isInteger(nextRaceDistance) &&
      (nextRaceTrack === 'turf' || nextRaceTrack === 'dirt')
    );
    const newConfig = shouldUseRegisteredRace
      ? buildRaceConfigByConditions(nextRaceDistance, nextRaceTrack)
      : generateRaceConfig();
    const raceHorses = shouldUseRegisteredRace
      ? generateRaceHorses(
        raceMeta.raceGrade,
        raceMeta.raceName,
        registeredHorse
      )
      : generateHorses(HORSE_COUNT);
    setRaceConfig(newConfig);
    setHorses(calculateOdds(raceHorses));
    setBetType('単勝');
    setSelectedHorseIds([]);
    setBetAmount(MIN_BET);
    setRaceState([]);
    setStepIndex(0);
    setRanking([]);
    setLastPayout(0);
    setTrainedRaceResult(null);
    setIsDebugRace(false);
    setPhase('betting');
  }, [authUser, registeredRaceEntry]);

  // 所持コインリセット
  const handleReset = useCallback(() => {
    const resetCoins = INITIAL_COINS;
    setCoins(resetCoins);
    if (authUser) {
      apiUpdateCoins(resetCoins).catch(() => {});
    }
    prepareNewRace();
  }, [prepareNewRace, authUser]);

  useEffect(() => {
    if (appMode === 'bet' && phase === 'betting' && registeredRaceEntry) {
      prepareNewRace();
    }
  }, [appMode, phase, registeredRaceEntry, prepareNewRace]);

  // デバッグレース開始（全脚質・同一ステータス・最高調子で脚質の動きを確認）
  const handleDebugRace = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    const config = generateDebugRaceConfig(debugDistanceIndex);
    setDebugDistanceIndex((i) => (i + 1) % DEBUG_RACE_DISTANCES.length);
    const debugHorses = generateDebugHorses();
    setRaceConfig(config);
    setHorses(debugHorses);
    setLastBet({ horseIds: [], betType: '単勝', amount: 0, odds: 0 });
    setRaceState(initDebugRaceState(debugHorses, config));
    setStepIndex(0);
    setRanking([]);
    setLastPayout(0);
    setIsDebugRace(true);
    setPhase('racing');
  }, [debugDistanceIndex]);

  // レース開始
  const handleStartRace = useCallback(() => {
    if (!canStart) return;
    if (hasPlayerHorseInRace) {
      setLastBet({ horseIds: [], betType: '単勝', amount: 0, odds: 0 });
      setLastPayout(0);
      setRaceState(initRaceState(horses, raceConfig));
      setStepIndex(0);
      setPhase('racing');
      return;
    }
    const betOdds = calculateBetOdds(horses, betType, selectedHorseIds);
    setCoins((c) => c - betAmount);
    setLastBet({
      horseIds: selectedHorseIds,
      betType,
      amount: betAmount,
      odds: betOdds,
    });
    setRaceState(initRaceState(horses, raceConfig));
    setStepIndex(0);
    setPhase('racing');
  }, [canStart, hasPlayerHorseInRace, betType, selectedHorseIds, betAmount, horses, raceConfig]);

  // レース中のループ
  useEffect(() => {
    if (phase !== 'racing') return undefined;
    timerRef.current = setInterval(() => {
      setStepIndex((idx) => idx + 1);
    }, STEP_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase]);

  // ステップ進行
  useEffect(() => {
    if (phase !== 'racing') return;
    if (stepIndex === 0) return; // 初期化フレームはスキップ
    setRaceState((prev) => {
      const next = stepRace(prev, stepIndex);
      if (isRaceFinished(next, stepIndex)) {
        const ranked = rankHorses(next);
        setRanking(ranked);
        if (!isDebugRace && !hasPlayerHorseInRace) {
          let payout = 0;
          if (isWinningBetType(ranked, lastBet.betType, lastBet.horseIds)) {
            payout = calcPayout(lastBet.amount, lastBet.odds);
            setLastPayout(payout);
            setCoins((c) => {
              const newCoins = c + payout;
              if (authUser) {
                apiUpdateCoins(newCoins).catch(() => {});
                apiRecordBet(lastBet.betType, lastBet.amount, payout, lastBet.odds).catch(() => {});
              }
              return newCoins;
            });
          } else {
            setLastPayout(0);
            setCoins((c) => {
              if (authUser) {
                apiUpdateCoins(c).catch(() => {});
                apiRecordBet(lastBet.betType, lastBet.amount, 0, lastBet.odds).catch(() => {});
              }
              return c;
            });
          }
        } else {
          setLastPayout(0);
        }
        if (!isDebugRace && hasPlayerHorseInRace && registeredRaceEntry && authUser) {
          const playerHorse = ranked.find((horse) => horse.isPlayerHorse);
          if (playerHorse) {
            const prize = buildPrizeForTrainingRace(registeredRaceEntry.raceGrade, playerHorse.rank);
            const expGained = buildExpForTrainingRace(registeredRaceEntry.raceGrade, playerHorse.rank);
            setTrainedRaceResult({
              rank: playerHorse.rank,
              prize,
              expGained,
              raceName: registeredRaceEntry.raceName,
              raceGrade: registeredRaceEntry.raceGrade,
              levelUp: false,
            });
            apiSaveHorseRaceResult({
              rank: playerHorse.rank,
              prize,
              expGained,
              raceName: registeredRaceEntry.raceName,
              raceGrade: registeredRaceEntry.raceGrade,
              distance: raceConfig.distance,
              trackType: raceConfig.trackType,
            })
              .then((saved) => {
                if (saved?.user?.coins != null) {
                  setCoins(saved.user.coins);
                }
                setTrainedRaceResult((prevResult) =>
                  prevResult ? { ...prevResult, levelUp: Boolean(saved?.levelUp), horse: saved?.horse ?? null } : prevResult
                );
                setRegisteredRaceEntry(null);
              })
              .catch(() => {});
          }
        }
        setPhase('result');
        if (timerRef.current) clearInterval(timerRef.current);
      }
      return next;
    });
  }, [stepIndex, phase, lastBet, authUser, isDebugRace, hasPlayerHorseInRace, registeredRaceEntry, raceConfig]);

  // 選択中の馬の表示文字列
  const selectionLabel = useMemo(() => {
    if (selectedHorseIds.length === 0) return null;
    const names = selectedHorseIds.map((id) => {
      const h = horses.find((horse) => horse.id === id);
      return h ? h.name : `#${id}`;
    });
    return names.join(' → ');
  }, [selectedHorseIds, horses]);

  const handleRaceEntryRegistered = useCallback((entry) => {
    setRegisteredRaceEntry(entry ?? null);
  }, []);

  // ヘッダー
  const Header = (
    <header className="bg-white shadow-sm sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg sm:text-xl font-bold text-slate-800 flex items-center gap-2">
          <Trophy className="w-5 h-5 text-accent" />
          KeibaSimu
        </h1>
        <div className="flex items-center gap-2">
          {/* 脚質デバッグボタン */}
          <button
            type="button"
            onClick={handleDebugRace}
            disabled={phase === 'racing'}
            className="flex items-center gap-1 px-3 py-1.5 bg-purple-100 hover:bg-purple-200 disabled:bg-slate-100 disabled:text-slate-400 rounded-full text-purple-700 text-sm font-semibold"
            title={`脚質デバッグレース（${DEBUG_RACE_DISTANCES[debugDistanceIndex]}m）`}
          >
            <span>🐛</span>
            <span className="hidden sm:inline text-xs">{DEBUG_RACE_DISTANCES[debugDistanceIndex]}m</span>
          </button>
          {/* ランキングボタン */}
          <button
            type="button"
            onClick={() => setShowRanking(true)}
            className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-full text-slate-700 text-sm"
          >
            <BarChart2 className="w-4 h-4" />
            <span className="hidden sm:inline">ランキング</span>
          </button>
          {/* コイン表示 */}
          <div className="flex items-center gap-1 px-3 py-1.5 bg-orange-50 rounded-full text-accent font-bold">
            <Coins className="w-4 h-4" />
            <span>{coins.toLocaleString()}C</span>
          </div>
          {/* モード切替ボタン（馬券 / 育成） */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setAppMode('bet')}
              className={`px-3 py-1.5 text-sm font-semibold rounded-full transition ${
                appMode === 'bet'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              🏇 馬券
            </button>
            <button
              type="button"
              onClick={() => setAppMode('train')}
              className={`px-3 py-1.5 text-sm font-semibold rounded-full transition ${
                appMode === 'train'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              🐴 育成
            </button>
          </div>
          {/* ユーザー名またはログインボタン */}
          {authUser ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-700 hidden sm:inline font-semibold">
                {authUser.username}
              </span>
              <button
                type="button"
                onClick={handleLogout}
                className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-full text-slate-700 text-sm"
                title="ログアウト"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowAuth(true)}
              className="flex items-center gap-1 px-3 py-1.5 bg-accent hover:bg-orange-600 rounded-full text-white text-sm font-semibold"
            >
              <LogIn className="w-4 h-4" />
              <span className="hidden sm:inline">ログイン</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-full text-slate-700 text-sm"
          >
            <RotateCcw className="w-4 h-4" />
            <span className="hidden sm:inline">リセット</span>
          </button>
        </div>
      </div>
    </header>
  );

  if (screen === 'auth') {
    return <LoginPage onAuth={handleAuth} />;
  }

  return (
    <div className="min-h-full">
      {Header}
      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* 育成モード */}
        {appMode === 'train' && (
          <TrainingMode
            coins={coins}
            setCoins={setCoins}
            authUser={authUser}
            onRaceEntryRegistered={handleRaceEntryRegistered}
          />
        )}

        {/* 馬券モード（非表示時もDOMを保持してstate・アニメを維持） */}
        <div className={appMode === 'bet' ? '' : 'hidden'}>
        {phase === 'betting' && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
            <section>
              {/* レース情報 */}
              <div className="mb-4">
                <RaceInfoBanner raceConfig={raceConfig} />
              </div>

              {!hasPlayerHorseInRace && (
                <div className="flex flex-wrap gap-1 mb-4">
                  {BET_TYPES.map((bt) => (
                    <button
                      key={bt.key}
                      type="button"
                      onClick={() => handleBetTypeChange(bt.key)}
                      className={`px-3 py-1.5 text-sm rounded-lg font-semibold transition ${
                        betType === bt.key
                          ? 'bg-accent text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {bt.label}
                    </button>
                  ))}
                </div>
              )}

              {hasPlayerHorseInRace && (
                <div className="mb-4 bg-emerald-100 border border-emerald-300 text-emerald-800 text-sm rounded-xl px-3 py-2">
                  育成馬が出走中のため、このレースでは馬券を購入できません。
                </div>
              )}

              <h2 className="text-base font-bold text-slate-800 mb-3">
                出走表（{hasPlayerHorseInRace ? '育成馬出走レース' : `${betType}予想`}）
                {!hasPlayerHorseInRace && betTypeInfo.horseCount > 1 && (
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    — {betTypeInfo.horseCount}頭を順番に選択
                    {(betType === '馬単' || betType === '3連単') ? '（選択順が着順）' : '（順不同）'}
                  </span>
                )}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {horses.map((h) => {
                  const idx = selectedHorseIds.indexOf(h.id);
                  return (
                    <HorseCard
                      key={h.id}
                      horse={h}
                      selectionIndex={idx === -1 ? null : idx}
                      betType={betType}
                      onSelect={handleSelectHorse}
                    />
                  );
                })}
              </div>

              {!hasPlayerHorseInRace ? (
              <div className="bg-white rounded-2xl shadow-sm p-4 mt-4 flex flex-col gap-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="text-sm text-slate-600">
                    {selectionLabel ? (
                      <>
                        選択中:{' '}
                        <span className="font-bold text-slate-800">{selectionLabel}</span>
                        {currentOdds !== null && (
                          <>
                            {' '}
                            <span className="text-accent font-bold">
                              {currentOdds.toFixed(1)}倍
                            </span>
                          </>
                        )}
                      </>
                    ) : (
                      <>馬を{requiredCount}頭選択してください</>
                    )}
                  </div>
                  <div className="text-sm text-slate-600">
                    払戻予定:{' '}
                    <span className="font-bold text-accent">{expectedPayout}C</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-sm text-slate-600 w-20">ベット額</label>
                  <input
                    type="number"
                    min={MIN_BET}
                    max={coins}
                    value={betAmount}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) setBetAmount(v);
                    }}
                    className="flex-1 px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-200"
                  />
                  <span className="text-sm text-slate-500">C</span>
                </div>

                <div className="flex flex-wrap gap-2">
                  {[10, 50, 100, 500].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => handleQuickBet(v)}
                      className="px-3 py-1.5 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700"
                    >
                      {v}C
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => handleQuickBet('all')}
                    className="px-3 py-1.5 text-sm bg-orange-100 hover:bg-orange-200 rounded-lg text-accent font-semibold"
                  >
                    全賭
                  </button>
                </div>

                <button
                  type="button"
                  disabled={!canStart}
                  onClick={handleStartRace}
                  className="mt-1 inline-flex items-center justify-center gap-2 bg-accent hover:bg-orange-600 disabled:bg-slate-300 text-white font-bold py-3 rounded-xl transition"
                >
                  <Play className="w-4 h-4" />
                  レース開始
                </button>
                {betAmount > coins && (
                  <p className="text-xs text-rose-500">所持コインが不足しています</p>
                )}
                {betAmount < MIN_BET && (
                  <p className="text-xs text-rose-500">最低ベットは {MIN_BET}C です</p>
                )}
              </div>
              ) : (
              <div className="bg-white rounded-2xl shadow-sm p-4 mt-4 flex flex-col gap-3">
                <div className="text-sm text-slate-600">
                  育成馬の着順に応じて賞金とEXPが加算されます。
                </div>
                <button
                  type="button"
                  disabled={!canStart}
                  onClick={handleStartRace}
                  className="mt-1 inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-bold py-3 rounded-xl transition"
                >
                  <Play className="w-4 h-4" />
                  レース開始
                </button>
              </div>
              )}
            </section>
            <aside>
              <StyleGuide />
            </aside>
          </div>
        )}

        {phase === 'racing' && (
          <div className="flex flex-col gap-4">
            {/* レース情報 */}
            <RaceInfoBanner raceConfig={raceConfig} />
            <div className="bg-white rounded-2xl shadow-sm p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-slate-800">レース中…</h2>
                <span className="text-xs text-slate-400">
                  ステップ {Math.min(stepIndex, RACE_STEPS)} / {RACE_STEPS}
                </span>
              </div>
              {(lastBet.betType === '馬単' || lastBet.betType === '3連単') && (
                <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                  {lastBet.horseIds.map((id, i) => {
                    const badge = MEDAL_BADGES[i];
                    const horseName = (horses.find((h) => h.id === id) ?? {}).name ?? `#${id}`;
                    return (
                      <span key={id} className={`flex items-center gap-1 px-2 py-0.5 rounded-full border ${badge.border} ${badge.bg} ${badge.text}`}>
                        <span>{badge.emoji}</span>
                        <span>{badge.label}：{horseName}</span>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
            <RaceTrack raceState={raceState} betHorseIds={lastBet.horseIds} betType={lastBet.betType} />
          </div>
        )}

        {phase === 'result' && (
          <div className="flex flex-col gap-4">
            {/* レース情報 */}
            <RaceInfoBanner raceConfig={raceConfig} />
            <div className="bg-white rounded-2xl shadow-sm p-6 text-center">
              {isDebugRace ? (
                <>
                  <p className="text-2xl font-bold text-purple-700">🐛 デバッグレース完了</p>
                  <p className="mt-2 text-slate-500">全脚質の動きを確認しました</p>
                </>
              ) : hasPlayerHorseInRace ? (
                <>
                  <p className="text-2xl font-bold text-emerald-700">🐴 育成馬レース完了</p>
                  {trainedRaceResult ? (
                    <div className="mt-3 space-y-1 text-sm text-slate-700">
                      <p>着順: <span className="font-bold text-emerald-700">{trainedRaceResult.rank}着</span></p>
                      <p>獲得賞金: <span className="font-bold text-amber-600">+{trainedRaceResult.prize.toLocaleString()}C</span></p>
                      <p>獲得EXP: <span className="font-bold text-blue-600">+{trainedRaceResult.expGained}</span></p>
                      {trainedRaceResult.levelUp && (
                        <p className="font-bold text-purple-700">レベルアップしました！</p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-2 text-slate-500">結果を集計中です...</p>
                  )}
                </>
              ) : lastPayout > 0 ? (
                <p className="text-2xl font-bold text-accent">
                  🎉 的中！ +{lastPayout}C
                </p>
              ) : (
                <>
                  <p className="text-2xl font-bold text-slate-700">😢 残念…</p>
                  <p className="mt-2 text-slate-500">次のレースに期待しましょう</p>
                </>
              )}
            </div>
            <ResultList ranking={ranking} betHorseIds={lastBet.horseIds} betType={lastBet.betType} />
            <button
              type="button"
              onClick={prepareNewRace}
              className="inline-flex items-center justify-center gap-2 bg-accent hover:bg-orange-600 text-white font-bold py-3 rounded-xl"
            >
              <Play className="w-4 h-4" />
              次のレースへ
            </button>
          </div>
        )}
        </div>{/* 馬券モード終わり */}
      </main>

      {/* 認証モーダル */}
      {showAuth && (
        <AuthModal onClose={() => setShowAuth(false)} onAuth={handleAuth} />
      )}

      {/* ランキングモーダル */}
      {showRanking && (
        <RankingModal onClose={() => setShowRanking(false)} authUser={authUser} />
      )}
    </div>
  );
}
