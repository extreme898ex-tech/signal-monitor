# 常時監視キット（GitHub Actions版）

お使いの回線からは外部へデータを取りに行けないため、**GitHubのサーバー側でデータ取得→シグナル計算→メール/LINE通知**まで行う仕組みです。あなたのパソコンの電源は不要・ブラウザからのデータ取得も不要です。

## できること
- 全39銘柄（日本株・米国株・FX・原油・金・仮想通貨）をサーバーが自動取得（Yahoo→Stooq→CoinGeckoの3経路）
- 新しい売買シグナルを検出すると**メール（Web3Forms）とLINEへ自動送信**
- シグナル一覧ページ（GitHub Pages）をスマホ・PCのどちらからでも閲覧可

## セットアップ（約10分・一度だけ）
1. GitHubアカウントを作成（無料）: https://github.com/signup
2. 右上の「+」→「New repository」→ 名前を `signal-monitor` などにして **Public** で作成
   （公開リポジトリならActionsの無料枠で運用できます。非公開でも可）
3. このzipの中身をすべてアップロード（リポジトリの「Add file」→「Upload files」→ zipを展開したフォルダ内のファイルと`.github`フォルダをドラッグ →「Commit changes」）
4. 通知の鍵を登録: リポジトリの「Settings」→「Secrets and variables」→「Actions」→「New repository secret」
   - `WEB3FORMS_ACCESS_KEY`（メール通知する場合）: アプリの「メール/LINE」設定で使っているのと同じWeb3Formsのアクセスキー
   - `NOTIFY_EMAIL_TO`（任意）: 送信先メールアドレス（未設定ならWeb3Formsキー主の宛先）
   - `LINE_TOKEN` と `LINE_USER_ID`（LINE通知する場合のみ）: LINE Developers (https://developers.line.biz/) でチャネル作成→「チャネルアクセストークン」発行、ユーザーIDは自分の_botトークをwebhookで確認（または既にお使いのMessaging APIの値）
5. 「Actions」タブ → 左の「signal-monitor」→「Run workflow」ボタンで手動実行してテスト（緑チェックが付けば成功）
6. 一覧ページの公開: 「Settings」→「Pages」→ Branch「main」→ Save。数分後に
   `https://＜あなたのID＞.github.io/signal-monitor/` がシグナル一覧ページになります

## 更新の間隔
既定では**毎時5分**に実行します（UTCの cron: '5 * * * *'）。
`.github/workflows/monitor.yml` の cron を `*/30 * * * *` にすると30分ごと、
`30 6,21 * * 1-5` にすると「日本時間の15:30と30分後の21:30（米国引け後）」などに変更できます。

## うまくいかないとき
- Actionsの実行が赤×: 実行ログ（Actions → 該当run → run-monitor）に失敗原因が出ます
- 通知が来ない: Secretsの名前（WEB3FORMS_ACCESS_KEY など）の打ち間違いが最も多いです
- 取得成功が0件: YahooとStooqが同時に混雑した場合です。次回の自動実行で回収します（通知は「新規シグナルがあるときだけ」来ます）

## 改良版(2026-09-24)の取得方式
- 6経路(直接続+中継5系統)を**同時に**試して最速の成功を採用する「レース方式」に変更(旧版は1経路ずつ順番に試していた)。
- Yahooはquery1/query2の2ホストを自動切替。CoinGeckoは回数制限対策で呼び出し間隔1.2秒。
- 失敗銘柄は20秒・40秒空けて**最大2回の再試行**パスを回す(旧版は1回)。
- 実行ログに取得元の内訳(via: yahoo=… 等)を出すので、Actionsのログで失敗原因を追いやすい。
