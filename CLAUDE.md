# learning-quiz

読んだ本や学びたい分野をクイズで定着させるためのリポジトリ。Claude Code が AskUserQuestion で出題し、成績は GitHub Pages で見る。

## 使い方

- 「クイズして」→ `.claude/skills/quiz/`
- 「問題作って」→ `.claude/skills/make-quiz/`

## 構成

- `quizzes/<slug>.json` セッション（1冊の本や1つの分野の問題の束）、`quizzes/index.json` 一覧（`validate` が生成。手で編集しない）
- `results/log.jsonl` 回答記録（追記のみ。手で編集しない）
- `scripts/quiz.mjs` CLI（list / pick / record / validate）。判定と記録は必ずこれを通す
- `index.html` 成績ページ
- 仕様: `docs/superpowers/specs/2026-10-10-learning-quiz-design.md`

## テスト

`npm test`（依存なし。Node 標準のみ）

## git 運用

- **回答記録（`results/log.jsonl`）とセッション（`quizzes/`）の変更だけは、main に直接 commit・push してよい**。クイズのたびにブランチを切るのは重いため
- それ以外（`scripts/`、`index.html`、スキルなど）の変更は、通常どおり feature branch と worktree で行う
- public リポジトリ。個人情報・社内情報・本文の長い引用を書かない
