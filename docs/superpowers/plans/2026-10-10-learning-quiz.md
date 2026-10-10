# learning-quiz 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude Code が AskUserQuestion で出題し、回答を記録し、GitHub Pages で成績を見られるクイズリポジトリを作る。

**Architecture:** 判定・出題選びは純粋関数（`scripts/core.mjs`）、集計は Node とブラウザで共用する `scripts/stats.mjs`、ファイル入出力は CLI（`scripts/quiz.mjs`）だけが持つ。出題の手順は Claude Code スキルに書き、成績ページはビルド不要の `index.html` 1枚。

**Tech Stack:** Node 26（標準ライブラリのみ・依存なし）、`node:test`、素の HTML/CSS/ES モジュール、GitHub Pages。

**Spec:** `docs/superpowers/specs/2026-10-10-learning-quiz-design.md`

## Global Constraints

- 外部依存なし（npm パッケージを入れない）。Node 標準と素のブラウザ API のみ
- 作業ディレクトリ: `~/Documents/Github/learning-quiz`。ブランチ `feat/initial-setup` 上で作業する（グローバル規約に従い、実行時に worktree を作る）
- 選択肢は2〜4個、重複なし、1つ40文字以内。`answer` は 0 始まりの添字。`explanation` 必須
- セット名（slug）は `^[a-z0-9]+(?:-[a-z0-9]+)*$`
- 記録の `ts` は UTC の ISO 8601（`new Date().toISOString()`）
- 期限: `最終回答日時 + 2^(連続正解数-1) 日`。出題順は 要復習 → 期限切れ → 未回答。待機中は出さない
- `pick` の出力に正解の位置・解説を含めない
- コミットメッセージに AI 帰属トレーラー（`Co-Authored-By` 等）を付けない
- 文言は日本語

## Review Focus

1. AskUserQuestion の「その他」で自由入力された文字列 → 不正解として記録し、落ちない（Task 1・2 のテスト）
2. `results/log.jsonl` に空行・壊れた行（git のコンフリクト跡など）がある、またはファイルがない → 読み飛ばして続行（Task 1・2 のテスト）
3. 存在しないセット名、`../x` のような不正なセット名、存在しない問題 ID → 理由を表示して終了コード1（Task 2 のテスト）
4. 空白を含む選択肢がシェルで複数の引数に分かれる → 結合して正しく判定（Task 2 のテスト）
5. 問題を削除した後も記録に古い ID が残る → 出題・成績ページが落ちず、苦手一覧にも出ない（Task 1・3 のテスト）

---

## ファイル構成

| パス | 責務 | 作るタスク |
|---|---|---|
| `package.json` | `npm test` のみ | 1 |
| `.gitignore` | `node_modules/`、`.DS_Store` | 1 |
| `scripts/stats.mjs` | `parseLog`・`summarize`（fs を使わない） | 1（parseLog）、3（summarize） |
| `scripts/core.mjs` | `validateDeck`・`questionStatus`・`pickQuestions`・`countAvailable`・`judge` | 1 |
| `scripts/core.test.mjs` | core のテスト | 1 |
| `scripts/stats.test.mjs` | stats のテスト | 1、3 |
| `scripts/quiz.mjs` | CLI（list / pick / record / validate） | 2 |
| `scripts/quiz.test.mjs` | CLI の結合テスト | 2 |
| `quizzes/english-pos.json`、`quizzes/index.json` | サンプル問題セットと一覧 | 2 |
| `index.html`、`.nojekyll` | 成績ページ | 3 |
| `.claude/skills/quiz/SKILL.md`、`.claude/skills/make-quiz/SKILL.md` | 出題・作問の手順 | 4 |
| `CLAUDE.md`、`README.md` | リポジトリ説明と git 運用の例外 | 4 |

---

### Task 1: 判定・出題選びのコアと記録の読み込み

**Files:**
- Create: `package.json`, `.gitignore`, `scripts/core.mjs`, `scripts/stats.mjs`, `scripts/core.test.mjs`, `scripts/stats.test.mjs`

**Interfaces:**
- Produces（`scripts/core.mjs`）:
  - `SLUG_RE: RegExp`
  - `MAX_CHOICE_LENGTH: number`（= 40）
  - `validateDeck(deck: unknown): string[]` — エラー文の配列。空なら正しい
  - `questionStatus(history: Entry[], now: Date): 'new'|'review'|'due'|'waiting'`
  - `pickQuestions(deck, slug: string, entries: Entry[], opts?: { n=5, now=new Date(), rng=Math.random }): { id, question, choices: string[] }[]`
  - `countAvailable(deck, slug, entries, now=new Date()): number`
  - `judge(deck, id: string, choiceText: string): { correct: boolean, answer: string, explanation: string }` — 未知の id は `Error` を投げる
- Produces（`scripts/stats.mjs`）: `parseLog(text: string): Entry[]`
- `Entry = { ts: string, deck: string, id: string, correct: boolean }`

- [ ] **Step 1: 雛形を作る**

`package.json`:
```json
{
  "name": "learning-quiz",
  "private": true,
  "scripts": {
    "test": "node --test \"scripts/*.test.mjs\""
  }
}
```

`.gitignore`:
```
node_modules/
.DS_Store
```

- [ ] **Step 2: 失敗するテストを書く**

