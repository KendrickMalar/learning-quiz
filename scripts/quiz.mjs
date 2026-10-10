#!/usr/bin/env node
// 使い方: node scripts/quiz.mjs <list|pick|record|validate> ...
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SLUG_RE, validateDeck, pickQuestions, countAvailable, judge } from './core.mjs';
import { parseLog, lastTouched, byLastTouched, dayKey } from './stats.mjs';

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

// 読めないときは理由の文字列を投げる
function readValidDeck(slug) {
  if (!SLUG_RE.test(slug ?? '')) throw new Error(`セッション名が不正です: ${slug ?? '（なし）'}`);
  if (!existsSync(join(QUIZ_DIR, `${slug}.json`))) throw new Error(`セッションが見つかりません: ${slug}（list で一覧を確認してください）`);
  let deck;
  try {
    deck = readDeckFile(slug);
  } catch (e) {
    throw new Error(`${slug}.json を読めません: ${e.message}`);
  }
  const errors = validateDeck(deck);
  if (errors.length) throw new Error(`${slug}.json の形式が不正です:\n  ${errors.join('\n  ')}`);
  return deck;
}

function loadDeck(slug) {
  try {
    return readValidDeck(slug);
  } catch (e) {
    fail(e.message);
  }
}

function readLog() {
  return existsSync(LOG_PATH) ? parseLog(readFileSync(LOG_PATH, 'utf8')) : [];
}

function list() {
  const slugs = deckSlugs();
  if (slugs.length === 0) return console.log('セッションがありません');
  const entries = readLog();
  const rows = [];
  for (const slug of slugs) {
    let deck;
    try {
      deck = readValidDeck(slug);
    } catch (e) {
      console.error(`（飛ばしました）${e.message}`);
      continue;
    }
    rows.push({ slug, deck, lastTouched: lastTouched({ ...deck, slug }, entries) });
  }
  for (const { slug, deck, lastTouched: touched } of rows.sort(byLastTouched)) {
    const last = touched ? dayKey(new Date(touched)) : '—';
    console.log(`${slug}\t${deck.title}\t復習 ${countAvailable(deck, slug, entries)} / 全 ${deck.questions.length} 問\t最終 ${last}`);
  }
}

function pick(slug, nArg) {
  const deck = loadDeck(slug);
  const n = nArg === undefined ? 5 : Number(nArg);
  if (!Number.isInteger(n) || n < 1) fail(`問題数は1以上の整数にしてください: ${nArg}`);
  const entries = readLog();
  const questions = pickQuestions(deck, slug, entries, { n });
  const due = countAvailable(deck, slug, entries);
  const result = { deck: slug, title: deck.title, questions };
  if (due < questions.length) {
    result.message = due === 0
      ? '復習の時期が来た問題はありません。時期前の問題を出します'
      : `復習の時期が来た問題は ${due} 問です。残りは時期前の問題を出します`;
  }
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
  // 手での編集やコンフリクト解決で末尾の改行が消えていても、行がくっつかないようにする
  const needsNewline = existsSync(LOG_PATH) && !/(^|\n)$/.test(readFileSync(LOG_PATH, 'utf8'));
  appendFileSync(LOG_PATH, (needsNewline ? '\n' : '') + JSON.stringify({ ts: new Date().toISOString(), deck: slug, id, correct: result.correct }) + '\n');
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
  console.log(`OK: ${index.length} セッション`);
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case 'list': list(); break;
  case 'pick': pick(args[0], args[1]); break;
  case 'record': record(args[0], args[1], args.slice(2)); break;
  case 'validate': validate(); break;
  default: fail('使い方: node scripts/quiz.mjs <list|pick|record|validate> ...');
}
