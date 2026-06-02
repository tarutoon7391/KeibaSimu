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
  大逃げ: { early: 1.65, middle: 1.0, late: 0.45, description: '序盤から全力。終盤でバテる' },
  逃げ: { early: 1.4, middle: 0.95, late: 0.75, description: '先頭を走りながらスタミナ温存' },
  先行: { early: 1.15, middle: 1.05, late: 0.9, description: '先団に位置し粘り強く走る' },
  差し: { early: 0.8, middle: 1.0, late: 1.3, description: '中団で足をため終盤に加速' },
  追込: { early: 0.65, middle: 0.85, late: 1.6, description: '後方から最後に一気に追い込む' },
  直線一気: { early: 0.55, middle: 0.75, late: 1.8, description: '最後方から直線で全力追い込み' },
  まくり: { early: 0.7, middle: 1.6, late: 0.8, description: '中盤から大外を豪快にまくる' },
};
export const RUNNING_STYLE_NAMES = Object.keys(RUNNING_STYLES);

// レース定数
export const RACE_STEPS = 200; // 総ステップ数
export const STEP_INTERVAL_MS = 180; // ステップ間隔

// ゲーム設定
export const HORSE_COUNT = 8;
export const INITIAL_COINS = 1000;
export const MIN_BET = 10;
export const HOUSE_MARGIN = 0.85; // 控除率15%
export const MIN_ODDS = 1.1;

// ---------- ステータス変換テーブル ----------
export const STATUS_TABLE = { E: 70, D: 73, C: 76, B: 80, A: 84, S: 88, SS: 93, SSS: 97 };

// ---------- レース条件 ----------
export const RACE_COURSES = ['short', 'mile', 'long'];
export const RACE_TRACKS = ['turf', 'dirt'];

