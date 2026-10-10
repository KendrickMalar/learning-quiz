---
name: quiz
description: 「クイズして」「クイズ出して」「復習したい」「〇〇の問題解きたい」と言われたときに、セッション（1冊の本や1つの分野の問題の束）を選んでもらい、AskUserQuestion で出題し、回答を記録して push する。
---

# クイズを出す

正誤の判定と記録は必ず `scripts/quiz.mjs` に任せる。自分で採点しない。

## 手順

0. 最新の記録を取り込む: `git pull --rebase`（失敗したら理由を伝え、そのまま出題を続ける）
1. セッションを決める
   - 名前が指定されていれば、`node scripts/quiz.mjs list` の結果から該当するものを選ぶ（あいまいなら AskUserQuestion で確認）
   - 指定がなければ `list` を実行し、AskUserQuestion で選んでもらう
     - `list` は最後に触った順に並んでいる。上から4つを選択肢にする（`label` はタイトル、`description` は「復習 X 問・最終 YYYY-MM-DD」）
     - 5つ以上あるときは、問題文に「ほかのセッションは『その他』に名前を入力してください」と添える
   - セッションが1つもなければ、「この本の問題作って」で作れることを伝えて終わる
2. `node scripts/quiz.mjs pick <slug> [問題数]` を実行する。問題数の指定がなければ 5
   - `message` があれば最初に伝える（復習の時期が来た問題が足りず、時期前の問題を出すとき）
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
   - push が拒否されたら `git pull --rebase && git push` を1回だけ試す。それでも失敗したら、その旨と理由を伝える（commit は残す）
6. 途中で「やめる」と言われたら、そこまでの記録を手順5と同じく commit・push する
