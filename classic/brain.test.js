const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('./logic.js');
const B = require('./brain.js');

function fleet(over){
  return Object.assign({
    id: 'f', team: 'blue', name: 'f', x: 1200, y: 3000, ships: L.INITIAL_SHIPS, params: {speed: 34, defense: 33, attack: 33},
    order: null, isPlayer: false, ai: {nextThink: 0}, heading: 0, flagship: false, leader: false,
    missiles: L.MISSILE_AMMO, missileMode: 'guided', throttle: 4, weapons: {laser: true, torpid: true}
  }, over);
}
// 決まった値を順に返す乱数
function seq(...values){
  let i = 0;
  return () => values[i++ % values.length];
}
// 重みがすべて 0 で、出力の偏り (最後の OUTPUTS 個) だけを指定した脳
function biasBrain(bias){
  const w = new Float64Array(B.paramCount());
  bias.forEach((v, i) => { w[w.length - B.OUTPUTS + i] = v; });
  return w;
}

test('脳の形: 入力 50・中間 24・出力 7 (移動 x・y、攻撃しない、近い敵 3 つ、ミサイルの直進)。隊長用・護衛用・展開隊用の 3 つ', () => {
  assert.deepEqual([B.INPUTS, B.HIDDEN, B.OUTPUTS], [50, 24, 7]);
  assert.deepEqual(B.ROLES, ['leader', 'escort', 'detach']);
  assert.equal(B.paramCount(), 24 * 50 + 24 + 7 * 24 + 7);
  const f = fleet();
  assert.equal(B.observe(f, [f], {}).length, B.INPUTS);
});

test('入力: 赤は盤面を 180° 回して青と同じ見え方 (点対称の位置なら同じ入力)', () => {
  const b = fleet({id: 'b', x: 500, y: 4000, leader: true});
  const be = fleet({id: 'be', team: 'red', x: 700, y: 3600});
  const r = fleet({id: 'r', team: 'red', x: L.WORLD.w - 500, y: L.WORLD.h - 4000, leader: true});
  const re = fleet({id: 're', team: 'blue', x: L.WORLD.w - 700, y: L.WORLD.h - 3600});
  const inB = B.observe(b, [b, be], {be: {x: be.x, y: be.y, visible: true}});
  const inR = B.observe(r, [r, re], {re: {x: re.x, y: re.y, visible: true}});
  inB.forEach((v, i) => assert.ok(Math.abs(v - inR[i]) < 1e-9, String(i)));
});

test('入力: 見えている敵は近い順で、攻撃の相手の候補と同じ並び。見えていない敵の本当の位置は使わない', () => {
  const f = fleet();
  const far = fleet({id: 'far', team: 'red', x: 1200, y: 2000});
  const near = fleet({id: 'near', team: 'red', x: 1200, y: 2800});
  const hidden = fleet({id: 'hid', team: 'red', x: 1210, y: 2990});
  const intel = {far: {x: far.x, y: far.y, visible: true}, near: {x: near.x, y: near.y, visible: true}};
  assert.deepEqual(B.visibleTargets(f, intel).map(t => t.id), ['near', 'far']);
  const a = B.observe(f, [f, far, near, hidden], intel);
  const b = B.observe(f, [f, far, near], intel);
  assert.deepEqual(a, b, '見えていない敵は入力に入らない');
});