`scripts/stats.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLog } from './stats.mjs';

test('parseLog は空行・壊れた行・欠けた項目を読み飛ばす', () => {
  const text = [
    '{"ts":"2026-10-10T03:00:00.000Z","deck":"a","id":"q1","correct":true}',
    '',
    '<<<<<<< HEAD',
    '{"ts":"not-a-date","deck":"a","id":"q1","correct":true}',
    '{"ts":"2026-10-10T03:00:00.000Z","deck":"a","id":"q2"}',
    '{"ts":"2026-10-10T04:00:00.000Z","deck":"a","id":"q2","correct":false}',
  ].join('\n');
  assert.deepEqual(parseLog(text).map((e) => e.id), ['q1', 'q2']);
});

test('parseLog は空文字で空配列を返す', () => {
  assert.deepEqual(parseLog(''), []);
});
```

`scripts/core.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDeck, questionStatus, pickQuestions, countAvailable, judge } from './core.mjs';

const NOW = new Date('2026-10-10T03:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (msAgo) => new Date(NOW.getTime() - msAgo).toISOString();
const entry = (id, msAgo, correct, deck = 'd') => ({ ts: at(msAgo), deck, id, correct });

const question = (id, extra = {}) => ({
  id, question: `${id} の問題`, choices: ['あ', 'い', 'う'], answer: 1, explanation: '解説', ...extra,
});
const deckOf = (...questions) => ({ title: 'テスト', questions });

test('validateDeck は正しいセットでエラーなし', () => {
  assert.deepEqual(validateDeck(deckOf(question('q1'))), []);
});

test('validateDeck は不正な形式を弾く', () => {
  const cases = [
    [{ questions: [question('q1')] }, 'title'],
    [deckOf(), 'questions'],
    [deckOf(question('q1'), question('q1')), '重複'],
    [deckOf(question('q1', { choices: ['あ'] })), '2〜4'],
    [deckOf(question('q1', { choices: ['あ', 'い', 'う', 'え', 'お'] })), '2〜4'],
    [deckOf(question('q1', { choices: ['あ', 'あ'] , answer: 0 })), '選択肢が重複'],
    [deckOf(question('q1', { answer: 3 })), 'answer'],
    [deckOf(question('q1', { answer: 1.5 })), 'answer'],
    [deckOf(question('q1', { explanation: '' })), 'explanation'],
    [deckOf(question('q1', { choices: ['あ', 'x'.repeat(41)] })), '40文字'],
  ];
  for (const [deck, keyword] of cases) {
    const errors = validateDeck(deck);
    assert.ok(errors.some((e) => e.includes(keyword)), `${keyword} を含むエラーが出ること: ${JSON.stringify(errors)}`);
  }
});

test('questionStatus: 未回答は new', () => {
  assert.equal(questionStatus([], NOW), 'new');
});

test('questionStatus: 直近が不正解なら review', () => {
  assert.equal(questionStatus([entry('q', 2 * DAY, true), entry('q', HOUR, false)], NOW), 'review');
});

test('questionStatus: 連続正解1回は1日後に due', () => {
  assert.equal(questionStatus([entry('q', 23 * HOUR, true)], NOW), 'waiting');
  assert.equal(questionStatus([entry('q', 25 * HOUR, true)], NOW), 'due');
});

test('questionStatus: 連続正解2回は2日後に due', () => {
  assert.equal(questionStatus([entry('q', 5 * DAY, true), entry('q', 1.5 * DAY, true)], NOW), 'waiting');
  assert.equal(questionStatus([entry('q', 5 * DAY, true), entry('q', 2.5 * DAY, true)], NOW), 'due');
});

test('questionStatus: 不正解のあとの正解は連続1回として数える', () => {
  assert.equal(questionStatus([entry('q', 10 * DAY, false), entry('q', 12 * HOUR, true)], NOW), 'waiting');
});

test('questionStatus: 記録の並び順に依存しない', () => {
  assert.equal(questionStatus([entry('q', HOUR, false), entry('q', 2 * DAY, true)], NOW), 'review');
});

test('pickQuestions は 要復習 → 期限切れ → 未回答 の順で、待機中を出さない', () => {
  const deck = deckOf(question('new'), question('due'), question('review'), question('wait'));
  const entries = [entry('review', HOUR, false), entry('due', 2 * DAY, true), entry('wait', HOUR, true)];
  const picked = pickQuestions(deck, 'd', entries, { now: NOW, rng: () => 0 });
  assert.deepEqual(picked.map((q) => q.id), ['review', 'due', 'new']);
});

test('pickQuestions は n 問までに絞る', () => {
  const deck = deckOf(question('a'), question('b'), question('c'));
  assert.equal(pickQuestions(deck, 'd', [], { n: 2, now: NOW }).length, 2);
});

test('pickQuestions は他のセットの記録を混ぜない', () => {
  const deck = deckOf(question('q1'));
  const picked = pickQuestions(deck, 'd', [entry('q1', HOUR, true, 'other')], { now: NOW });
  assert.deepEqual(picked.map((q) => q.id), ['q1']);
});

test('pickQuestions は正解の位置と解説を含めず、選択肢は同じ集合', () => {
  const [q] = pickQuestions(deckOf(question('q1')), 'd', [], { now: NOW, rng: () => 0 });
  assert.deepEqual(Object.keys(q).sort(), ['choices', 'id', 'question']);
  assert.deepEqual([...q.choices].sort(), ['あ', 'い', 'う']);
});

test('pickQuestions は削除済みの問題の記録があっても動く', () => {
  const picked = pickQuestions(deckOf(question('q1')), 'd', [entry('gone', HOUR, false)], { now: NOW });
  assert.deepEqual(picked.map((q) => q.id), ['q1']);
});

test('countAvailable は待機中以外を数える', () => {
  const deck = deckOf(question('a'), question('b'));
  assert.equal(countAvailable(deck, 'd', [entry('a', HOUR, true)], NOW), 1);
});

test('judge は選択肢の文字列で判定し、正解と解説を返す', () => {
  const deck = deckOf(question('q1'));
  assert.deepEqual(judge(deck, 'q1', 'い'), { correct: true, answer: 'い', explanation: '解説' });
  assert.equal(judge(deck, 'q1', ' い ').correct, true);
  assert.equal(judge(deck, 'q1', 'あ').correct, false);
});

test('judge は自由入力を不正解にする', () => {
  assert.equal(judge(deckOf(question('q1')), 'q1', 'わからない').correct, false);
});

test('judge は未知の id でエラー', () => {
  assert.throws(() => judge(deckOf(question('q1')), 'q9', 'い'), /q9/);
});
```

