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
