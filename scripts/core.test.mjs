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