test('命令: 攻撃の点数がいちばん高い近い敵を攻撃する。攻撃しないなら移動 (チームから見た向き)。小さすぎる移動は止まる', () => {
  const f = fleet();
  const e0 = fleet({id: 'e0', team: 'red', x: 1200, y: 2800});
  const e1 = fleet({id: 'e1', team: 'red', x: 1200, y: 2600});
  const intel = {e0: {x: e0.x, y: e0.y, visible: true}, e1: {x: e1.x, y: e1.y, visible: true}};
  assert.deepEqual(B.decide(biasBrain([0, 0, 0, 0, 1, 0, 0]), f, [f, e0, e1], intel), {type: 'attack', targetId: 'e1'});
  const up = B.decide(biasBrain([0, -3, 1, 0, 0, 0, 0]), f, [f], {});
  assert.equal(up.type, 'move');
  assert.ok(up.y < f.y && Math.abs(up.x - f.x) < 1e-9, '青の上 (北) へ');
  const r = fleet({team: 'red', x: 1200, y: 1800});
  const down = B.decide(biasBrain([0, -3, 1, 0, 0, 0, 0]), r, [r], {});
  assert.ok(down.y > r.y, '赤は盤面を回すので下 (南) へ');
  assert.equal(B.decide(biasBrain([0, 0, 1, 0, 0, 0, 0]), f, [f], {}), null);
});

test('命令: ミサイルの出力が正なら直進、0 以下なら誘導にする', () => {
  const f = fleet();
  B.decide(biasBrain([0, 0, 1, 0, 0, 0, 1]), f, [f], {});
  assert.equal(f.missileMode, 'straight');
  B.decide(biasBrain([0, 0, 1, 0, 0, 0, -1]), f, [f], {});
  assert.equal(f.missileMode, 'guided');
});

test('controller: 隊長は隊長用の脳、護衛は護衛用の脳で考える', () => {
  const set = {leader: biasBrain([0, -3, 1, 0, 0, 0, 0]), escort: biasBrain([0, 3, 1, 0, 0, 0, 0]), detach: biasBrain([0, 3, 1, 0, 0, 0, 0])};
  const ctl = B.controller(set);
  const lead = fleet({id: 'l', leader: true}), esc = fleet({id: 'e'});
  const intel = {r1: {x: 0, y: 0, visible: false}}; // 手がかりがあるとき (ないときは旧型 AI で探す)
  assert.ok(ctl(lead, [lead, esc], intel, seq(0.5)).y < lead.y);
  assert.ok(ctl(esc, [lead, esc], intel, seq(0.5)).y > esc.y);
});

test('controller: 見えている敵も最終確認位置もないときは、旧型 AI の動き (索敵) で探す。手がかりがあれば脳で考える', () => {
  const set = {leader: biasBrain([0, -3, 1, 0, 0, 0, 0]), escort: biasBrain([0, 3, 1, 0, 0, 0, 0]), detach: biasBrain([0, 3, 1, 0, 0, 0, 0])};
  const ctl = B.controller(set);
  const lead = fleet({id: 'l', leader: true, x: 2400, y: 9000}), esc = fleet({id: 'e', x: 2000, y: 9000});
  const fleets = [lead, esc];
  assert.deepEqual(ctl(lead, fleets, {}, seq(0.5, 0.3)), L.aiDecide(lead, fleets, {}, seq(0.5, 0.3)), '隊長は旧型 AI の索敵');
  assert.deepEqual(ctl(esc, fleets, {}, seq(0.5)), L.aiDecide(esc, fleets, {}, seq(0.5)), '護衛は旧型 AI の隊列');
  const ghost = {r1: {x: 2400, y: 1000, visible: false}};
  assert.notDeepEqual(ctl(lead, fleets, ghost, seq(0.5, 0.3)), L.aiDecide(lead, fleets, ghost, seq(0.5, 0.3)), '最終確認位置があれば脳');
});

test('roleOf: 隊長は leader、展開隊は detach、それ以外は escort。隊長が detach を持っていても leader', () => {
  assert.equal(B.roleOf(fleet({leader: true})), 'leader');
  assert.equal(B.roleOf(fleet({detach: true})), 'detach');
  assert.equal(B.roleOf(fleet({})), 'escort');
  assert.equal(B.roleOf(fleet({leader: true, detach: true})), 'leader');
});

