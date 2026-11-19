# handover による再起動の表示

- 日付: 2026-11-20
- 状態: 承認済み（2026-11-20）
- 対象: `mods/eva-agents/sync.js`、`mods/eva-agents/main.js`、`mods/eva-launch/main.js`、README.md、RECIPE.md、tests/

## 目的

hbss-handover の handover を経た `/clear`（以下「再起動」）を、Claude Code のエージェントカードで数えて見せる。再起動した瞬間には、作戦開始と同じ全画面のカードで「再起動」と知らせる。

現状の `圧縮 nn` は transcript（= sessionId）ごとに compaction を数えるので、`/clear` のたびに 00 に戻り、handover で作業を続けていることが読めない。

## 調べて分かったこと（2026-11-20 実測）

- autoloop（`claude-handover-autoloop.sh`）は claude を再起動しない。同じプロセスへ `/clear` と再開の一言を送るだけ。pid と Herdr のターミナルはそのままで、`~/.claude/sessions/<pid>.json` の `sessionId` だけが変わる（`startedAt` はプロセスの起動時刻のまま）。
- `/clear` で始まった transcript の冒頭は次のとおり（直近 20 日の 83 件で確認）。
  - 素の `/clear`（18 件）: `[HANDOVER RESUME]` の注入がない。
  - handover + 手で打った `/clear`（11 件）: `type: "attachment"`、`attachment.type: "hook_additional_context"`、`attachment.hookEvent: "SessionStart"` の行があり、`attachment.content`（文字列の配列）の要素が `[HANDOVER RESUME]` で始まる。冒頭 6 行目付近。
  - handover + autoloop（54 件）: 上と同じ行に加え、`[HANDOVER AUTOLOOP]` で始まる user プロンプト。
- transcript にもセッションファイルにも、前のセッションへのリンクはない。回数は mod が sessionId の切り替わりを見て数えるしかない。

## 決めたこと（ユーザーの選択）

- 数えるのは handover 経由の `/clear` だけ。自動（autoloop）か手動かは問わない。素の `/clear` は数えない。
- 数はプロセス単位（pid + `startedAt`）。claude を起動し直すと 00 から。
- 再起動のカードは handover 再開すべてで出す（autoloop の再開キックは環境変数で書き換えられ、記録上も手入力のプロンプトと区別できないので使わない）。
- カードの `圧縮 nn` を `再起動 nn` に置き換える。compaction は数えなくなる。

## やらないこと

- compaction の計数（全体 grep・増分スキャン・失敗の記憶）。表示しなくなるので、コード・テスト・文書から外す。
- autoloop の自動再開と手動再開の区別。
- Herdr の UI が閉じていた間の再起動を全部数えること（下の「数え方」のとおり、閉じていた間に何回あっても最大 1 回）。
- hbss-handover プラグインの変更。

## 数え方（`sync.js`）

- キーは `<pid>:<startedAt>`（`startedAt` が無ければ `<pid>`）。値は `{ sessionId, since, restarts }`。`since` はその sessionId を初めて見た時刻（ms）。
- 1 回のポーリングで、セッションファイルの sessionId を記録と比べる。
  - 記録が無い: `{ sessionId, since: now, restarts: 0 }` を記録する（数えない）。
  - 同じ: 何もしない。
  - 違う: 新しい transcript の冒頭（`head -n 30`）を行ごとに JSON として読み、上の `[HANDOVER RESUME]` 行の `timestamp` を探す。見つかり、かつ記録の `since` より後なら `restarts + 1`。どちらでも sessionId と `since: now` を更新する。
  - `since` より後という条件は、`/resume` で handover から始まった古いセッションに戻ったときに数えないため。
  - 冒頭に `[HANDOVER RESUME]` の行も `type: "user"` の行もない（ファイルがまだ無い場合を含む）ときは、書き込み途中とみなす。記録を変えず、次のポーリングでやり直す。実測（65 件）では、印の行は必ず最初の user 行より前にあり、素の `/clear` の 18 件にはすべて user 行があった。一方、ファイルは印の行の時刻より最大 2.6 秒早く作られることがあり、この確認がないと取りこぼす。
- grep ではなく行を JSON として読んで判定する。この文字列はツール出力の中にも現れるため（compaction の `compact_boundary` と同じ注意）。
- 記録は localStorage（`restarts`）に保存し、Herdr を再起動しても残す。閉じていた間に sessionId が変わっていれば、上の規則で 1 回だけ数える。
- 同じポーリングが mod のコピーの数だけ並行して走る（module レベルの map は共有）。同じ切り替わりを二重に数えないよう、確認中のキーと sessionId の組を同期的に印して、他の走りはそれを飛ばす。
- 生きているターミナルに無く、`since` から 30 日を過ぎた記録は削除する（起動直後はターミナル一覧が空のことがあるので、日数でも絞る）。
- カードに渡すのは `sessionStats(address)` → `{ restarts, bytes }`（旧 `transcriptStats`、`compacts` を外す）。`bytes` は `stat` だけで取る。

## 表示

- カードの 9px の並びは `再起動 nn`（2 桁ゼロ埋め）と `記録 489M`。
- 再起動カード（`eva-launch`）: `props.restart` が真なら、作戦開始の文字を `再起動`、`OPERATION START` を `RESTART` にする。帯・罫・時間・閉じ方は作戦開始と同じ。
- `eva-agents` の `announce()` は、エージェントごとに前回見た `restarts` を覚え、増えたら再起動カードを開く。初めて見たエージェントには作戦開始（従来どおり）を出し、再起動は出さない。サブエージェント・MOTION OFF・読み込み後 3 秒以内は、作戦開始と同じく出さない。
- sessionId の変化はポーリング（15 秒）でしか分からないので、再起動カードは再開から最大 15 秒ほど遅れて出る。

## 文書

- README.md:3・25・67・70、RECIPE.md:28・45・60・92・129〜131・182 の圧縮・作戦開始の記述を合わせる。compaction の注意（129〜131）は、transcript を全体 grep しないこと・exec の timeout・module レベルの map の共有のうち、残る内容だけにする。

## 検証

- vitest:
  - `handoverResumedAt(text)`: 該当行の timestamp を返す。素の `/clear`、ツール出力の中の文字列、壊れた行、別のフックの additionalContext では null。
  - 数え方: 初回は 0、同じ sessionId は変わらず、handover の切り替わりで +1、素の切り替わりは +0、`since` より前の再開（`/resume`）は +0、印も user 行もない冒頭では記録を変えない（ファイルが無い場合を含む）、並行する 2 回のポーリングで二重に数えない、localStorage から復元する。
  - compaction のテスト（`tests/transcript.test.js`、`tests/sync.test.js` の `countCompacts`）を外す。
- `bun run test` の全体が通ること。
- 実機確認: handover → `/clear` で、カードが `再起動 01` になり、再起動カードが出る。素の `/clear` では数も変わらずカードも出ない。Herdr を再起動しても数が残る。
