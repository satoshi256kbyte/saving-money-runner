# Issue #3 Clarify結果

## 決定事項

| 論点                         | 決定                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Appの作成             | GitHub管理者がGitHub側の画面または公式APIで行う。AWS CDKからGitHubへ管理者認証を渡さない                                                                |
| Organizationへのインストール | 対象Organizationを明示してGitHub管理者が行う。公開Repositoryや別Organizationへのインストールは導入手順で拒否する                                        |
| AWS側の責務                  | AWS CDKがSecrets ManagerのWebhook Secretと後続処理向けの出力契約を管理する                                                                              |
| Webhook受信                  | HTTP受信、HMAC検証、リプレイ対策はIssue #4の責務とする。Issue #3ではIssue #4が提供するURLとSecret ARNの受け渡し契約だけを確定する                       |
| GitHub App権限               | ActionsはRead-only、MetadataはRead-onlyをIssue #3の最小構成とする。AdministrationはIssue #3では付与しない。Issue #5で必要と判明した場合は別Specで再評価する |
| Secretの初期値               | Secretの実値をCDKコード、Context、出力、ログ、Git管理対象へ置かない。CDKがSecrets Managerの生成Secretを作成し、管理者が安全な経路でGitHub Appへ設定する |
| Private Key                  | GitHub側で発行されるPrivate Keyは顧客環境外へ出力しない。将来AWS側で参照する場合は別Secret契約を追加する                                                |
| 再実行                       | CDK構成は同じ入力で再現可能にし、GitHub側の登録失敗は既存AppやSecretを破壊せず、手順に従って再試行できるようにする                                      |

## 責務境界

AWS CDKは、顧客AWSアカウント内のSecret、出力、後続Lambdaが参照する設定契約を管理する。
GitHub側のApp作成、権限設定、Organizationへのインストール、Webhook URL登録は、GitHub管理者の操作または導入CLIの責務とする。
Issue #4は`GitHubAppWebhookUrl`というCloudFormation Outputを提供し、GitHub側のWebhook登録手順はこのOutputを参照する。

GitHub管理者の認証情報、App Private Key、Webhook Secretの実値をAWS CDKのContext、環境変数、ログ、リポジトリへ渡さない。

## 未決事項の扱い

実際のGitHub App画面で権限名が利用できない場合は、実装を推測で変更しない。
GitHubの権限一覧と対象Organizationのポリシーを確認し、Issue #3の受け入れ条件または後続Issueを更新する。

## 受け入れ条件への反映

- Private AppとOrganization限定インストールの責務境界が文書化されている
- AWS CDKがWebhook Secretを生成し、Secret ARNを後続処理へ出力する
- Issue #4が提供するWebhook URLとSecret ARNの契約が固定されている
- Secret実値、Private Key、GitHub TokenがCDKコード、synth出力、ログへ含まれない
- GitHub側登録に失敗しても、既存AWS Secretを破壊せず再実行できる