test('controller: 展開隊は展開隊用の脳、護衛は護衛用の脳で判断する (2 つを逆の動きにして確かめる)', () => {
  const set = {
    leader: biasBrain([0, 0, 1, 0, 0, 0, 0]),
    escort: biasBrain([0, -3, 1, 0, 0, 0, 0]), // 北へ
    detach: biasBrain([0, 3, 1, 0, 0, 0, 0])   // 南へ
  };
  const ctl = B.controller(set);
  const lead = fleet({id: 'l', leader: true}), esc = fleet({id: 'e'}), det = fleet({id: 'd', detach: true});
  const fleets = [lead, esc, det];
  const intel = {r1: {x: 0, y: 0, visible: false}};
  assert.ok(ctl(esc, fleets, intel, seq(0.5)).y < esc.y, '護衛は護衛用の脳 (北へ)');
  assert.ok(ctl(det, fleets, intel, seq(0.5)).y > det.y, '展開隊は展開隊用の脳 (南へ)');
});

test('controller: 展開隊も手がかりがなければ旧型 AI の動き', () => {
  const set = {leader: biasBrain([0, 0, 1, 0, 0, 0, 0]), escort: biasBrain([0, -3, 1, 0, 0, 0, 0]), detach: biasBrain([0, 3, 1, 0, 0, 0, 0])};
  const ctl = B.controller(set);
  // 展開隊の旧型 AI は判断のたびに行き来の向き (sweep) を切り替えるので、比べる側にはそれぞれ新しい艦隊を使う
  const det = fleet({id: 'd', detach: true, x: 2000, y: 9000}), same = fleet({id: 'd', detach: true, x: 2000, y: 9000});
  assert.deepEqual(ctl(det, [det], {}, seq(0.5, 0.3)), L.aiDecide(same, [same], {}, seq(0.5, 0.3)));
});

test('試合の中でも、展開隊の艦隊は展開隊用の脳で動く (試合を進めて、本物の展開隊が出たあとの命令を見る)', () => {
  const rng = seq(0.13, 0.57, 0.91, 0.29, 0.73);
  // 護衛は左右の一方へ、展開隊は逆へ動く脳 (上下だと赤は端に近く、移動先が端で止まって見分けにくい)
  const set = {leader: biasBrain([0, 0, 1, 0, 0, 0, 0]), escort: biasBrain([-3, 0, 1, 0, 0, 0, 0]), detach: biasBrain([3, 0, 1, 0, 0, 0, 0])};
  const base = B.controller(set), log = [];
  const ctl = (f, fleets, intel, r) => {
    const cmd = base(f, fleets, intel, r);
    if(cmd && cmd.type === 'move') log.push({detach: !!f.detach, leader: f.leader, dx: cmd.x - f.x});
    return cmd;
  };
  const g = L.createGame({speed: 34, defense: 33, attack: 33}, rng, 'flagship', {controllers: {red: ctl}});
  for(const f of g.fleets) f.isPlayer = false;
  const blue = g.fleets.find(f => f.team === 'blue');
  for(let i = 0; i < 60; i++){
    // 赤から遠い最終確認位置を置いて、手がかりがある (脳で考える) 状態にする
    if(!g.intel.red[blue.id]) g.intel.red[blue.id] = {x: L.WORLD.w / 2, y: L.WORLD.h / 2, visible: false};
    L.step(g, 0.1, rng);
  }
  assert.ok(g.fleets.some(f => f.team === 'red' && f.detach), '展開隊が出ている');
  const dets = log.filter(e => e.detach), escs = log.filter(e => !e.detach && !e.leader);
  assert.ok(dets.length > 0 && escs.length > 0, '展開隊と護衛の両方が脳で考えた');
  const sign = Math.sign(dets[0].dx);
  assert.notEqual(sign, 0);
  assert.ok(dets.every(e => Math.sign(e.dx) === sign), '展開隊はすべて展開隊用の脳の向き');
  assert.ok(escs.every(e => Math.sign(e.dx) === -sign), '護衛はすべて護衛用の脳の向き (逆)');
});

