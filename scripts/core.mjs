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