// ---------- 馬プール（100頭） ----------
const HORSE_POOL = [
  { name: 'サクラバクシンオー', speed: 'SS', stamina: 'D', stability: 'A', burst: 'S', turfFit: 'SS', dirtFit: 'C', distanceFit: 'short', runningStyle: '逃げ' },
  { name: 'タイキシャトル', speed: 'SS', stamina: 'C', stability: 'SS', burst: 'A', turfFit: 'SSS', dirtFit: 'C', distanceFit: 'short-mile', runningStyle: '先行' },
  { name: 'ロードカナロア', speed: 'SSS', stamina: 'C', stability: 'S', burst: 'SS', turfFit: 'SSS', dirtFit: 'B', distanceFit: 'short', runningStyle: '先行' },
  { name: 'グランアレグリア', speed: 'SS', stamina: 'B', stability: 'S', burst: 'SS', turfFit: 'SSS', dirtFit: 'D', distanceFit: 'short-mile', runningStyle: '差し' },
  { name: 'アーモンドアイ', speed: 'SS', stamina: 'A', stability: 'SS', burst: 'SS', turfFit: 'SSS', dirtFit: 'D', distanceFit: 'short-mile', runningStyle: '差し' },
  { name: 'デュランダル', speed: 'S', stamina: 'D', stability: 'A', burst: 'SSS', turfFit: 'SS', dirtFit: 'C', distanceFit: 'short-mile', runningStyle: '差し' },
  { name: 'カレンチャン', speed: 'SS', stamina: 'D', stability: 'S', burst: 'A', turfFit: 'SS', dirtFit: 'C', distanceFit: 'short', runningStyle: '逃げ' },
  { name: 'モーリス', speed: 'S', stamina: 'A', stability: 'SS', burst: 'S', turfFit: 'SSS', dirtFit: 'C', distanceFit: 'mile', runningStyle: '先行' },
  { name: 'ダイワメジャー', speed: 'A', stamina: 'S', stability: 'SS', burst: 'A', turfFit: 'SS', dirtFit: 'B', distanceFit: 'mile', runningStyle: '先行' },
  { name: 'ストロングリターン', speed: 'A', stamina: 'B', stability: 'A', burst: 'S', turfFit: 'S', dirtFit: 'B', distanceFit: 'mile', runningStyle: '差し' },
  { name: 'エアジハード', speed: 'S', stamina: 'B', stability: 'A', burst: 'A', turfFit: 'SS', dirtFit: 'C', distanceFit: 'mile', runningStyle: '先行' },
  { name: 'トーセンラー', speed: 'A', stamina: 'A', stability: 'S', burst: 'SS', turfFit: 'SS', dirtFit: 'D', distanceFit: 'mile', runningStyle: '差し' },
  { name: 'イスラボニータ', speed: 'A', stamina: 'B', stability: 'S', burst: 'A', turfFit: 'S', dirtFit: 'B', distanceFit: 'short-mile', runningStyle: '先行' },
  { name: 'ペルシアンナイト', speed: 'A', stamina: 'A', stability: 'A', burst: 'S', turfFit: 'S', dirtFit: 'C', distanceFit: 'mile', runningStyle: '差し' },
  { name: 'シンボリルドルフ', speed: 'SS', stamina: 'SS', stability: 'SSS', burst: 'S', turfFit: 'SSS', dirtFit: 'B', distanceFit: 'mile-long', runningStyle: '先行' },
  { name: 'ナリタブライアン', speed: 'SS', stamina: 'SS', stability: 'SS', burst: 'SS', turfFit: 'SSS', dirtFit: 'B', distanceFit: 'mile-long', runningStyle: '先行' },
  { name: 'ディープインパクト', speed: 'SSS', stamina: 'SS', stability: 'SS', burst: 'SSS', turfFit: 'SSS', dirtFit: 'D', distanceFit: 'mile-long', runningStyle: '追込' },
  { name: 'オルフェーヴル', speed: 'SS', stamina: 'SS', stability: 'B', burst: 'SSS', turfFit: 'SSS', dirtFit: 'C', distanceFit: 'mile-long', runningStyle: '追込' },
  { name: 'キタサンブラック', speed: 'S', stamina: 'SSS', stability: 'SS', burst: 'S', turfFit: 'SSS', dirtFit: 'B', distanceFit: 'mile-long', runningStyle: '逃げ' },
  { name: 'テイエムオペラオー', speed: 'S', stamina: 'SSS', stability: 'SSS', burst: 'A', turfFit: 'SSS', dirtFit: 'B', distanceFit: 'mile-long', runningStyle: '先行' },
  { name: 'メジロマックイーン', speed: 'A', stamina: 'SSS', stability: 'SS', burst: 'S', turfFit: 'SSS', dirtFit: 'C', distanceFit: 'long', runningStyle: '先行' },
  { name: 'スペシャルウィーク', speed: 'S', stamina: 'SS', stability: 'S', burst: 'SS', turfFit: 'SSS', dirtFit: 'C', distanceFit: 'long', runningStyle: '差し' },
  { name: 'ゴールドシップ', speed: 'S', stamina: 'SS', stability: 'E', burst: 'SSS', turfFit: 'SS', dirtFit: 'C', distanceFit: 'long', runningStyle: 'まくり' },
  { name: 'フェノーメノ', speed: 'A', stamina: 'SSS', stability: 'S', burst: 'S', turfFit: 'SS', dirtFit: 'C', distanceFit: 'long', runningStyle: '先行' },
  { name: 'マヤノトップガン', speed: 'S', stamina: 'SS', stability: 'A', burst: 'SS', turfFit: 'SS', dirtFit: 'B', distanceFit: 'long', runningStyle: '逃げ' },
  { name: 'サトノダイヤモンド', speed: 'S', stamina: 'SS', stability: 'S', burst: 'SS', turfFit: 'SS', dirtFit: 'D', distanceFit: 'long', runningStyle: '差し' },
  { name: 'ジェンティルドンナ', speed: 'S', stamina: 'SS', stability: 'S', burst: 'SS', turfFit: 'SSS', dirtFit: 'D', distanceFit: 'mile-long', runningStyle: '先行' },
  { name: 'ウオッカ', speed: 'S', stamina: 'A', stability: 'S', burst: 'SS', turfFit: 'SSS', dirtFit: 'C', distanceFit: 'mile-long', runningStyle: '差し' },
  { name: 'ダイワスカーレット', speed: 'SS', stamina: 'A', stability: 'SS', burst: 'S', turfFit: 'SS', dirtFit: 'B', distanceFit: 'mile-long', runningStyle: '逃げ' },
  { name: 'イクイノックス', speed: 'SSS', stamina: 'SSS', stability: 'SS', burst: 'SSS', turfFit: 'SSS', dirtFit: 'B', distanceFit: 'mile-long', runningStyle: '先行' },
  { name: 'リバティアイランド', speed: 'SS', stamina: 'SS', stability: 'SS', burst: 'SSS', turfFit: 'SSS', dirtFit: 'D', distanceFit: 'mile-long', runningStyle: '追込' },
  { name: 'ドウデュース', speed: 'SS', stamina: 'S', stability: 'A', burst: 'SSS', turfFit: 'SS', dirtFit: 'C', distanceFit: 'mile-long', runningStyle: '差し' },
  { name: 'タスティエーラ', speed: 'S', stamina: 'S', stability: 'S', burst: 'S', turfFit: 'SS', dirtFit: 'B', distanceFit: 'mile-long', runningStyle: '先行' },
  { name: 'ハルウララ', speed: 'E', stamina: 'D', stability: 'C', burst: 'E', turfFit: 'D', dirtFit: 'D', distanceFit: 'short-mile', runningStyle: '追込' },
  { name: 'サイレンススズカ', speed: 'SSS', stamina: 'S', stability: 'B', burst: 'S', turfFit: 'SSS', dirtFit: 'C', distanceFit: 'mile-long', runningStyle: '大逃げ' },
  { name: 'エルコンドルパサー', speed: 'SS', stamina: 'SS', stability: 'SS', burst: 'SS', turfFit: 'SS', dirtFit: 'S', distanceFit: 'mile-long', runningStyle: '先行' },
  { name: 'グラスワンダー', speed: 'SS', stamina: 'S', stability: 'SS', burst: 'SS', turfFit: 'SS', dirtFit: 'B', distanceFit: 'mile-long', runningStyle: '差し' },
  { name: 'ハーツクライ', speed: 'S', stamina: 'SS', stability: 'S', burst: 'SS', turfFit: 'SS', dirtFit: 'C', distanceFit: 'long', runningStyle: '差し' },
  { name: 'トウカイテイオー', speed: 'SS', stamina: 'S', stability: 'A', burst: 'SS', turfFit: 'SS', dirtFit: 'C', distanceFit: 'mile-long', runningStyle: '先行' },
  { name: 'スマートファルコン', speed: 'SS', stamina: 'SS', stability: 'SS', burst: 'S', turfFit: 'D', dirtFit: 'SSS', distanceFit: 'mile-long', runningStyle: '逃げ' },
  { name: 'ヴァーミリアン', speed: 'S', stamina: 'SS', stability: 'S', burst: 'S', turfFit: 'C', dirtFit: 'SSS', distanceFit: 'mile-long', runningStyle: '先行' },
  { name: 'カネヒキリ', speed: 'SS', stamina: 'S', stability: 'S', burst: 'SS', turfFit: 'D', dirtFit: 'SS', distanceFit: 'mile', runningStyle: '先行' },
  { name: 'クロフネ', speed: 'SS', stamina: 'A', stability: 'S', burst: 'SS', turfFit: 'B', dirtFit: 'SSS', distanceFit: 'mile', runningStyle: '逃げ' },
  { name: 'ゴールドドリーム', speed: 'S', stamina: 'A', stability: 'SS', burst: 'S', turfFit: 'C', dirtFit: 'SS', distanceFit: 'mile', runningStyle: '差し' },
  { name: 'チュウワウィザード', speed: 'S', stamina: 'SS', stability: 'S', burst: 'S', turfFit: 'C', dirtFit: 'SSS', distanceFit: 'mile-long', runningStyle: '先行' },
  { name: 'テーオーケインズ', speed: 'SS', stamina: 'SS', stability: 'SS', burst: 'SS', turfFit: 'C', dirtFit: 'SSS', distanceFit: 'mile-long', runningStyle: '先行' },
  { name: 'メイショウボーラー', speed: 'SS', stamina: 'C', stability: 'S', burst: 'A', turfFit: 'C', dirtFit: 'SS', distanceFit: 'short', runningStyle: '逃げ' },
  { name: 'ウシュバテソーロ', speed: 'S', stamina: 'SS', stability: 'S', burst: 'SS', turfFit: 'C', dirtFit: 'SSS', distanceFit: 'mile-long', runningStyle: '差し' },
  { name: 'フランケル', speed: 'SSS', stamina: 'SS', stability: 'SSS', burst: 'SSS', turfFit: 'SSS', dirtFit: 'C', distanceFit: 'mile', runningStyle: '先行' },
  { name: 'エネイブル', speed: 'SS', stamina: 'SSS', stability: 'SS', burst: 'SS', turfFit: 'SSS', dirtFit: 'C', distanceFit: 'long', runningStyle: '差し' },
  { name: 'ブラックキャビア', speed: 'SSS', stamina: 'B', stability: 'SSS', burst: 'SS', turfFit: 'SSS', dirtFit: 'A', distanceFit: 'short', runningStyle: '先行' },
  { name: 'シーザスターズ', speed: 'SS', stamina: 'SS', stability: 'SS', burst: 'SS', turfFit: 'SSS', dirtFit: 'C', distanceFit: 'mile-long', runningStyle: '差し' },
  { name: 'ガリレオ', speed: 'SS', stamina: 'SSS', stability: 'SS', burst: 'S', turfFit: 'SSS', dirtFit: 'C', distanceFit: 'long', runningStyle: '先行' },
  { name: 'ジャスタウェイ', speed: 'SS', stamina: 'S', stability: 'S', burst: 'SSS', turfFit: 'SSS', dirtFit: 'C', distanceFit: 'mile-long', runningStyle: '差し' },
  { name: 'エピファネイア', speed: 'SS', stamina: 'S', stability: 'SS', burst: 'SS', turfFit: 'SS', dirtFit: 'B', distanceFit: 'mile-long', runningStyle: '先行' },
  { name: 'フィエールマン', speed: 'S', stamina: 'SS', stability: 'S', burst: 'SS', turfFit: 'SS', dirtFit: 'D', distanceFit: 'long', runningStyle: '差し' },
  { name: 'リスグラシュー', speed: 'S', stamina: 'SS', stability: 'S', burst: 'SS', turfFit: 'SS', dirtFit: 'C', distanceFit: 'long', runningStyle: '差し' },
  { name: 'クロノジェネシス', speed: 'S', stamina: 'SS', stability: 'SS', burst: 'SS', turfFit: 'SS', dirtFit: 'S', distanceFit: 'mile-long', runningStyle: '差し' },
  { name: 'コントレイル', speed: 'SS', stamina: 'SS', stability: 'SS', burst: 'SS', turfFit: 'SSS', dirtFit: 'C', distanceFit: 'mile-long', runningStyle: '差し' },
  { name: 'デアリングタクト', speed: 'S', stamina: 'SS', stability: 'SS', burst: 'SS', turfFit: 'SSS', dirtFit: 'C', distanceFit: 'mile-long', runningStyle: '追込' },
  { name: 'パンサラッサ', speed: 'SS', stamina: 'SS', stability: 'B', burst: 'A', turfFit: 'SS', dirtFit: 'A', distanceFit: 'mile-long', runningStyle: '大逃げ' },
  { name: 'タイトルホルダー', speed: 'S', stamina: 'SSS', stability: 'S', burst: 'A', turfFit: 'SS', dirtFit: 'C', distanceFit: 'long', runningStyle: '逃げ' },
  { name: 'ジャックドール', speed: 'SS', stamina: 'S', stability: 'S', burst: 'S', turfFit: 'SS', dirtFit: 'B', distanceFit: 'mile-long', runningStyle: '逃げ' },
  { name: 'ダノンベルーガ', speed: 'SS', stamina: 'S', stability: 'S', burst: 'SS', turfFit: 'SS', dirtFit: 'C', distanceFit: 'mile-long', runningStyle: '差し' },
  { name: 'シャフリヤール', speed: 'S', stamina: 'S', stability: 'S', burst: 'SS', turfFit: 'SS', dirtFit: 'B', distanceFit: 'mile-long', runningStyle: '差し' },
  { name: 'エフフォーリア', speed: 'SS', stamina: 'S', stability: 'S', burst: 'SS', turfFit: 'SS', dirtFit: 'B', distanceFit: 'mile-long', runningStyle: '先行' },
  { name: 'セリフォス', speed: 'SS', stamina: 'A', stability: 'S', burst: 'SS', turfFit: 'SS', dirtFit: 'C', distanceFit: 'mile', runningStyle: '差し' },
  { name: 'ナミュール', speed: 'SS', stamina: 'A', stability: 'A', burst: 'SS', turfFit: 'SS', dirtFit: 'C', distanceFit: 'mile', runningStyle: '差し' },
  { name: 'ソングライン', speed: 'SS', stamina: 'B', stability: 'SS', burst: 'SS', turfFit: 'SS', dirtFit: 'C', distanceFit: 'mile', runningStyle: '差し' },
  { name: 'シュネルマイスター', speed: 'S', stamina: 'A', stability: 'SS', burst: 'S', turfFit: 'SS', dirtFit: 'C', distanceFit: 'mile', runningStyle: '差し' },
  { name: 'ガイアフォース', speed: 'SS', stamina: 'A', stability: 'S', burst: 'S', turfFit: 'S', dirtFit: 'B', distanceFit: 'mile', runningStyle: '先行' },
  { name: 'マテンロウオリオン', speed: 'A', stamina: 'B', stability: 'A', burst: 'A', turfFit: 'A', dirtFit: 'B', distanceFit: 'mile', runningStyle: '先行' },
  { name: 'スターズオンアース', speed: 'SS', stamina: 'S', stability: 'SS', burst: 'SS', turfFit: 'SS', dirtFit: 'C', distanceFit: 'mile-long', runningStyle: '差し' },
  { name: 'ジオグリフ', speed: 'S', stamina: 'A', stability: 'S', burst: 'SS', turfFit: 'S', dirtFit: 'S', distanceFit: 'mile', runningStyle: '先行' },
  { name: 'プログノーシス', speed: 'SS', stamina: 'S', stability: 'S', burst: 'SS', turfFit: 'SS', dirtFit: 'C', distanceFit: 'mile-long', runningStyle: '差し' },
  { name: 'ベラジオオペラ', speed: 'S', stamina: 'S', stability: 'SS', burst: 'S', turfFit: 'SS', dirtFit: 'B', distanceFit: 'mile-long', runningStyle: '先行' },
  { name: 'ソールオリエンス', speed: 'SS', stamina: 'S', stability: 'B', burst: 'SSS', turfFit: 'SS', dirtFit: 'C', distanceFit: 'mile-long', runningStyle: 'まくり' },
  { name: 'ファントムシーフ', speed: 'S', stamina: 'A', stability: 'S', burst: 'S', turfFit: 'S', dirtFit: 'B', distanceFit: 'mile', runningStyle: '先行' },
  { name: 'レモンポップ', speed: 'SS', stamina: 'A', stability: 'SS', burst: 'S', turfFit: 'C', dirtFit: 'SSS', distanceFit: 'mile', runningStyle: '逃げ' },
  { name: 'ウィルソンテソーロ', speed: 'S', stamina: 'S', stability: 'S', burst: 'SS', turfFit: 'C', dirtFit: 'SS', distanceFit: 'mile-long', runningStyle: '差し' },
  { name: 'デュードヴァン', speed: 'S', stamina: 'A', stability: 'A', burst: 'S', turfFit: 'C', dirtFit: 'S', distanceFit: 'mile', runningStyle: '先行' },
  { name: 'シャマル', speed: 'SS', stamina: 'C', stability: 'S', burst: 'S', turfFit: 'C', dirtFit: 'SS', distanceFit: 'short', runningStyle: '逃げ' },
  { name: 'タガロア', speed: 'SS', stamina: 'B', stability: 'S', burst: 'SS', turfFit: 'S', dirtFit: 'SS', distanceFit: 'short-mile', runningStyle: '先行' },
  { name: 'ハイアムズビーチ', speed: 'SS', stamina: 'C', stability: 'SS', burst: 'S', turfFit: 'S', dirtFit: 'SS', distanceFit: 'short', runningStyle: '逃げ' },
  { name: 'ウインカーネリアン', speed: 'A', stamina: 'A', stability: 'SS', burst: 'A', turfFit: 'S', dirtFit: 'A', distanceFit: 'mile', runningStyle: '逃げ' },
  { name: 'マルターズディオサ', speed: 'A', stamina: 'B', stability: 'A', burst: 'S', turfFit: 'A', dirtFit: 'B', distanceFit: 'mile', runningStyle: '差し' },
  { name: 'ヴィクティファルス', speed: 'A', stamina: 'B', stability: 'A', burst: 'A', turfFit: 'A', dirtFit: 'B', distanceFit: 'mile', runningStyle: '先行' },
  { name: 'ピクシーナイト', speed: 'SS', stamina: 'C', stability: 'S', burst: 'SS', turfFit: 'SS', dirtFit: 'C', distanceFit: 'short', runningStyle: '逃げ' },
  { name: 'フラーズドラグーン', speed: 'S', stamina: 'B', stability: 'S', burst: 'S', turfFit: 'B', dirtFit: 'SS', distanceFit: 'short-mile', runningStyle: '先行' },
  { name: 'スリーカラーズ', speed: 'A', stamina: 'D', stability: 'S', burst: 'A', turfFit: 'C', dirtFit: 'S', distanceFit: 'short', runningStyle: '逃げ' },
  { name: 'バーデンヴァイラー', speed: 'A', stamina: 'C', stability: 'A', burst: 'A', turfFit: 'B', dirtFit: 'A', distanceFit: 'short', runningStyle: '先行' },
  { name: 'ラインベック', speed: 'B', stamina: 'B', stability: 'B', burst: 'B', turfFit: 'B', dirtFit: 'B', distanceFit: 'mile', runningStyle: '差し' },
  { name: 'サダムパテック', speed: 'A', stamina: 'A', stability: 'A', burst: 'S', turfFit: 'S', dirtFit: 'C', distanceFit: 'mile', runningStyle: '差し' },
  { name: 'レインボーライン', speed: 'A', stamina: 'SS', stability: 'A', burst: 'SS', turfFit: 'SS', dirtFit: 'C', distanceFit: 'long', runningStyle: '差し' },
  { name: 'フィールドシシオ', speed: 'C', stamina: 'D', stability: 'B', burst: 'C', turfFit: 'C', dirtFit: 'C', distanceFit: 'short', runningStyle: '追込' },
  { name: 'ペイシャフェリシタ', speed: 'C', stamina: 'C', stability: 'B', burst: 'B', turfFit: 'B', dirtFit: 'C', distanceFit: 'mile', runningStyle: '先行' },
  { name: 'アスクビクターモア', speed: 'A', stamina: 'SS', stability: 'S', burst: 'A', turfFit: 'SS', dirtFit: 'C', distanceFit: 'long', runningStyle: '逃げ' },
  { name: 'アスクワイルドモア', speed: 'A', stamina: 'S', stability: 'A', burst: 'S', turfFit: 'S', dirtFit: 'B', distanceFit: 'long', runningStyle: '差し' },
  { name: 'カッパバクソクシン', speed: 'SSS', stamina: 'E', stability: 'D', burst: 'SSS', turfFit: 'SSS', dirtFit: 'SSS', distanceFit: 'short', runningStyle: '直線一気' },
  { name: 'カッパオオマクリ', speed: 'SS', stamina: 'SS', stability: 'D', burst: 'SSS', turfFit: 'SS', dirtFit: 'SS', distanceFit: 'mile-long', runningStyle: 'まくり' },
  { name: 'カッパオオニゲシン', speed: 'SSS', stamina: 'SSS', stability: 'B', burst: 'A', turfFit: 'SSS', dirtFit: 'SSS', distanceFit: 'all', runningStyle: '大逃げ' },
  { name: 'カッパサイキョウ', speed: 'SSS', stamina: 'SSS', stability: 'SSS', burst: 'SSS', turfFit: 'SSS', dirtFit: 'SSS', distanceFit: 'all', runningStyle: '先行' },
  { name: 'カッパムテキ', speed: 'SSS', stamina: 'SS', stability: 'SS', burst: 'SSS', turfFit: 'SSS', dirtFit: 'SSS', distanceFit: 'all', runningStyle: '追込' },
  { name: 'カッパオイコミ', speed: 'D', stamina: 'SSS', stability: 'SSS', burst: 'SSS', turfFit: 'SS', dirtFit: 'SS', distanceFit: 'long', runningStyle: '直線一気' },
  { name: 'カッパハチャメチャ', speed: 'SSS', stamina: 'E', stability: 'E', burst: 'SSS', turfFit: 'SSS', dirtFit: 'SSS', distanceFit: 'short', runningStyle: '大逃げ' },
];