test('randomBrainSet: 3 つの役割の脳を作り、どれも長さ paramCount()、値は -scale〜scale', () => {
  const set = B.randomBrainSet(seq(0.1, 0.9, 0.5, 0.0, 1.0), 0.5);
  assert.deepEqual(Object.keys(set).sort(), ['detach', 'escort', 'leader']);
  for(const r of ['leader', 'escort', 'detach']){
    assert.equal(set[r].length, B.paramCount(), r);
    assert.ok(Array.from(set[r]).every(v => v >= -0.5 && v <= 0.5), r);
  }
});

test('保存: toPlain は 3 つのキーを持ち、JSON を通して fromPlain で 3 つとも元に戻る', () => {
  const set = B.randomBrainSet(seq(0.1, 0.9, 0.5, 0.3, 0.7), 0.5);
  const plain = B.toPlain(set);
  assert.deepEqual(Object.keys(plain).sort(), ['detach', 'escort', 'leader']);
  const back = B.fromPlain(JSON.parse(JSON.stringify(plain)));
  for(const r of ['leader', 'escort', 'detach']) assert.deepEqual(Array.from(back[r]), Array.from(set[r]), r);
});

test('fromPlain: 古い形 (leader と escort だけ) なら detach は escort の写し (別の配列)', () => {
  const n = B.paramCount();
  const old = {leader: Array.from({length: n}, (_, i) => i * 0.001), escort: Array.from({length: n}, (_, i) => -i * 0.002)};
  const set = B.fromPlain(old);
  assert.deepEqual(Array.from(set.detach), Array.from(set.escort));
  assert.notEqual(set.detach, set.escort);
  set.detach[0] = 99;
  assert.notEqual(set.escort[0], 99, 'detach を変えても escort は変わらない');
  set.escort[1] = 77;
  assert.notEqual(set.detach[1], 77, 'escort を変えても detach は変わらない');
  assert.deepEqual(Array.from(set.leader), old.leader);
});

test('fromPlain: 形が違えばエラー (長さ違い・leader か escort がない・detach の長さ違い)', () => {
  const n = B.paramCount();
  const ok = () => new Array(n).fill(0);
  assert.doesNotThrow(() => B.fromPlain({leader: ok(), escort: ok(), detach: ok()}));
  assert.throws(() => B.fromPlain({leader: [1, 2], escort: []}));
  assert.throws(() => B.fromPlain({leader: ok(), escort: new Array(n - 1).fill(0)}));
  assert.throws(() => B.fromPlain({escort: ok()}));
  assert.throws(() => B.fromPlain({leader: ok()}));
  assert.throws(() => B.fromPlain({escort: ok(), detach: ok()}));
  assert.throws(() => B.fromPlain({leader: ok(), escort: ok(), detach: new Array(n + 1).fill(0)}));
  assert.throws(() => B.fromPlain({leader: ok(), escort: ok(), detach: []}));
});

test('learned-brain.js (今の古い形でも新しい形でも) を fromPlain で読める', () => {
  const lb = require('./learned-brain.js');
  const set = B.fromPlain(lb.brains);
  for(const r of B.ROLES) assert.equal(set[r].length, B.paramCount(), r);
  if(!lb.brains.detach) assert.deepEqual(Array.from(set.detach), Array.from(set.escort));
});

test('試合に入れても最後まで進む (学習型 AI 対 旧型 AI)', () => {
  const rng = seq(0.13, 0.57, 0.91, 0.29, 0.73);
  const g = L.createGame({speed: 34, defense: 33, attack: 33}, rng, 'flagship', {controllers: {red: B.controller(B.randomBrainSet(rng, 0.5))}});
  for(const f of g.fleets) f.isPlayer = false;
  for(let i = 0; i < 30 * 300 && !g.outcome; i++) L.step(g, 1 / 30, rng);
  assert.ok(g.time > 0);
});
