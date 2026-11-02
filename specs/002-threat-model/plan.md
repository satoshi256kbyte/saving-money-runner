# Issue #2 技術計画

## 成果物

| パス | 責務 |
| --- | --- |
| `docs/04-脅威モデルとセキュリティ基準.md` | 信頼境界、脅威、対策、残余リスク、検証契約 |
| `config/security-baseline.json` | 基準ID、カテゴリ、検証方法、リリース阻止条件 |
| `scripts/quality/check-security-baseline.mjs` | JSONの構造、必須基準、公開情報混入を検査 |
| `test/security-baseline.test.mjs` | JSONと文書の基準ID整合性を検証 |
| `package.json` | `security:check`を品質ゲートへ追加 |
| `scripts/quality/check-structure.mjs` | Issue #2成果物を必須ファイルとして検査 |

## 基準カテゴリ

- `boundary`: 信頼境界と顧客分離
- `webhook`: 署名、リプレイ、入力、冪等性
- `identity`: GitHub Appと短命トークン
- `iam`: AWS IAM最小権限とRole分離
- `network`: Private Subnet、Inbound拒否、暗号化
- `secret`: Secrets Manager、ログ・出力マスキング
- `runner`: エフェメラル実行とワークスペース破棄
- `image`: AMI検査、承認、世代管理
- `audit`: CloudTrail、CloudWatch、相関ID
- `availability`: レート制限、上限、コスト濫用

## 検証設計

JSONは重複しない基準ID、許可されたカテゴリ、空でない検証方法、booleanの
`release_blocker`を持つ。必須IDは文書にも出現し、文書とJSONの不一致をテストで検出する。

公開情報検査では、12桁のAWSアカウントID、`arn:aws:`、アクセスキー形式、
Secret値を成果物へ含めない。サンプルは`<ACCOUNT_ID>`、`<REGION>`、`<RESOURCE_ARN>`を使う。

## 検証境界

本Issueでは実AWSへ接続しない。AWSリソースの存在確認ではなく、後続実装が満たすべき
基準と、基準定義自体の整合性・公開情報混入を検証する。
