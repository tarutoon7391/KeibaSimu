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
  generateDebugHorses,
  generateDebugRaceConfig,
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

// 馬カード（ベットフェーズ）
// selectionIndex: null=未選択, 0/1/2=選択順（0始まり）
// betType: 現在の賭け方（馬単/3連単のとき金銀銅バッジを表示）
function HorseCard({ horse, selectionIndex, betType, onSelect }) {
  const badge = conditionBadge(horse.displayCondition);
  const isSelected = selectionIndex !== null;
  const useOrderedBadge = isSelected && (betType === '馬単' || betType === '3連単');
  const medalBadge = useOrderedBadge ? MEDAL_BADGES[selectionIndex] : null;
  return (
    <button
      type="button"
      onClick={() => onSelect(horse.id)}
      className={`text-left bg-white rounded-2xl shadow-sm hover:shadow-md transition border-2 ${
        isSelected
          ? medalBadge
            ? `${medalBadge.border} ring-2 ring-orange-100`
            : 'border-accent ring-2 ring-orange-200'
          : 'border-transparent'
      } p-4 flex flex-col gap-2`}
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
          <h3 className="font-bold text-slate-800">{horse.name}</h3>
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
        const medalBadge = isBet && useOrderedBadge ? MEDAL_BADGES[betIdx] : null;
        return (
          <div key={h.id} className="flex items-center gap-2">
            <span className="w-6 text-xs text-slate-400 text-right">{idx + 1}位</span>
            <span
              className={`w-36 truncate text-sm font-semibold flex items-center gap-1 ${
                isBet ? 'text-accent' : 'text-slate-700'
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
                  isBet ? 'bg-accent' : 'bg-slate-400'
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
                isBet ? 'bg-orange-50' : ''
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
                <span className={`font-semibold ${isBet ? 'text-accent' : 'text-slate-700'}`}>
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
  const timerRef = useRef(null);

  // 認証状態
  const [authUser, setAuthUser] = useState(null);
  const [screen, setScreen] = useState(() => (localStorage.getItem('token') ? 'game' : 'auth'));
  const [showAuth, setShowAuth] = useState(false);
  const [showRanking, setShowRanking] = useState(false);

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

  // ログイン・登録成功時
  const handleAuth = useCallback((user) => {
    setAuthUser(user);
    setCoins(user.coins);
    setScreen('game');
    setShowAuth(false);
  }, []);

  // ログアウト
  const handleLogout = useCallback(() => {
    localStorage.removeItem('token');
    setAuthUser(null);
    setCoins(INITIAL_COINS);
    setScreen('auth');
  }, []);

  // 現在の賭け方情報
  const betTypeInfo = useMemo(
    () => BET_TYPES.find((b) => b.key === betType) ?? BET_TYPES[0],
    [betType]
  );
  const requiredCount = betTypeInfo.horseCount;

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
    return (
      selectedHorseIds.length === requiredCount &&
      betAmount >= MIN_BET &&
      betAmount <= coins &&
      phase === 'betting'
    );
  }, [selectedHorseIds, requiredCount, betAmount, coins, phase]);

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
  const prepareNewRace = useCallback(() => {
    const newConfig = generateRaceConfig();
    setRaceConfig(newConfig);
    setHorses(calculateOdds(generateHorses(HORSE_COUNT)));
    setBetType('単勝');
    setSelectedHorseIds([]);
    setBetAmount(MIN_BET);
    setRaceState([]);
    setStepIndex(0);
    setRanking([]);
    setLastPayout(0);
    setIsDebugRace(false);
    setPhase('betting');
  }, []);

  // 所持コインリセット
  const handleReset = useCallback(() => {
    const resetCoins = INITIAL_COINS;
    setCoins(resetCoins);
    if (authUser) {
      apiUpdateCoins(resetCoins).catch(() => {});
    }
    prepareNewRace();
  }, [prepareNewRace, authUser]);

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
  }, [canStart, betType, selectedHorseIds, betAmount, horses, raceConfig]);

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
        // 払戻判定（デバッグレースはコイン増減・API記録をスキップ）
        let payout = 0;
        if (!isDebugRace && isWinningBetType(ranked, lastBet.betType, lastBet.horseIds)) {
          payout = calcPayout(lastBet.amount, lastBet.odds);
          setLastPayout(payout);
          setCoins((c) => {
            const newCoins = c + payout;
            // ログイン中はAPIでコイン同期・払戻記録
            if (authUser) {
              apiUpdateCoins(newCoins).catch(() => {});
              apiRecordBet(lastBet.betType, lastBet.amount, payout, lastBet.odds).catch(() => {});
            }
            return newCoins;
          });
        } else if (!isDebugRace) {
          setLastPayout(0);
          // 外れの場合もコイン同期・記録（payout=0）
          setCoins((c) => {
            if (authUser) {
              apiUpdateCoins(c).catch(() => {});
              apiRecordBet(lastBet.betType, lastBet.amount, 0, lastBet.odds).catch(() => {});
            }
            return c;
          });
        }
        setPhase('result');
        if (timerRef.current) clearInterval(timerRef.current);
      }
      return next;
    });
  }, [stepIndex, phase, lastBet, authUser, isDebugRace]);

  // 選択中の馬の表示文字列
  const selectionLabel = useMemo(() => {
    if (selectedHorseIds.length === 0) return null;
    const names = selectedHorseIds.map((id) => {
      const h = horses.find((horse) => horse.id === id);
      return h ? h.name : `#${id}`;
    });
    return names.join(' → ');
  }, [selectedHorseIds, horses]);

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
        {phase === 'betting' && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
            <section>
              {/* レース情報 */}
              <div className="mb-4">
                <RaceInfoBanner raceConfig={raceConfig} />
              </div>

              {/* 賭け方選択タブ */}
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

              <h2 className="text-base font-bold text-slate-800 mb-3">
                出走表（{betType}予想）
                {betTypeInfo.horseCount > 1 && (
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
