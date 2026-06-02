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
  BET_TYPES,
  generateHorses,
  calculateOdds,
  calculateBetOdds,
  initRaceState,
  stepRace,
  isRaceFinished,
  rankHorses,
  calcPayout,
  isWinningBetType,
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

// 選択順・着順に対応するメダルバッジ情報（0始まりの index を渡す）
const MEDAL_BADGES = [
  { emoji: '🥇', label: '1着予想', bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-400' },
  { emoji: '🥈', label: '2着予想', bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-400' },
  { emoji: '🥉', label: '3着予想', bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-400' },
];

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
  const [betType, setBetType] = useState('単勝');
  const [selectedHorseIds, setSelectedHorseIds] = useState([]);
  const [betAmount, setBetAmount] = useState(MIN_BET);
  const [raceState, setRaceState] = useState([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [ranking, setRanking] = useState([]);
  const [lastPayout, setLastPayout] = useState(0);
  const [lastBet, setLastBet] = useState({ horseIds: [], betType: '単勝', amount: 0, odds: 0 });
  const timerRef = useRef(null);

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
    setHorses(calculateOdds(generateHorses(HORSE_COUNT)));
    setBetType('単勝');
    setSelectedHorseIds([]);
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
    if (!canStart) return;
    const betOdds = calculateBetOdds(horses, betType, selectedHorseIds);
    setCoins((c) => c - betAmount);
    setLastBet({
      horseIds: selectedHorseIds,
      betType,
      amount: betAmount,
      odds: betOdds,
    });
    setRaceState(initRaceState(horses));
    setStepIndex(0);
    setPhase('racing');
  }, [canStart, betType, selectedHorseIds, betAmount, horses]);

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
        if (isWinningBetType(ranked, lastBet.betType, lastBet.horseIds)) {
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
            <div className="bg-white rounded-2xl shadow-sm p-6 text-center">
              {lastPayout > 0 ? (
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
    </div>
  );
}
