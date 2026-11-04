# クラシック: 展開隊 (分隊) に専用の脳を持たせる

## 背景
学習型 AI (第 475 世代) は旧型 AI に 34% で、学習しても伸びない。役割ごとに旧型 AI と入れ替えた 200 試合ずつの分析では、最初からいる護衛だけを旧型 AI にすると 45.5% に上がり、隊長だけ (32.5%)・展開隊だけ (33.5%) では変わらなかった。護衛と展開隊が同じ「護衛用の脳」を使っているので、数の多い展開隊の仕事 (広く動いて戦う) に合わせて学習が進み、護衛の仕事 (隊長のそばで守る) が下手になっていると考える。そこで、脳を 隊長用・護衛用・展開隊用 の 3 つに分ける。

## 外から見える形 (変えるもの)
`classic/brain.js` (`window.SagittariusBrain` / `require('./classic/brain.js')`)
- `ROLES` は `['leader', 'escort', 'detach']` にする (隊長用・護衛用・展開隊用)
- `roleOf(f)`: `f.leader` なら `'leader'`、そうでなく `f.detach` なら `'detach'`、それ以外は `'escort'`
- `controller(brains)`: 手がかりがあるときは `brains[roleOf(f)]` の脳で判断する (今と同じ。展開隊は `brains.detach` を使うようになる)。手がかりがないときは今と同じく旧型 AI の動き (`L.aiDecide`)
- `randomBrainSet(rng, scale)`: 3 つの役割すべての脳を作る
- `toPlain(set)`: 3 つのキー (`leader`・`escort`・`detach`) を持つ形で返す
- `fromPlain(o)`:
  - 3 つのキーがそろっていれば、それぞれ読む
  - **古い形** (`leader` と `escort` だけで `detach` がない) なら、`detach` は `escort` を写したもの (別の配列。片方を変えてももう片方は変わらない) にする。今の `training/classic/state.json`・`best.json`・`classic/learned-brain.js` は古い形なので、これで学習の続きとゲームが動く
  - 形が違う (長さが `paramCount()` でない、`leader` か `escort` がない、`detach` があるのに長さが違う) ときはエラー
- 入力 (`observe`)・出力 (`decide`)・`INPUTS`・`OUTPUTS`・`paramCount()` は変えない

ほかのファイル
- `scripts/classic-evolve.js` の突然変異・次の世代は `B.ROLES` を回しているので、3 つ目の脳も自動で変わる (コードの変更は要らない見込み。テストで確かめる)
- `scripts/classic-imitate.js` は `B.roleOf(f)` でお手本を分けているので、展開隊のお手本は `detach` に入る (コードの変更は要らない見込み)
- `scripts/classic-train.js` は `fromPlain` で状態を読むので、古い形の `state.json` から続きを学習できる (世代の番号は続きから)

## 受け入れ条件
1. `B.ROLES` が `['leader', 'escort', 'detach']`
2. `roleOf`: 隊長 → `leader`、展開隊 (`detach: true`) → `detach`、それ以外の護衛 → `escort`。隊長が `detach` を持っていても `leader`
3. `controller`: 展開隊は `detach` の脳で、護衛は `escort` の脳で判断する (2 つの脳を違う動きになるように作って、それぞれの艦隊の命令が対応する脳の動きになることで確かめる)
4. `randomBrainSet` は 3 つの役割の脳を作り、どれも長さ `paramCount()`、値は -scale〜scale
5. `toPlain` → JSON → `fromPlain` で 3 つとも元に戻る
6. 古い形 (`leader`・`escort` だけ) を `fromPlain` すると、`detach` は `escort` と同じ値で、別の配列 (書き換えても `escort` は変わらない)
7. 形が違えばエラー (長さ違い・`leader` か `escort` がない・`detach` の長さ違い)
8. `scripts/classic-evolve.js` の突然変異で `detach` の脳も変わる (rate 1 で 3 つともすべての重みが変わる)
9. 今の `classic/learned-brain.js` (古い形) が `fromPlain` で読める
10. 展開隊がいる試合でお手本を集めると、`detach` のお手本ができる (`scripts/classic-imitate.js` の集め方)

## テストのコマンド
`npm test` (終了コード 0 で合格)

## このあと (この変更には含めない)
- 第 475 世代の続きから学習する (時間は開発者と相談)。`classic-evaluate` で旧型 AI への勝率を測る
- DESIGN.md の更新とコミットは本体が行う
