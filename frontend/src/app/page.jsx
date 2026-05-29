// 競馬予想ゲーム メイン画面
// 3 フェーズ（betting / racing / result）の UI と状態管理
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Trophy, Coins, Play, RotateCcw, Star, Wind } from 'lucide-react';
import {
  RUNNING_STYLES,
  STEP_INTERVAL_MS,
  RACE_STEPS,
  INITIAL_COINS,
  MIN_BET,
  HORSE_COUNT,
  generateHorses,
  calculateOdds,
  initRaceState,
  stepRace,
  isRaceFinished,
  rankHorses,
  calcPayout,
  isWinningBet,
  conditionBadge,
} from '../utils/game-logic.js';

// ステータスバー（speed/stamina/stability の数値＋バー）
function StatBar({ label, value, color }) {
  const pct = Math.min(100, Math.max(0, ((value - 40) / 60) * 100));
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 text-slate-500">{label}</span>
      <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right font-semibold text-slate-700">{value}</span>
    </div>
  );
}

// 馬カード（ベットフェーズ）
function HorseCard({ horse, selected, onSelect }) {
  const badge = conditionBadge(horse.displayCondition);
  return (
    <button
      type="button"
      onClick={() => onSelect(horse.id)}
      className={`text-left bg-white rounded-2xl shadow-sm hover:shadow-md transition border-2 ${
        selected ? 'border-accent ring-2 ring-orange-200' : 'border-transparent'
      } p-4 flex flex-col gap-2`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
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
      </div>
      <div className="flex flex-col gap-1 mt-1">
        <StatBar label="speed" value={horse.speed} color="bg-rose-400" />
        <StatBar label="stamina" value={horse.stamina} color="bg-emerald-400" />
        <StatBar label="stability" value={horse.stability} color="bg-sky-400" />
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

// レース中のプログレスバー
function RaceTrack({ raceState, betHorseId }) {
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
        const isBet = h.id === betHorseId;
        return (
          <div key={h.id} className="flex items-center gap-2">
            <span className="w-6 text-xs text-slate-400 text-right">{idx + 1}位</span>
            <span
              className={`w-32 truncate text-sm font-semibold ${
                isBet ? 'text-accent' : 'text-slate-700'
              }`}
            >
              {isBet && <Star className="w-3 h-3 inline mr-1 fill-current" />}
              {h.name}
            </span>
            <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden relative">
              <div
                className={`h-full ${
                  isBet ? 'bg-accent' : 'bg-slate-400'
                } transition-[width] duration-100 ease-linear`}
                style={{ width: `${Math.min(100, h.position)}%` }}
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
function ResultList({ ranking, betHorseId }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-4">
      <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
        <Trophy className="w-4 h-4 text-accent" />
        最終着順
      </h3>
      <ol className="space-y-1">
        {ranking.map((h) => {
          const isBet = h.id === betHorseId;
          return (
            <li
              key={h.id}
              className={`flex items-center justify-between text-sm py-1 px-2 rounded ${
                isBet ? 'bg-orange-50' : ''
              }`}
            >
              <span className="flex items-center gap-2">
                <span
                  className={`w-6 text-center text-xs font-bold rounded ${
                    h.rank === 1
                      ? 'bg-amber-200 text-amber-900'
                      : h.rank === 2
                      ? 'bg-slate-200 text-slate-800'
                      : h.rank === 3
                      ? 'bg-orange-200 text-orange-900'
                      : 'bg-slate-50 text-slate-500'
                  }`}
                >
                  {h.rank}
                </span>
                <span className={`font-semibold ${isBet ? 'text-accent' : 'text-slate-700'}`}>
                  {isBet && <Star className="w-3 h-3 inline mr-1 fill-current" />}
                  {h.name}
                </span>
                <span className="text-xs text-slate-400">({h.runningStyle})</span>
              </span>
              <span className="text-xs text-slate-400">{h.odds.toFixed(1)}倍</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// メインページ
export default function Page() {
  const [phase, setPhase] = useState('betting'); // betting | racing | result
  const [coins, setCoins] = useState(INITIAL_COINS);
  const [horses, setHorses] = useState(() => calculateOdds(generateHorses(HORSE_COUNT)));
  const [selectedHorseId, setSelectedHorseId] = useState(null);
  const [betAmount, setBetAmount] = useState(MIN_BET);
  const [raceState, setRaceState] = useState([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [ranking, setRanking] = useState([]);
  const [lastPayout, setLastPayout] = useState(0);
  const [lastBet, setLastBet] = useState({ horseId: null, amount: 0, odds: 0 });
  const timerRef = useRef(null);

  // 選択中の馬
  const selectedHorse = useMemo(
    () => horses.find((h) => h.id === selectedHorseId) || null,
    [horses, selectedHorseId]
  );

  // 払戻予定額（リアルタイム）
  const expectedPayout = useMemo(() => {
    if (!selectedHorse) return 0;
    return calcPayout(betAmount, selectedHorse.odds);
  }, [selectedHorse, betAmount]);

  // ベット額バリデーション
  const canStart = useMemo(() => {
    return (
      selectedHorseId !== null &&
      betAmount >= MIN_BET &&
      betAmount <= coins &&
      phase === 'betting'
    );
  }, [selectedHorseId, betAmount, coins, phase]);

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
    setHorses(calculateOdds(generateHorses(HORSE_COUNT)));
    setSelectedHorseId(null);
    setBetAmount(MIN_BET);
    setRaceState([]);
    setStepIndex(0);
    setRanking([]);
    setLastPayout(0);
    setPhase('betting');
  }, []);

  // 所持コインリセット
  const handleReset = useCallback(() => {
    setCoins(INITIAL_COINS);
    prepareNewRace();
  }, [prepareNewRace]);

  // レース開始
  const handleStartRace = useCallback(() => {
    if (!canStart || !selectedHorse) return;
    setCoins((c) => c - betAmount);
    setLastBet({
      horseId: selectedHorse.id,
      amount: betAmount,
      odds: selectedHorse.odds,
    });
    setRaceState(initRaceState(horses));
    setStepIndex(0);
    setPhase('racing');
  }, [canStart, selectedHorse, betAmount, horses]);

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
        // 払戻判定
        if (isWinningBet(ranked, lastBet.horseId)) {
          const payout = calcPayout(lastBet.amount, lastBet.odds);
          setLastPayout(payout);
          setCoins((c) => c + payout);
        } else {
          setLastPayout(0);
        }
        setPhase('result');
        if (timerRef.current) clearInterval(timerRef.current);
      }
      return next;
    });
  }, [stepIndex, phase, lastBet]);

  // ヘッダー
  const Header = (
    <header className="bg-white shadow-sm sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg sm:text-xl font-bold text-slate-800 flex items-center gap-2">
          <Trophy className="w-5 h-5 text-accent" />
          KeibaSimu
        </h1>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 px-3 py-1.5 bg-orange-50 rounded-full text-accent font-bold">
            <Coins className="w-4 h-4" />
            <span>{coins}C</span>
          </div>
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-full text-slate-700 text-sm"
          >
            <RotateCcw className="w-4 h-4" />
            リセット
          </button>
        </div>
      </div>
    </header>
  );

  return (
    <div className="min-h-full">
      {Header}
      <main className="max-w-6xl mx-auto px-4 py-6">
        {phase === 'betting' && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
            <section>
              <h2 className="text-base font-bold text-slate-800 mb-3">
                出走表（単勝予想）
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {horses.map((h) => (
                  <HorseCard
                    key={h.id}
                    horse={h}
                    selected={h.id === selectedHorseId}
                    onSelect={setSelectedHorseId}
                  />
                ))}
              </div>

              <div className="bg-white rounded-2xl shadow-sm p-4 mt-4 flex flex-col gap-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="text-sm text-slate-600">
                    {selectedHorse ? (
                      <>
                        選択中: <span className="font-bold text-slate-800">{selectedHorse.name}</span>{' '}
                        <span className="text-accent font-bold">
                          {selectedHorse.odds.toFixed(1)}倍
                        </span>
                      </>
                    ) : (
                      <>馬を選択してください</>
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
            <div className="bg-white rounded-2xl shadow-sm p-4 flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-800">レース中…</h2>
              <span className="text-xs text-slate-400">
                ステップ {Math.min(stepIndex, RACE_STEPS)} / {RACE_STEPS}
              </span>
            </div>
            <RaceTrack raceState={raceState} betHorseId={lastBet.horseId} />
          </div>
        )}

        {phase === 'result' && (
          <div className="flex flex-col gap-4">
            <div className="bg-white rounded-2xl shadow-sm p-6 text-center">
              {lastPayout > 0 ? (
                <>
                  <p className="text-2xl font-bold text-accent">🎉 的中！</p>
                  <p className="mt-2 text-slate-700">
                    払戻金額:{' '}
                    <span className="font-bold text-accent text-xl">{lastPayout}C</span>
                  </p>
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold text-slate-700">😢 残念…</p>
                  <p className="mt-2 text-slate-500">次のレースに期待しましょう</p>
                </>
              )}
            </div>
            <ResultList ranking={ranking} betHorseId={lastBet.horseId} />
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
    </div>
  );
}
