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
