# Issue #3 実装タスク

## Spec Kit成果物

- [x] T001 `clarify.md`を作成し、GitHub側とAWS側の責務境界を確定する
- [x] T002 `plan.md`を作成し、CDK、設定検証、Secret、検証境界を定める
- [x] T003 `tasks.md`を作成し、実装・テスト・文書化を分解する
- [x] T004 `analyze.md`を作成し、要件とタスクの対応を確認する

## 設定契約

- [x] T005 `config/github-app.example.json`を作成する
- [x] T006 `scripts/github-app/validate-config.mjs`を作成する
- [x] T007 設定の必須項目、Private設定、最小権限、イベント許可を検証する

## AWS CDK

- [x] T008 GitHub App連携Constructを作成する
- [x] T009 FoundationStackへConstructを組み込む
- [x] T010 Webhook Secretと非機密CfnOutputを定義する
- [x] T011 Secret実値がsynth出力へ含まれないことを検証する

## テストと品質ゲート

- [x] T012 設定検証の正常系・異常系テストを追加する
- [x] T013 CDK SecretとOutputの構成テストを追加する
- [x] T014 公開設定・生成テンプレート・ログへのSecret混入検査を追加する
- [x] T015 `github-app:check`をpackage.jsonへ追加する
- [x] T016 `foundation:check`の必須ファイルと品質スクリプト検査を更新する
- [x] T017 `corepack pnpm quality`を実行し、失敗を修正する

## 文書

- [x] T018 GitHub App作成とOrganizationインストール手順を記載する
- [x] T019 AWS CDK実行、Secret確認、Webhook URL登録手順を記載する
- [x] T020 更新、失敗時復旧、Secretローテーション、撤去の責務を記載する
- [x] T021 Issue #4とIssue #5が利用する設定・Secret ARN契約を記載する
