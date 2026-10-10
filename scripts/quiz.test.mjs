import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('./quiz.mjs', import.meta.url));
const SAMPLE = {
  title: 'テスト',
  questions: [
    { id: 'q1', question: 'quickly の品詞は？', choices: ['名詞', '副詞'], answer: 1, explanation: '-ly で副詞。' },
    { id: 'q2', question: 'give up は何？', choices: ['名詞', 'phrasal verb', '形容詞'], answer: 1, explanation: '句動詞。' },
  ],
};

function setup(decks = { sample: SAMPLE }) {
  const root = mkdtempSync(join(tmpdir(), 'quiz-'));
  mkdirSync(join(root, 'quizzes'));
  for (const [slug, deck] of Object.entries(decks)) {
    writeFileSync(join(root, 'quizzes', `${slug}.json`), JSON.stringify(deck));
  }
  return root;
}
const run = (root, ...args) =>
  spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, QUIZ_ROOT: root }, encoding: 'utf8' });
const logLines = (root) => readFileSync(join(root, 'results', 'log.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);

test('pick は問題を返し、正解の位置を含めない', () => {
  const root = setup();
  const res = run(root, 'pick', 'sample', '1');
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.deck, 'sample');
  assert.equal(out.questions.length, 1);
  assert.ok(!('answer' in out.questions[0]));
});

test('record は正誤を判定して記録に追記する', () => {
  const root = setup();
  assert.equal(JSON.parse(run(root, 'record', 'sample', 'q1', '副詞').stdout).correct, true);
  const wrong = JSON.parse(run(root, 'record', 'sample', 'q1', '名詞').stdout);
  assert.deepEqual(wrong, { correct: false, answer: '副詞', explanation: '-ly で副詞。' });
  assert.deepEqual(logLines(root).map((e) => [e.deck, e.id, e.correct]), [['sample', 'q1', true], ['sample', 'q1', false]]);
  assert.ok(!Number.isNaN(Date.parse(logLines(root)[0].ts)));
});

test('record は空白で分かれた引数を結合して判定する', () => {
  const root = setup();
  assert.equal(JSON.parse(run(root, 'record', 'sample', 'q2', 'phrasal', 'verb').stdout).correct, true);
});

test('record は自由入力を不正解として記録する', () => {
  const root = setup();
  assert.equal(JSON.parse(run(root, 'record', 'sample', 'q1', 'わからない').stdout).correct, false);
  assert.equal(logLines(root).length, 1);
});

test('全問が時期前でも pick は問題を返し、その旨を伝える', () => {
  const root = setup();
  run(root, 'record', 'sample', 'q1', '副詞');
  run(root, 'record', 'sample', 'q2', 'phrasal verb');
  const out = JSON.parse(run(root, 'pick', 'sample').stdout);
  assert.equal(out.questions.length, 2);
  assert.match(out.message, /時期前/);
});

test('壊れた行があっても pick と list は動く', () => {
  const root = setup();
  mkdirSync(join(root, 'results'));
  writeFileSync(join(root, 'results', 'log.jsonl'), '<<<<<<< HEAD\n\n{"broken"\n');
  assert.equal(run(root, 'pick', 'sample').status, 0);
  assert.equal(run(root, 'list').status, 0);
});

test('不正なセット名・存在しないセット・存在しない問題は終了コード1', () => {
  const root = setup();
  for (const args of [['pick', '../x'], ['pick', 'nothing'], ['record', 'sample', 'q9', '副詞'], ['record', 'sample'], ['pick', 'sample', '0']]) {
    const res = run(root, ...args);
    assert.equal(res.status, 1, args.join(' '));
    assert.ok(res.stderr.length > 0, args.join(' '));
  }
  assert.ok(!existsSync(join(root, 'results', 'log.jsonl')));
});

test('list はセッションと復習数と最終日を表示する', () => {
  const root = setup({ sample: { ...SAMPLE, updated: '2026-10-01' } });
  const res = run(root, 'list');
  assert.match(res.stdout, /^sample\tテスト\t復習 2 \/ 全 2 問\t最終 2026-10-01$/m);
});

test('list は最後に触った順に並べ、触っていないものは最後にする', () => {
  const root = setup({
    old: { ...SAMPLE, title: '古い', updated: '2026-01-01' },
    fresh: { ...SAMPLE, title: '新しい', updated: '2026-09-01' },
    none: { ...SAMPLE, title: 'なし' },
  });
  run(root, 'record', 'old', 'q1', '副詞');
  const order = run(root, 'list').stdout.trim().split('\n').map((l) => l.split('\t')[0]);
  assert.deepEqual(order, ['old', 'fresh', 'none']);
});

test('validate は index.json を書く', () => {
  const root = setup();
  const res = run(root, 'validate');
  assert.equal(res.status, 0, res.stderr);
  const index = JSON.parse(readFileSync(join(root, 'quizzes', 'index.json'), 'utf8'));
  assert.deepEqual(index, [{ slug: 'sample', title: 'テスト', count: 2 }]);
});

test('validate は不正なセットがあれば終了コード1で index.json を書かない', () => {
  const root = setup({ sample: SAMPLE, bad: { title: 'x', questions: [] } });
  const res = run(root, 'validate');
  assert.equal(res.status, 1);
  assert.match(res.stderr, /bad\.json/);
  assert.ok(!existsSync(join(root, 'quizzes', 'index.json')));
});

test('record は末尾に改行のない記録にも行を分けて追記する', () => {
  const root = setup();
  mkdirSync(join(root, 'results'));
  writeFileSync(join(root, 'results', 'log.jsonl'), '{"ts":"2026-10-10T03:00:00.000Z","deck":"sample","id":"q1","correct":true}');
  run(root, 'record', 'sample', 'q2', '名詞');
  assert.deepEqual(logLines(root).map((e) => e.id), ['q1', 'q2']);
});

test('list は壊れたセットを警告して飛ばし、ほかのセットを表示する', () => {
  const root = setup();
  writeFileSync(join(root, 'quizzes', 'broken.json'), '{ not json');
  writeFileSync(join(root, 'quizzes', 'My.json'), JSON.stringify(SAMPLE));
  const res = run(root, 'list');
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /^sample\t/m);
  assert.match(res.stderr, /broken/);
  assert.match(res.stderr, /My/);
});