// ---------- グレード変換ユーティリティ ----------

function convertGrade(grade) {
  return STATUS_TABLE[grade] ?? 50;
}

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

// ---------- 馬生成 ----------

// プールから count 頭をランダム抽出して馬を生成する
export function selectHorsesFromPool(count = HORSE_COUNT) {
  const shuffled = [...HORSE_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map((raw, i) => {
    const trueCondition = Math.random();
    const displayCondition = clamp(trueCondition + gaussianNoise(0, 0.2), 0, 1);
    return {
      id: i + 1,
      name: raw.name,
      speed: convertGrade(raw.speed),
      stamina: convertGrade(raw.stamina),
      stability: convertGrade(raw.stability),
      burst: convertGrade(raw.burst),
      turfFit: convertGrade(raw.turfFit),
      dirtFit: convertGrade(raw.dirtFit),
      distanceFit: raw.distanceFit,
      runningStyle: raw.runningStyle,
      trueCondition,
      displayCondition,
    };
  });
}

// レース条件（コース・馬場）をランダム生成する
export function generateRaceConfig() {
  const courseType = RACE_COURSES[Math.floor(Math.random() * RACE_COURSES.length)];
  const trackType = RACE_TRACKS[Math.floor(Math.random() * RACE_TRACKS.length)];
  return { courseType, trackType };
}

// 出走馬一覧を生成する（プールから抽出）
export function generateHorses(count = HORSE_COUNT) {
  return selectHorsesFromPool(count);
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

// 補正済みステータス値を返す（距離・馬場適性を含む）
export function applyConditionToStats(horse, actualCondition, raceConfig = null) {
  const m = conditionMultiplier(actualCondition);

  let distanceMult = 1.0;
  let trackMult = 1.0;
  if (raceConfig) {
    const { courseType, trackType } = raceConfig;
    // 距離適性："all" または該当コースを含む場合×1.1、それ以外×0.9
    if (horse.distanceFit === 'all') {
      distanceMult = 1.1;
    } else if (horse.distanceFit && horse.distanceFit.split('-').includes(courseType)) {
      distanceMult = 1.1;
    } else {
      distanceMult = 0.9;
    }
    // 馬場適性：ランク値/100 を係数として使用
    const fitValue = trackType === 'turf' ? horse.turfFit : horse.dirtFit;
    if (fitValue != null) {
      trackMult = fitValue / 100;
    }
  }

  const fitMult = distanceMult * trackMult;
  return {
    speedReal: horse.speed * m * fitMult,
    staminaReal: horse.stamina * m * fitMult,
    stabilityReal: horse.stability * m * fitMult,
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
export function initRaceState(horsesWithOdds, raceConfig = null) {
  const config = raceConfig ?? generateRaceConfig();
  return horsesWithOdds.map((h) => {
    const actualCondition = rollActualCondition(h.trueCondition);
    const stats = applyConditionToStats(h, actualCondition, config);
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
    const advance = (realScore / 68) * styleMult * pace * condMult * random;
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

// ---------- 賭け方 ----------

// 賭け方の種類（key, label, 選択必要馬数）
export const BET_TYPES = [
  { key: '単勝', label: '単勝', horseCount: 1 },
  { key: '複勝', label: '複勝', horseCount: 1 },
  { key: '馬連', label: '馬連', horseCount: 2 },
  { key: '馬単', label: '馬単', horseCount: 2 },
  { key: '3連複', label: '3連複', horseCount: 3 },
  { key: '3連単', label: '3連単', horseCount: 3 },
];

// 賭け方・選択馬に応じたオッズを計算する
// horses: calculateOdds 済みの馬配列
// betType: BET_TYPES の key
// horseIds: 選択した馬ID の配列（選択順）
export function calculateBetOdds(horses, betType, horseIds) {
  const oddsMap = {};
  horses.forEach((h) => { oddsMap[h.id] = h.odds; });
  const o = (id) => oddsMap[id] ?? 1;
  const round1 = (v) => Math.round(v * 10) / 10;

  switch (betType) {
    case '単勝':
      return Math.max(MIN_ODDS, o(horseIds[0]));
    case '複勝':
      return Math.max(MIN_ODDS, round1(o(horseIds[0]) / 3));
    case '馬連':
      return Math.max(MIN_ODDS, round1(o(horseIds[0]) * o(horseIds[1]) * 0.8));
    case '馬単':
      return Math.max(MIN_ODDS, round1(o(horseIds[0]) * o(horseIds[1]) * 0.8 * 1.5));
    case '3連複':
      return Math.max(MIN_ODDS, round1(o(horseIds[0]) * o(horseIds[1]) * o(horseIds[2]) * 0.6));
    case '3連単':
      return Math.max(MIN_ODDS, round1(o(horseIds[0]) * o(horseIds[1]) * o(horseIds[2]) * 0.6 * 4.0));
    default:
      return MIN_ODDS;
  }
}

// 賭け方別の的中判定
// rankedState: rankHorses 済みの配列
// betType: 賭け方の key
// horseIds: 選択した馬ID の配列（選択順）
export function isWinningBetType(rankedState, betType, horseIds) {
  if (!horseIds || horseIds.length === 0) return false;
  const rank = (id) => {
    const h = rankedState.find((r) => r.id === id);
    return h ? h.rank : null;
  };

  switch (betType) {
    case '単勝':
      return rank(horseIds[0]) === 1;
    case '複勝': {
      const r = rank(horseIds[0]);
      return r !== null && r <= 3;
    }
    case '馬連': {
      const r0 = rank(horseIds[0]);
      const r1 = rank(horseIds[1]);
      return (r0 === 1 && r1 === 2) || (r0 === 2 && r1 === 1);
    }
    case '馬単':
      return rank(horseIds[0]) === 1 && rank(horseIds[1]) === 2;
    case '3連複': {
      const rs = new Set(horseIds.map(rank));
      return rs.has(1) && rs.has(2) && rs.has(3);
    }
    case '3連単':
      return rank(horseIds[0]) === 1 && rank(horseIds[1]) === 2 && rank(horseIds[2]) === 3;
    default:
      return false;
  }
}

// ---------- ベット結果 ----------

// 払戻金額を返す（的中時のみ）
export function calcPayout(betAmount, odds) {
  return Math.floor(betAmount * odds);
}

// 単勝的中判定（後方互換のため残す）
export function isWinningBet(rankedState, betHorseId) {
  if (betHorseId == null) return false;
  const top = rankedState.find((h) => h.rank === 1);
  return top && top.id === betHorseId;
}
