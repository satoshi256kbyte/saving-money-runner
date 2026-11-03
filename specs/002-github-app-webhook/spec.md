# GitHub AppとWebhook登録の基盤

## 背景

Saving Money Runnerは、顧客Organizationだけで利用できるPrivate GitHub Appと、Webhook連携に必要なAWS側のSecret管理を提供する。
AWS側の構成はAWS CDKで管理する。GitHub Appの作成とOrganizationへのインストールは、GitHub管理者の認証が必要なため、AWS CDKと同じ責務として扱わない。

## 目的

顧客Organization限定のGitHub App導入に必要な設定契約と、Webhook Secretを安全に管理するAWS CDK基盤を整備する。
後続のWebhook受信実装が参照できるSecret ARNと設定契約を確定する。

## スコープ

### 対象

- GitHub AppのOrganization限定、Private運用、最小権限の設定契約
- Webhook SecretのAWS Secrets Manager管理
- AWS CDKによるSecretと設定値の再現可能な構築
- GitHub App登録、インストール、Webhook登録を行う運用手順と責務境界
- Secret値をCDKコード、synth結果、ログへ出さない検査

### 対象外

- WebhookのHTTP受信、HMAC検証、リプレイ対策
- Lambda、API Gatewayによるイベント処理
- GitHub Actionsランナーの登録と起動
- 実際の顧客GitHub Organizationへの登録操作
- GitHubの認証情報、Private Key、Webhook Secretのリポジトリ保存

## 機能要件

- **FR-001** GitHub Appの表示名、対象Organization、Private運用、必要権限を設定契約として定義する。
- **FR-002** AWS CDKでWebhook SecretをSecrets Managerへ保存し、Secretの物理名とARNを後続処理へ公開する。
- **FR-003** CDK synthの出力とログにWebhook Secretの実値、Private Key、GitHub Tokenを含めない。
- **FR-004** GitHub App登録とOrganizationへのインストールを、AWS CDKで管理するAWS側と、GitHub管理者が行うGitHub側に分離する。
- **FR-005** GitHub App登録に必要な設定、権限、Issue #4が提供するWebhook URLの受け渡し、失敗時の復旧方法を日本語で文書化する。
- **FR-006** 設定契約とSecret参照契約を、後続のWebhook受信とランナー登録が利用できるテストで固定する。

## 非機能要件

- IAMは後続実装が必要とするSecret参照に限定できる形で設計する。
- Secretの値は環境変数、コマンド引数、ログ、Git管理対象ファイルへ出力しない。
- 同じ入力でCDK構成を再現できるよう、Context lookupを使用しない。
- AWS認証なしでCDK synth、契約テスト、Secret非漏えい検査を実行できる。

## 受け入れ条件

- Private GitHub App、Organization限定、最小権限の設定契約がSpecと実装で一致している。
- AWS CDKでWebhook Secretを作成し、Secret ARNを出力できる。
- Webhook Secretの実値をコード、生成テンプレート、ログ、テスト出力へ含めない。
- GitHub側の登録操作とAWS側のCDK構築の責務境界が文書化されている。
- 後続Issue #4とIssue #5が利用する設定名、Secret ARN、失敗時の契約がテストで固定されている。
- `corepack pnpm quality`が成功する。

## 完了条件

Issue #3のSpec Kit成果物、AWS CDK実装、契約テスト、導入境界の文書が揃い、受け入れ条件を満たす。