- [ ] **Step 3: 失敗を確認する**

Run: `npm test`
Expected: FAIL（`Cannot find module './core.mjs'` / `'./stats.mjs'`）

- [ ] **Step 4: 実装する**

`scripts/stats.mjs`:
```js
// 記録の読み込みと集計。fs を使わないので、成績ページ（ブラウザ）からも import できる。

export function parseLog(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const e = JSON.parse(line);
      const valid = typeof e.deck === 'string' && typeof e.id === 'string'
        && typeof e.correct === 'boolean' && !Number.isNaN(Date.parse(e.ts));
      if (valid) entries.push(e);
    } catch {
      // 壊れた行（コンフリクト跡など）は読み飛ばす
    }
  }
  return entries;
}
```

`scripts/core.mjs`:
```js
// 問題セットの検査・出題選び・正誤判定。ファイル入出力は持たない。

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_CHOICE_LENGTH = 40;

const DAY_MS = 24 * 60 * 60 * 1000;
const PRIORITY = ['review', 'due', 'new'];
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

export function validateDeck(deck) {
  if (!deck || typeof deck !== 'object') return ['問題セットがオブジェクトではありません'];
  const errors = [];
  if (!nonEmpty(deck.title)) errors.push('title がありません');
  if (!Array.isArray(deck.questions) || deck.questions.length === 0) {
    errors.push('questions が空です');
    return errors;
  }
  const seen = new Set();
  deck.questions.forEach((q, i) => {
    const at = `questions[${i}]`;
    if (!nonEmpty(q?.id)) errors.push(`${at}: id がありません`);
    else if (seen.has(q.id)) errors.push(`${at}: id "${q.id}" が重複しています`);
    else seen.add(q.id);
    if (!nonEmpty(q?.question)) errors.push(`${at}: question がありません`);
    if (!nonEmpty(q?.explanation)) errors.push(`${at}: explanation がありません`);
    const choices = q?.choices;
    if (!Array.isArray(choices) || choices.length < 2 || choices.length > 4) {
      errors.push(`${at}: choices は2〜4個にしてください`);
      return;
    }
    if (!choices.every(nonEmpty)) errors.push(`${at}: 空の選択肢があります`);
    if (new Set(choices).size !== choices.length) errors.push(`${at}: 選択肢が重複しています`);
    if (choices.some((c) => typeof c === 'string' && c.length > MAX_CHOICE_LENGTH)) {
      errors.push(`${at}: 選択肢は${MAX_CHOICE_LENGTH}文字以内にしてください`);
    }
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= choices.length) {
      errors.push(`${at}: answer が選択肢の範囲外です`);
    }
  });
  return errors;
}

// history は1問ぶんの記録（順不同）
export function questionStatus(history, now) {
  if (history.length === 0) return 'new';
  const sorted = [...history].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const last = sorted[sorted.length - 1];
  if (!last.correct) return 'review';
  let streak = 0;
  for (let i = sorted.length - 1; i >= 0 && sorted[i].correct; i--) streak++;
  const dueAt = Date.parse(last.ts) + 2 ** (streak - 1) * DAY_MS;
  return now.getTime() >= dueAt ? 'due' : 'waiting';
}

function shuffle(items, rng) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function groupByStatus(deck, slug, entries, now) {
  const groups = { review: [], due: [], new: [], waiting: [] };
  for (const q of deck.questions) {
    const history = entries.filter((e) => e.deck === slug && e.id === q.id);
    groups[questionStatus(history, now)].push(q);
  }
  return groups;
}

export function pickQuestions(deck, slug, entries, { n = 5, now = new Date(), rng = Math.random } = {}) {
  const groups = groupByStatus(deck, slug, entries, now);
  return PRIORITY.flatMap((k) => shuffle(groups[k], rng))
    .slice(0, n)
    .map((q) => ({ id: q.id, question: q.question, choices: shuffle(q.choices, rng) }));
}

export function countAvailable(deck, slug, entries, now = new Date()) {
  const groups = groupByStatus(deck, slug, entries, now);
  return PRIORITY.reduce((sum, k) => sum + groups[k].length, 0);
}

export function judge(deck, id, choiceText) {
  const q = deck.questions.find((x) => x.id === id);
  if (!q) throw new Error(`問題 "${id}" が見つかりません`);
  const answer = q.choices[q.answer];
  return { correct: choiceText.trim() === answer.trim(), answer, explanation: q.explanation };
}
```

