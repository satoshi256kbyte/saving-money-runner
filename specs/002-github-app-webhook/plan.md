# Issue #3 技術計画

## 実装方針

AWS側の構成は、既存の`FoundationStack`へ再利用可能なGitHub App連携Constructを追加して管理する。
GitHub側のApp作成とOrganizationへのインストールは、GitHub管理者が行う導入手順として分離する。

## 変更対象

| パス                                     | 責務                                                      |
| ---------------------------------------- | --------------------------------------------------------- |
| `cdk/lib/github-app-integration.ts`      | Webhook Secret、Secret ARN出力、GitHub App連携のAWS側契約 |
| `cdk/lib/foundation-stack.ts`            | GitHub App連携Constructの組み込み                         |
| `config/github-app.example.json`         | Organization、App名、権限、Webhookイベントの公開設定例    |
| `scripts/github-app/validate-config.mjs` | Secret実値を読まずに公開設定契約を検証                    |
| `test/github-app.test.mjs`               | 設定検証、Secret非漏えい、CDK出力契約の回帰テスト         |
| `docs/05-GitHub AppとWebhook導入手順.md` | GitHub側とAWS側の責務、導入、更新、失敗時復旧の手順       |
| `specs/002-github-app-webhook/*`         | Issue #3のSpec Kit成果物                                  |
| `scripts/quality/check-structure.mjs`    | Issue #3の必須成果物検査                                  |
| `package.json`                           | `github-app:check`と品質ゲートへの追加                    |

GitHub側の権限契約はActions Read-onlyとMetadata Read-onlyをIssue #3の最小構成とする。Administration権限は付与しない。ランナー登録などで必要と判明した場合は、Issue #5でAPI操作、対象範囲、理由を再承認する。

## AWS CDK設計

- `secretsmanager.Secret`でWebhook Secretを生成する。
- Secretの実値をCDKコード、Context、CfnOutput、ログへ置かない。
- CfnOutputはSecret ARN、Organization名、App名など非機密の契約値だけを公開する。
- Secretには削除保護に関する既存方針を適用し、導入時の更新・復旧手順を文書化する。
- Context lookupは使用せず、AWS認証なしでsynthできる構成にする。
- WebhookのHTTP受信とHMAC検証はIssue #4で追加するため、Issue #3ではIssue #4が提供する`GitHubAppWebhookUrl` OutputとSecret ARNの受け渡し契約だけを定義する。

## 設定検証設計

`config/github-app.example.json`には次の非機密項目だけを記載する。

- Organization名のプレースホルダー
- App表示名
- Private設定
- Organization権限とRepository権限の許可リスト
- Webhookイベント名
- Secret参照名

`validate-config.mjs`は、必須項目、Private設定、Organization指定、最小権限、許可イベントを検証する。
Webhook Secret、Private Key、GitHub Tokenの実値を設定ファイルから読み取らない。

## 検証境界

| 検証                   | 実施                                        |
| ---------------------- | ------------------------------------------- |
| 設定JSONの構造と許可値 | Node.js契約テストと`github-app:check`       |
| Secret実値の非漏えい   | 設定、CDKテンプレート、テスト出力の固定検査 |
| CDKリソース構成        | `cdk:check`とCDK assertions                 |
| GitHub Appの実登録     | 対象Organization管理者による導入時確認      |
| 実AWS Secret参照権限   | Issue #4以降のIAM実装と実AWS検証            |
| Webhook HMACとリプレイ | Issue #4の実装・結合テスト                  |

## 失敗時の扱い

- 設定検証に失敗した場合はCDK synthを開始しない。
- GitHub App登録に失敗しても、既存Secretを削除・上書きしない。
- Secret ARN、GitHub App ID、Issue #4が提供するWebhook URLの不足は導入失敗として停止する。
- Secretの実値をエラーメッセージや作業記録へ出力しない。
