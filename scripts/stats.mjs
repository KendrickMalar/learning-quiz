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