- [ ] **Step 5: 通ることを確認する**

Run: `npm test`
Expected: PASS（全テスト）

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore scripts/
git commit -m "feat: 出題選び・判定のコアと記録の読み込みを追加"
```

---

### Task 2: CLI とサンプル問題セット

**Files:**
- Create: `scripts/quiz.mjs`, `scripts/quiz.test.mjs`, `quizzes/english-pos.json`, `quizzes/index.json`（`validate` が生成）

**Interfaces:**
- Consumes: Task 1 の `SLUG_RE`・`validateDeck`・`pickQuestions`・`countAvailable`・`judge`・`parseLog`
- Produces（スキルが使う CLI）:
  - `node scripts/quiz.mjs list` → 1行1セット `slug<TAB>title<TAB>出題可能 X / 全 Y 問`
  - `node scripts/quiz.mjs pick <slug> [n]` → `{ deck, title, questions: [{id, question, choices}], message? }`
  - `node scripts/quiz.mjs record <slug> <id> <選択肢...>` → `{ correct, answer, explanation }`、`results/log.jsonl` に1行追記
  - `node scripts/quiz.mjs validate` → `OK: N セット`、`quizzes/index.json` を `[{slug, title, count}]` で書く
  - 環境変数 `QUIZ_ROOT` でリポジトリのルートを差し替えられる（テスト用）

- [ ] **Step 1: 失敗するテストを書く**

`scripts/quiz.test.mjs`:
```js
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

