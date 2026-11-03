# Issue #2 Clarify結果

## 確定事項

| 項目 | 決定 |
| --- | --- |
| 対象 | 顧客AWSアカウント内に単一顧客のGitHub Actionsランナーを構築するMVP |
| GitHub境界 | GitHubは外部信頼境界とし、Webhookは未検証の入力として扱う |
| 顧客境界 | AWSアカウントとOrganizationを顧客の管理境界とする |
| Webhook | raw bodyのHMAC検証、イベントIDによる重複排除、リプレイ対策を必須とする |
| ランナー | Private Subnet、Public IPなし、1ジョブ1ランナー、ジョブ後破棄を必須とする |
| Secret | Secrets Managerで暗号化管理し、ログ・CloudFormation出力・Issueへ出さない |
| IAM | Lambda、ランナー、AMIビルド、運用者の権限を分離する |
| 監査 | CloudTrailとCloudWatchを標準化し、相関IDで追跡する |
| 残余リスク | GitHub上のWorkflow権限と依存パッケージの安全性は顧客運用と後続検査に委ねる |

## 未決事項の解消

- MVPでは共有コントロールプレーンを作らず、顧客アカウント単位で隔離する
- WAF、NAT、外部Egress制御の具体的なAWSリソースは後続Issueで実装するが、
  公開Inboundを許可しない基準は本Issueで固定する
- Webhookのレート制限とコスト上限は基準へ含め、具体的な閾値は実装Issueで決定する
- IAMの各ActionとResource ARNは実装時に具体化し、基準では最小権限と検査契約を定める
- 重大な基準違反は、検証不能の場合も含めてリリース阻止とする

## 出力契約

- 各基準は安定した`SEC-xxx` IDを持つ
- 各基準には検証方法と`release_blocker`を持たせる
- `release_blocker: true`の基準が未達または検証不能なら品質ゲートは失敗する
- 文書とJSONの基準IDが一致しない場合は品質ゲートを失敗させる

## 判断

Issue #2では脅威モデルと検証契約を確定し、後続IssueでAWSリソースとコードへ落とし込む。
具体的な閾値やAWS API権限を推測で固定しない。
