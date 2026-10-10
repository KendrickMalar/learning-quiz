import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLog, summarize, lastTouched } from './stats.mjs';

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

const NOW = new Date('2026-10-10T03:00:00.000Z');
const DECKS = [
  { slug: 'a', title: 'セットA', questions: [{ id: 'q1', question: '問1' }, { id: 'q2', question: '問2' }] },
  { slug: 'b', title: 'セットB', questions: [{ id: 'q1', question: 'B問1' }] },
];
const e = (deck, id, correct, ts = '2026-10-10T03:00:00.000Z') => ({ ts, deck, id, correct });

test('summarize: セッションごとの回答数と正答率を、最後に触った順に並べる', () => {
  const decks = [{ ...DECKS[1], updated: '2026-10-01' }, DECKS[0]];
  const { perDeck } = summarize(decks, [e('a', 'q1', true), e('a', 'q2', false), e('a', 'q1', true)], { now: NOW });
  assert.deepEqual(perDeck, [
    { slug: 'a', title: 'セットA', answered: 3, correct: 2, rate: 2 / 3, lastTouched: '2026-10-10T03:00:00.000Z' },
    { slug: 'b', title: 'セットB', answered: 0, correct: 0, rate: null, lastTouched: '2026-10-01T00:00:00.000Z' },
  ]);
});

test('lastTouched は最後に解いた日時と updated の新しいほうを返す', () => {
  const deck = { slug: 'a', updated: '2026-10-07', questions: [] };
  assert.equal(lastTouched(deck, [e('a', 'q1', true, '2026-10-05T03:00:00.000Z'), e('b', 'q1', true, '2026-10-09T03:00:00.000Z')]), '2026-10-07T00:00:00.000Z');
  assert.equal(lastTouched(deck, [e('a', 'q1', true, '2026-10-08T03:00:00.000Z')]), '2026-10-08T03:00:00.000Z');
  assert.equal(lastTouched({ slug: 'a', questions: [] }, []), null);
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
