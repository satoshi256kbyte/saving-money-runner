# Issue #1 開発基盤と品質ゲート

## 背景

Saving Money Runnerは、AWS CDKによる顧客AWSアカウントへの構築と、PNPMによる
開発・検証スクリプトを前提とする。後続のAWS実装を同じ手順で検証できるよう、
最初に再現可能な開発基盤と品質ゲートを整備する。

## 目的

開発者がクリーンな環境から依存関係を復元し、ローカルテスト、AWS CDK synth、
Ministackの設定検証、CI品質ゲートを同じ入口から実行できる状態にする。

## 機能要件

### FR-001 依存関係の再現

プロジェクトはNode.jsとPNPMのバージョンを宣言し、lockfileから依存関係を再現できる。

### FR-002 品質ゲートの統一

format、lint、typecheck、test、AWS CDK synth、Ministack設定検証を個別および一括で実行できる。

### FR-003 テスト実行

Node.js標準テストランナーで、リポジトリの必須設定と品質ゲートの契約を検証できる。

### FR-004 AWS CDK基盤

AWS CDK v2のTypeScriptアプリを用意し、AWS認証やContext lookupなしでsynthを実行できる。

### FR-005 CI実行

GitHub Actionsのクリーンランナーで依存関係を復元し、品質ゲートを実行できる。

## 非機能要件

- AWS認証情報やSecretをローカル設定・CIログ・リポジトリへ保存しない
- 品質ゲートの失敗は終了コードへ反映する
- 新しい開発者がREADMEだけでローカル検証を開始できる
- 後続Issueの実装を妨げない最小構成にする

## 受け入れ条件

- `corepack pnpm install --frozen-lockfile`で依存関係を復元できる
- `corepack pnpm quality`で一括品質ゲートを実行できる
- Node.jsテストがクリーン環境で成功する
- `corepack pnpm cdk:synth`でAWS CDKアプリを合成できる
- AWS CDK synthがAWS認証情報なしで成功する
- MinistackのCompose定義を検証できる
- GitHub Actionsに同じ品質ゲートを定義する
- 失敗時の復旧方法をREADMEへ記載する

## 対象外

AWSリソース、GitHub App、Webhook、ランナー、IAMポリシーの本実装は後続Issueで扱う。
Ministackを使ったAWS機能の結合テストもIssue #8で拡張する。