test('全問が待機中なら pick は空配列と理由を返す', () => {
  const root = setup();
  run(root, 'record', 'sample', 'q1', '副詞');
  run(root, 'record', 'sample', 'q2', 'phrasal verb');
  const out = JSON.parse(run(root, 'pick', 'sample').stdout);
  assert.deepEqual(out.questions, []);
  assert.match(out.message, /ありません/);
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

test('list はセットと出題可能数を表示する', () => {
  const root = setup();
  run(root, 'record', 'sample', 'q1', '副詞');
  const res = run(root, 'list');
  assert.match(res.stdout, /sample\tテスト\t出題可能 1 \/ 全 2 問/);
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
```

- [ ] **Step 2: 失敗を確認する**

Run: `npm test`
Expected: FAIL（`quiz.mjs` がないため spawn の status が 1 で、各テストが落ちる）

- [ ] **Step 3: 実装する**

`scripts/quiz.mjs`:
```js
#!/usr/bin/env node
// 使い方: node scripts/quiz.mjs <list|pick|record|validate> ...
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SLUG_RE, validateDeck, pickQuestions, countAvailable, judge } from './core.mjs';
import { parseLog } from './stats.mjs';

const ROOT = process.env.QUIZ_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const QUIZ_DIR = join(ROOT, 'quizzes');
const LOG_PATH = join(ROOT, 'results', 'log.jsonl');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function deckSlugs() {
  if (!existsSync(QUIZ_DIR)) return [];
  return readdirSync(QUIZ_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}

function readDeckFile(slug) {
  return JSON.parse(readFileSync(join(QUIZ_DIR, `${slug}.json`), 'utf8'));
}

function loadDeck(slug) {
  if (!SLUG_RE.test(slug ?? '')) fail(`セット名が不正です: ${slug ?? '（なし）'}`);
  if (!existsSync(join(QUIZ_DIR, `${slug}.json`))) fail(`問題セットが見つかりません: ${slug}（list で一覧を確認してください）`);
  let deck;
  try {
    deck = readDeckFile(slug);
  } catch (e) {
    fail(`${slug}.json を読めません: ${e.message}`);
  }
  const errors = validateDeck(deck);
  if (errors.length) fail(`${slug}.json の形式が不正です:\n  ${errors.join('\n  ')}`);
  return deck;
}

function readLog() {
  return existsSync(LOG_PATH) ? parseLog(readFileSync(LOG_PATH, 'utf8')) : [];
}

function list() {
  const slugs = deckSlugs();
  if (slugs.length === 0) return console.log('問題セットがありません');
  const entries = readLog();
  for (const slug of slugs) {
    const deck = loadDeck(slug);
    console.log(`${slug}\t${deck.title}\t出題可能 ${countAvailable(deck, slug, entries)} / 全 ${deck.questions.length} 問`);
  }
}

function pick(slug, nArg) {
  const deck = loadDeck(slug);
  const n = nArg === undefined ? 5 : Number(nArg);
  if (!Number.isInteger(n) || n < 1) fail(`問題数は1以上の整数にしてください: ${nArg}`);
  const questions = pickQuestions(deck, slug, readLog(), { n });
  const result = { deck: slug, title: deck.title, questions };
  if (questions.length === 0) result.message = '今日出せる問題はありません（すべて復習待ち）';
  console.log(JSON.stringify(result, null, 2));
}

function record(slug, id, choiceParts) {
  const deck = loadDeck(slug);
  if (!id || choiceParts.length === 0) fail('使い方: record <slug> <id> <選んだ選択肢>');
  let result;
  try {
    result = judge(deck, id, choiceParts.join(' '));
  } catch (e) {
    fail(e.message);
  }
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  appendFileSync(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), deck: slug, id, correct: result.correct }) + '\n');
  console.log(JSON.stringify(result));
}

function validate() {
  let ok = true;
  const index = [];
  for (const slug of deckSlugs()) {
    if (!SLUG_RE.test(slug)) {
      console.error(`${slug}.json: ファイル名は英小文字・数字・ハイフンにしてください`);
      ok = false;
      continue;
    }
    let deck;
    try {
      deck = readDeckFile(slug);
    } catch (e) {
      console.error(`${slug}.json: JSON として読めません: ${e.message}`);
      ok = false;
      continue;
    }
    const errors = validateDeck(deck);
    if (errors.length) {
      console.error(`${slug}.json:\n  ${errors.join('\n  ')}`);
      ok = false;
      continue;
    }
    index.push({ slug, title: deck.title, count: deck.questions.length });
  }
  if (!ok) process.exit(1);
  writeFileSync(join(QUIZ_DIR, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  console.log(`OK: ${index.length} セット`);
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case 'list': list(); break;
  case 'pick': pick(args[0], args[1]); break;
  case 'record': record(args[0], args[1], args.slice(2)); break;
  case 'validate': validate(); break;
  default: fail('使い方: node scripts/quiz.mjs <list|pick|record|validate> ...');
}
```

- [ ] **Step 4: 通ることを確認する**

Run: `npm test`
Expected: PASS（全テスト）

- [ ] **Step 5: サンプル問題セットを作り、検査する**

`quizzes/english-pos.json`:
```json
{
  "title": "英語の品詞",
  "source": "自作（基本的な英文法）",
  "questions": [
    { "id": "q001", "question": "\"quickly\" の品詞は？", "choices": ["名詞", "動詞", "形容詞", "副詞"], "answer": 3, "explanation": "動詞を修飾する -ly の語なので副詞。" },
    { "id": "q002", "question": "\"happiness\" の品詞は？", "choices": ["名詞", "動詞", "形容詞", "副詞"], "answer": 0, "explanation": "-ness は形容詞を名詞にする接尾辞。" },
    { "id": "q003", "question": "\"beautiful\" の品詞は？", "choices": ["名詞", "動詞", "形容詞", "副詞"], "answer": 2, "explanation": "-ful は名詞を形容詞にする接尾辞。" },
    { "id": "q004", "question": "\"decide\" の品詞は？", "choices": ["名詞", "動詞", "形容詞", "副詞"], "answer": 1, "explanation": "名詞形は decision、形容詞形は decisive。" },
    { "id": "q005", "question": "\"friendly\" の品詞は？", "choices": ["名詞", "動詞", "形容詞", "副詞"], "answer": 2, "explanation": "-ly だが名詞 friend に付いた形容詞。副詞と間違えやすい。" }
  ]
}
```

Run: `node scripts/quiz.mjs validate && node scripts/quiz.mjs list && node scripts/quiz.mjs pick english-pos 2`
Expected: `OK: 1 セット`、`english-pos	英語の品詞	出題可能 5 / 全 5 問`、2問ぶんの JSON。`quizzes/index.json` ができている。`results/log.jsonl` はまだない。

- [ ] **Step 6: Commit**

```bash
git add scripts/quiz.mjs scripts/quiz.test.mjs quizzes/
git commit -m "feat: クイズ CLI とサンプル問題セットを追加"
```

---

### Task 3: 成績の集計と成績ページ

**Files:**
- Modify: `scripts/stats.mjs`（`summarize` を追加）, `scripts/stats.test.mjs`
- Create: `index.html`, `.nojekyll`（空ファイル）

**Interfaces:**
- Consumes: Task 1 の `parseLog`、Task 2 が作る `quizzes/index.json`（`[{slug, title, count}]`）
- Produces: `summarize(decks: {slug, title, questions}[], entries: Entry[], opts?: { days=14, now=new Date() }): { perDeck: {slug, title, answered, correct, rate: number|null}[], daily: {date: 'YYYY-MM-DD', answered, correct}[], weak: {slug, title, id, question, wrong, total}[] }`

- [ ] **Step 1: 失敗するテストを書く**

`scripts/stats.test.mjs` の先頭の import を差し替え、末尾にテストを追記する。
```js
import { parseLog, summarize } from './stats.mjs';
```
```js
const NOW = new Date('2026-10-10T03:00:00.000Z');
const DECKS = [
  { slug: 'a', title: 'セットA', questions: [{ id: 'q1', question: '問1' }, { id: 'q2', question: '問2' }] },
  { slug: 'b', title: 'セットB', questions: [{ id: 'q1', question: 'B問1' }] },
];
const e = (deck, id, correct, ts = '2026-10-10T03:00:00.000Z') => ({ ts, deck, id, correct });

test('summarize: セットごとの回答数と正答率', () => {
  const { perDeck } = summarize(DECKS, [e('a', 'q1', true), e('a', 'q2', false), e('a', 'q1', true)], { now: NOW });
  assert.deepEqual(perDeck, [
    { slug: 'a', title: 'セットA', answered: 3, correct: 2, rate: 2 / 3 },
    { slug: 'b', title: 'セットB', answered: 0, correct: 0, rate: null },
  ]);
});

test('summarize: 日ごとの集計は直近 days 日を古い順に並べる', () => {
  const entries = [e('a', 'q1', true), e('a', 'q1', false, '2026-10-09T03:00:00.000Z'), e('a', 'q1', true, '2026-09-01T03:00:00.000Z')];
  const { daily } = summarize(DECKS, entries, { now: NOW, days: 3 });
  assert.deepEqual(daily, [
    { date: '2026-10-08', answered: 0, correct: 0 },
    { date: '2026-10-09', answered: 1, correct: 0 },
    { date: '2026-10-10', answered: 1, correct: 1 },
  ]);
});

test('summarize: 間違いの多い問題を多い順に返し、削除済みの問題と全問正解の問題を除く', () => {
  const entries = [
    e('a', 'q1', false), e('a', 'q1', false), e('a', 'q2', false), e('a', 'q2', true),
    e('b', 'q1', true), e('a', 'gone', false), e('a', 'gone', false), e('a', 'gone', false),
  ];
  const { weak } = summarize(DECKS, entries, { now: NOW });
  assert.deepEqual(weak.map((w) => [w.slug, w.id, w.wrong, w.total]), [['a', 'q1', 2, 2], ['a', 'q2', 1, 2]]);
  assert.equal(weak[0].question, '問1');
  assert.equal(weak[0].title, 'セットA');
});

test('summarize: 間違いの多い問題は最大10件', () => {
  const questions = Array.from({ length: 12 }, (_, i) => ({ id: `q${i}`, question: `問${i}` }));
  const entries = questions.map((q) => e('c', q.id, false));
  const { weak } = summarize([{ slug: 'c', title: 'C', questions }], entries, { now: NOW });
  assert.equal(weak.length, 10);
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `npm test`
Expected: FAIL（`summarize` が export されていない）

- [ ] **Step 3: `summarize` を実装する**

`scripts/stats.mjs` の末尾に追記する。
```js
function dayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// decks: [{ slug, title, questions }]。日付は実行環境の時刻帯で区切る。
export function summarize(decks, entries, { days = 14, now = new Date() } = {}) {
  const perDeck = decks.map((deck) => {
    const mine = entries.filter((e) => e.deck === deck.slug);
    const correct = mine.filter((e) => e.correct).length;
    return { slug: deck.slug, title: deck.title, answered: mine.length, correct, rate: mine.length ? correct / mine.length : null };
  });

  const daily = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    daily.push({ date: dayKey(d), answered: 0, correct: 0 });
  }
  const byDate = new Map(daily.map((row) => [row.date, row]));
  for (const e of entries) {
    const row = byDate.get(dayKey(new Date(e.ts)));
    if (!row) continue;
    row.answered++;
    if (e.correct) row.correct++;
  }

  const known = new Map();
  for (const deck of decks) {
    for (const q of deck.questions) known.set(`${deck.slug}/${q.id}`, { slug: deck.slug, title: deck.title, id: q.id, question: q.question });
  }
  const tally = new Map();
  for (const e of entries) {
    const key = `${e.deck}/${e.id}`;
    if (!known.has(key)) continue; // 削除された問題は数えない
    const t = tally.get(key) ?? { ...known.get(key), wrong: 0, total: 0 };
    t.total++;
    if (!e.correct) t.wrong++;
    tally.set(key, t);
  }
  const weak = [...tally.values()]
    .filter((t) => t.wrong > 0)
    .sort((a, b) => b.wrong - a.wrong || b.wrong / b.total - a.wrong / a.total)
    .slice(0, 10);

  return { perDeck, daily, weak };
}
```

- [ ] **Step 4: 通ることを確認する**

Run: `npm test`
Expected: PASS（全テスト）

- [ ] **Step 5: 成績ページを作る**

`.nojekyll` を空ファイルで作る（`touch .nojekyll`）。

`index.html`:
```html
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>学習クイズの成績</title>
<style>
  :root { --bg: #fafaf7; --fg: #1d1d1b; --muted: #6b6b66; --line: #e3e2dc; --bar: #3a7d5c; --bar-bg: #e8efe9; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #151514; --fg: #ecebe6; --muted: #9a9993; --line: #2c2c2a; --bar: #5fb38a; --bar-bg: #23302a; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 system-ui, -apple-system, "Hiragino Sans", sans-serif; }
  main { max-width: 640px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: 1.4rem; margin: 0 0 4px; }
  h2 { font-size: 1.05rem; margin: 32px 0 8px; }
  .note, .empty, .sub { color: var(--muted); }
  .note { font-size: .85rem; margin: 0; }
  .sub { font-size: .8rem; }
  .row { padding: 10px 0; border-bottom: 1px solid var(--line); }
  .row-head { display: flex; justify-content: space-between; gap: 12px; }
  .row-head span:first-child { overflow-wrap: anywhere; }
  .row-head span:last-child { color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .bar { height: 6px; background: var(--bar-bg); border-radius: 3px; margin-top: 6px; overflow: hidden; }
  .bar > div { height: 100%; background: var(--bar); }
</style>
</head>
<body>
<main>
  <h1>学習クイズの成績</h1>
  <p class="note" id="summary">読み込み中…</p>
  <h2>セット別</h2>
  <div id="decks"></div>
  <h2>直近14日</h2>
  <div id="daily"></div>
  <h2>間違いの多い問題</h2>
  <div id="weak"></div>
</main>
<script type="module">
  import { parseLog, summarize } from './scripts/stats.mjs';

  async function fetchText(path) {
    const res = await fetch(path, { cache: 'no-store' });
    return res.ok ? res.text() : null;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function row(label, value, ratio, sub) {
    const r = el('div', 'row');
    const head = el('div', 'row-head');
    head.append(el('span', '', label), el('span', '', value));
    r.append(head);
    if (sub) r.append(el('div', 'sub', sub));
    if (ratio !== null) {
      const bar = el('div', 'bar');
      const fill = el('div');
      fill.style.width = `${Math.round(ratio * 100)}%`;
      bar.append(fill);
      r.append(bar);
    }
    return r;
  }

  const pct = (correct, answered) => (answered ? `${Math.round((correct / answered) * 100)}%` : '—');

  function fill(id, rows, emptyText) {
    const box = document.getElementById(id);
    box.replaceChildren(...(rows.length ? rows : [el('p', 'empty', emptyText)]));
  }

  async function main() {
    const index = JSON.parse((await fetchText('quizzes/index.json')) ?? '[]');
    const decks = [];
    for (const item of index) {
      const text = await fetchText(`quizzes/${item.slug}.json`);
      if (text) decks.push({ ...JSON.parse(text), slug: item.slug });
    }
    const entries = parseLog((await fetchText('results/log.jsonl')) ?? '');
    const { perDeck, daily, weak } = summarize(decks, entries);

    document.getElementById('summary').textContent = `${decks.length} セット・回答 ${entries.length} 件`;
    fill('decks', perDeck.map((d) =>
      row(d.title, `${pct(d.correct, d.answered)}（${d.correct}/${d.answered}）`, d.answered ? d.rate : null)), 'まだ問題セットがありません');
    const max = Math.max(1, ...daily.map((d) => d.answered));
    fill('daily', daily.slice().reverse().map((d) =>
      row(d.date, d.answered ? `${d.answered}問・正答率 ${pct(d.correct, d.answered)}` : '0問', d.answered / max)), '');
    fill('weak', weak.map((w) => row(w.question, `${w.wrong}/${w.total} 回ミス`, null, w.title)), 'まだ間違えた問題はありません');
  }

  main().catch((e) => {
    document.getElementById('summary').textContent = `読み込みに失敗しました: ${e.message}`;
  });
</script>
</body>
</html>
```

- [ ] **Step 6: ブラウザで表示を確認する**

一時的な記録を作ってローカル配信する（記録は確認後に消す）。
```bash
node scripts/quiz.mjs record english-pos q001 副詞
node scripts/quiz.mjs record english-pos q005 副詞
python3 -m http.server 8765
```
`http://localhost:8765/` を開き（ブラウザ確認はサブエージェントに依頼する）、次を確認する。
- 「1 セット・回答 2 件」、セット別に「英語の品詞 50%（1/2）」
- 直近14日の今日の行が「2問・正答率 50%」
- 間違いの多い問題に「"friendly" の品詞は？」
- 幅 375px で横スクロールが出ない。コンソールにエラーがない

確認後: サーバーを止め、`rm results/log.jsonl && rmdir results`。

- [ ] **Step 7: Commit**

```bash
git add scripts/stats.mjs scripts/stats.test.mjs index.html .nojekyll
git commit -m "feat: 成績の集計と成績ページを追加"
```

---

### Task 4: スキルとリポジトリ説明

**Files:**
- Create: `.claude/skills/quiz/SKILL.md`, `.claude/skills/make-quiz/SKILL.md`, `CLAUDE.md`, `README.md`

**Interfaces:**
- Consumes: Task 2 の CLI（`list` / `pick` / `record` / `validate`）

- [ ] **Step 1: 出題スキルを書く**

`.claude/skills/quiz/SKILL.md`:
````markdown
---
name: quiz
description: 「クイズして」「クイズ出して」「復習したい」と言われたときに、問題セットから AskUserQuestion で出題し、回答を記録して push する。
---

# クイズを出す

正誤の判定と記録は必ず `scripts/quiz.mjs` に任せる。自分で採点しない。

## 手順

1. セットを決める
   - 指定がなければ `node scripts/quiz.mjs list` を実行し、AskUserQuestion でセットを選んでもらう（選択肢は4つまで。多ければ出題可能数の多い順に4つ）
2. `node scripts/quiz.mjs pick <slug> [問題数]` を実行する。問題数の指定がなければ 5
   - `questions` が空なら `message` を伝えて終わる
3. 1問ずつ AskUserQuestion で出題する
   - `question` は問題文そのまま、`header` は `Q1/5` の形
   - 選択肢の `label` は `choices` の文字列をそのまま、`pick` の順番のまま並べる。「（Recommended）」などは付けない。`description` は空にせず「選択肢 A」のように位置だけ書く
   - 正解をにおわせる言葉を問題文に足さない
4. 回答ごとに記録する
   - `node scripts/quiz.mjs record <slug> <id> '<選んだ label または自由入力の文字列>'`（シングルクォート内の `'` は `'\''` にする）
   - 結果を1〜2行で伝える: 正解なら「⭕ 正解」、不正解なら「❌ 正解は〇〇」＋ `explanation`
5. 全問終わったら「N問中M問正解」を伝え、記録を push する
   ```bash
   git add results/log.jsonl
   git commit -m "quiz: <slug> N問中M問正解"
   git push
   ```
   - push に失敗したら、その旨と理由を伝える（commit は残す）
6. 途中で「やめる」と言われたら、そこまでの記録を手順5と同じく commit・push する
````

- [ ] **Step 2: 作問スキルを書く**

`.claude/skills/make-quiz/SKILL.md`:
````markdown
---
name: make-quiz
description: 「この本の問題作って」「クイズ作って」「問題を追加して」と言われたときに、本の要点・メモ・単語リストから問題セットの JSON を作り、検査して push する。
---

# 問題セットを作る

## 手順

1. 材料を受け取る（本の要点、メモ、単語リストなど）。足りなければ AskUserQuestion で聞く
2. 新しいセットか、既存セットへの追加かを決める
   - 新規: slug（英小文字・数字・ハイフン）とタイトルを決め、`quizzes/<slug>.json` を作る
   - 追加: 既存ファイルの末尾に足す。ID は既存の最大番号から連番で続ける。既存の ID は変えない・再利用しない
3. 問題を書く（形式は下記）
4. `node scripts/quiz.mjs validate` を通す。エラーが出たら直して再実行
5. 作った問題の一覧（問題文と正解）を見せる
6. commit・push する
   ```bash
   git add quizzes/
   git commit -m "quiz: <slug> に N問追加"
   git push
   ```

## 形式

```json
{
  "title": "セットのタイトル",
  "source": "出典（書名・著者など）",
  "questions": [
    { "id": "q001", "question": "問題文", "choices": ["選択肢1", "選択肢2", "選択肢3", "選択肢4"], "answer": 0, "explanation": "なぜその答えか（1〜2文）" }
  ]
}
```

- `choices` は2〜4個、重複なし、1つ40文字以内。`answer` は正解の 0 始まりの位置
- 正解の位置は問題ごとにばらす（出題時にもシャッフルされるが、ファイル上も偏らせない）

## 良い問題の条件

- 1問で1つの要点を問う。細部の暗記ではなく、使える理解を問う
- 誤答の選択肢は、ありがちな勘違いにする。明らかに違うものは入れない
- 「すべて正しい」「どれでもない」は使わない
- 解説には、なぜ正解か、なぜ間違えやすいかを書く

## 注意

このリポジトリは public。本文を長く引用せず、要点を自分の言葉で問う。個人情報や社内情報を書かない。
````

- [ ] **Step 3: CLAUDE.md と README.md を書く**

`CLAUDE.md`:
```markdown
# learning-quiz

読んだ本や英語の品詞などをクイズで定着させるためのリポジトリ。Claude Code が AskUserQuestion で出題し、成績は GitHub Pages で見る。

## 使い方

- 「クイズして」→ `.claude/skills/quiz/`
- 「問題作って」→ `.claude/skills/make-quiz/`

## 構成

- `quizzes/<slug>.json` 問題セット、`quizzes/index.json` 一覧（`validate` が生成。手で編集しない）
- `results/log.jsonl` 回答記録（追記のみ。手で編集しない）
- `scripts/quiz.mjs` CLI（list / pick / record / validate）。判定と記録は必ずこれを通す
- `index.html` 成績ページ
- 仕様: `docs/superpowers/specs/2026-10-10-learning-quiz-design.md`

## テスト

`npm test`（依存なし。Node 標準のみ）

## git 運用

- **回答記録（`results/log.jsonl`）と問題セット（`quizzes/`）の変更だけは、main に直接 commit・push してよい**。クイズのたびにブランチを切るのは重いため
- それ以外（`scripts/`、`index.html`、スキルなど）の変更は、通常どおり feature branch と worktree で行う
- public リポジトリ。個人情報・社内情報・本文の長い引用を書かない
```

`README.md`:
```markdown
# learning-quiz

読んだ本や英語の品詞などを、クイズで繰り返し解いて定着させるためのリポジトリです。

- 出題: Claude Code で「クイズして」
- 作問: Claude Code で「この本の問題作って」
- 成績: GitHub Pages のトップページ

間違えた問題と、期限が来た問題（正解が続くほど 1日→2日→4日… と間隔が延びる）を優先して出します。

## 開発

    npm test
```

- [ ] **Step 4: スキルの通し確認**

このリポジトリで Claude Code を起動し「クイズして」で english-pos を2問解く。AskUserQuestion で出題され、`record` が呼ばれ、`results/log.jsonl` に2行増えることを確認する。push は Task 5 前なので失敗してよい（失敗を伝えることを確認する）。確認後、確認用の commit を `git reset --hard HEAD~1` で取り消す（記録の commit だけであることを `git show --stat HEAD` で確かめてから）。

- [ ] **Step 5: Commit**

```bash
git add .claude/ CLAUDE.md README.md
git commit -m "feat: 出題・作問スキルとリポジトリ説明を追加"
```

---

### Task 5: main へのマージと GitHub Pages 公開（要ユーザー確認）

外部に公開する操作なので、実行前に対象アカウントと公開範囲をユーザーに確認する。

- [ ] **Step 1: 全テストを通す**

Run: `npm test`
Expected: PASS

- [ ] **Step 2: main にマージする**（main worktree で実行）

```bash
git switch main
git merge --no-ff feat/initial-setup -m "Merge branch 'feat/initial-setup'"
git branch -d feat/initial-setup
```

- [ ] **Step 3: public リポジトリを作って push する**（`<owner>` はユーザーに確認したもの）

```bash
gh repo create <owner>/learning-quiz --public --source . --push
```

- [ ] **Step 4: GitHub Pages を main のルートで有効化する**

```bash
gh api -X POST repos/<owner>/learning-quiz/pages -f 'source[branch]=main' -f 'source[path]=/'
gh api repos/<owner>/learning-quiz/pages --jq .html_url
```
Expected: `https://<owner>.github.io/learning-quiz/` が返る。数分後に開き、Task 3 Step 6 と同じ表示（回答0件の状態）になることを確認する（ブラウザ確認はサブエージェントに依頼する）。
