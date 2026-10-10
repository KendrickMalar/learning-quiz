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
