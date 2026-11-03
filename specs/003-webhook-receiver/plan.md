# Issue #4 技術計画

## 位置づけ

`spec.md` と `clarify.md` を入力に、技術方針と検証境界を定める。
ユーザーが決定した J-1〜J-5 を前提とし、この計画では変更しない。
tasks、analyze、implement は別の工程で行う。この工程でコードと `docs/` は変更しない。

## 決定の前提

| 番号 | 決定 | 内容 |
| --- | --- | --- |
| J-1 | 期限判定 | 受信時刻と本文の時刻項目の差が3日を超えたら拒否する（基準はGitHubの再配信期間3日） |
| J-2 | 受付レートと同時実行上限 | 顧客ごとの必須設定。未指定ならデプロイを失敗させる。値そのものはこの計画で決めない |
| J-3 | body上限 | Lambda同期呼び出しの6 MBに合わせ、設定可能にする。既定は6 MB（6291456バイト） |
| J-4 | 後続への受け渡し | SQS標準キュー。配信は重複しうるため、Issue #5が冪等に処理する |
| J-5 | 診断ログの保持期間 | Lambdaのロググループの保持期間は30日（ユーザーの決定。選択肢と理由は「決定済みの項目」） |

## 参照した公式文書

`clarify.md` の根拠（G1〜G8、A1〜A12）に加えて、この計画で次を確認した。

| 記号 | URL | 確認した内容 |
| --- | --- | --- |
| P1 | <https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-throttling.html> | HTTP APIはステージまたはルート単位でレートとバーストを設定できる。上限を超えると429を返しうる。制限は「目標値」でありベストエフォート |
| P2 | <https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html> | 予約同時実行数は上限と下限を兼ねる。設定できる値は「予約されていないアカウント同時実行数」から100を引いた値まで。設定自体に追加料金は無い |
| P3 | <https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-keys.html> | `aws:PrincipalArn` にはIAMロールのARNを指定する。AssumeRole後のセッションARNは指定しない。ARN演算子を推奨 |
| P4 | <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html> | DLQは同じアカウントとリージョンに作る。標準キューの保持は元の送信時刻基準なので、DLQの保持期間は元のキューより長くする |
| P5 | <https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html> | HTTP APIのpayloadは10 MB、統合タイムアウトは30秒（A2の再確認） |
| P6 | <https://aws.amazon.com/api-gateway/pricing/> | HTTP APIは受信リクエスト数と転送量の従量課金。単価は動的表示で取得できなかった |
| P7 | <https://docs.aws.amazon.com/general/latest/gr/apigateway.html> | アカウント単位のスロットルのレートとバーストはリージョンごとに異なる。HTTP APIのステージ設定はこれを超えられない（P1） |

GitHubの `workflow_job` payloadの時刻項目は、G8（OpenAPI記述）を機械的に読んで次を確認した。

| 項目 | `queued`、`waiting` | `in_progress`、`completed` |
| --- | --- | --- |
| `workflow_job.created_at` | 必須、null不可 | 必須、null不可 |
| `workflow_job.started_at` | 必須。型は日時（null不可） | 必須。型は日時（null不可） |
| `workflow_job.completed_at` | 必須。nullを取りうる | 必須。nullを取りうる |
| `installation` | 任意（必須ではない） | 任意（必須ではない） |
| `organization` | 任意（必須ではない） | 任意（必須ではない） |
| `repository` | 必須 | 必須 |

スキーマ上の定義であり、実際の配信で `started_at` がどの値になるかは確認していない。
このため、時刻の採用規則は「利用可能な値のうち最新」とした（後述）。

## 技術方針

- 受信経路は API Gateway HTTP API（payload format 2.0）から Lambda（Node.js 22、TypeScript）への1段構成とする。
- 検証と判定のロジックは、AWS SDKに依存しない純粋な関数として `src/webhook/` に置く。
  Secret取得、重複排除、キュー送信は「ポート」として注入し、ローカルで差し替えて契約テストする。
- 同じ Stack 内でLambdaロールを先に作り、Secretのリソースポリシーへ `IRole` として渡す（未整合1の解決）。
- 受け渡しは SQS 標準キュー。DLQ は本Specでは作らず、Issue #5で消費側と一緒に定義する。
- 設定は `config/github-app.example.json` を拡張する。値を決めない項目（J-2）は、設定例と品質ゲートのsynthでは null を許し、デプロイ経路だけで拒否する。

## アーキテクチャ

```text
GitHub (workflow_job / ping)
   │  HTTPS POST  (X-Hub-Signature-256, X-GitHub-Event, X-GitHub-Delivery)
   ▼
API Gateway HTTP API ── ステージ既定のスロットル（rateLimit / burstLimit。J-2）
   │  Lambdaプロキシ統合 (payload format 2.0, 統合タイムアウトは既定)
   ▼
Webhook受信Lambda（予約同時実行数 reservedConcurrency。J-2。タイムアウト3秒）
   │ ① 長さ・ヘッダー検査（Secret取得の前）
   │ ② Secret取得 ───────────────► Secrets Manager（AWSCURRENT / AWSPENDING。300秒キャッシュ）
   │ ③ HMAC-SHA256を定数時間で比較（全候補）
   │ ④ JSON検証 ─► ping ならここで200（抽出と期限検査は適用しない）
   │ ⑤ workflow_job の抽出・期限検査（J-1）
   │ ⑥ 重複排除の確保 ───────────► DynamoDB 重複排除テーブル（条件付きPutItem、TTL 3日）
   │ ⑦ 許可リスト項目だけを送信 ─► SQS 標準キュー（保持4日、SSE-SQS）
   │ ⑧ 重複排除を done に更新
   ▼
HTTP応答 (200 / 202 / 4xx / 503)           SQS標準キュー ─► Issue #5（消費側。冪等処理が必要）
```

CDKの依存関係（循環が無いことの根拠は「未整合1の解決」に記載）は次のとおり。

```text
Role(Lambda実行ロール, 依存なし)
  ├─► SecretのResourcePolicy（Denyの除外条件にRoleを追加。Secretにも依存）
  └─► Roleの権限ポリシー（別リソース。Secret / Table / Queueに依存）
Lambda Function ─► Role, 権限ポリシー（環境変数にSecret ARN、テーブル名、キューURL）
HTTP API ─► Lambda Function
```

## コンポーネント

### API Gateway HTTP API

| 項目 | 内容 |
| --- | --- |
| 種類 | HTTP API、payload format 2.0（Q-005）。カスタムドメインは使わず、既定のエンドポイントを使う |
| ルート | `POST` の1ルートのみ。他のメソッドとパスはAPI Gatewayが拒否する |
| ステージ | `$default`。自動デプロイ |
| スロットル | ステージの既定ルート設定に `rateLimit` と `burstLimit` を設定する（P1）。値は設定契約から受ける |
| アクセスログ | 本Specでは有効にしない。理由はIPなどの記録を増やさないため。429の件数はAPI Gatewayのメトリクスで見る。アラームはIssue #10 |
| Output | `GitHubAppWebhookUrl` にエンドポイントURLとルートパスを連結して出力する（FR-007） |

CDKのL2が `throttle` の指定を持たない場合は、L1の `CfnStage` の `defaultRouteSettings` で設定する。
どちらを使えるかは、tasks の最初に `aws-cdk-lib` 2.177.0 の型定義で確認する。

### Webhook受信Lambda

| 項目 | 内容 |
| --- | --- |
| ランタイム | Node.js 22。AWS SDK v3はランタイム同梱のものを使う |
| バンドル | `NodejsFunction`（esbuild）。devDependenciesへの追加はtasksで行う。Dockerでのバンドルは使わず、AWS認証なしでsynthできること |
| タイムアウト | 3秒（Q-008）。GitHubの10秒（G2）より短い。実測で不足なら10秒未満の範囲で変更し、理由を記録する |
| 予約同時実行数 | 設定契約の `reservedConcurrency`（J-2）。アカウントの未予約分から100を引いた値までしか設定できない（P2） |
| 環境変数 | Secret ARN、テーブル名、キューURL、body上限。いずれも秘密ではない |
| Secretの読取り | `GetSecretValue` を固定のSecret ARNに対してだけ許可する。`VersionStage` は `AWSCURRENT` と `AWSPENDING` を取得する |
| キャッシュ | 実行環境内のメモリに300秒（Q-008）。不一致を理由に再取得しない（Q-006） |
| ログ | JSONの1行ログ。項目は診断の分類、HTTPステータス、検証済みの配信ID、所要時間だけ。bodyとヘッダー値は出さない |
| ロググループ | CDKで明示的に作成し、保持期間を30日にする（J-5）。`logGroup` プロパティで関数に渡す |
| ログの権限 | 下の「実行ロールのログ書き込み権限」 |

`AWSPENDING` が存在しない場合は `ResourceNotFoundException` となる。これは平常の状態として扱い、`AWSCURRENT` だけで検証する（Q-006）。

#### 実行ロールのログ書き込み権限

CDKに独自の `iam.Role` を `role` として渡すと、`AWSLambdaBasicExecutionRole` は自動では付かない。
`aws-cdk-lib` 2.177.0 の型定義（`aws-cdk-lib/aws-lambda/lib/function.d.ts` の `role` プロパティの説明）と、公式のAPIリファレンスで確認した。
説明は「ロールを渡す場合は、関連するAWS管理ポリシー（`service-role/AWSLambdaBasicExecutionRole` と `service-role/AWSLambdaVPCAccessExecutionRole`）を自分で追加する」である。

根拠のURL: <https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda.FunctionOptions.html>

本Specは `FoundationStack` が作ったロールを渡す（未整合1の解決）ため、ログの権限を自分で付ける。
AWS管理ポリシーは使わず、次の文を `addToPrincipalPolicy` で加える。

| 項目 | 内容 |
| --- | --- |
| Action | `logs:CreateLogStream`、`logs:PutLogEvents` |
| Resource | CDKで作るロググループのARN（`logGroupArn`）だけ |
| 付与しないもの | `logs:CreateLogGroup`。ロググループはCDKが作るため不要 |

この権限が無いとLambdaは実行できてもログを書けず、診断（FR-005）が失われる。

### DynamoDB 重複排除テーブル

| 項目 | 内容 |
| --- | --- |
| キー | パーティションキー `bodyDigest`（署名対象の生の本文のSHA-256、16進小文字64桁）。配信ID（`deliveryId`）は診断用の属性 |
| 課金 | オンデマンド |
| TTL属性 | `expiresAt`（秒単位のUnix時刻）。処理時刻から3日（Q-002） |
| 属性 | `deliveryId`（診断用）、`state`（`processing`、`done`）、`leaseUntil`、`receivedAt`。bodyとヘッダーは保存しない |
| キーの計算 | 署名検証の後に、署名の対象と同じバイト列から計算する。計算だけで、書き込みはしない |
| 確保 | 条件付き `PutItem`。項目が無い、または `expiresAt` を過ぎた、または `state` が `processing` かつ `leaseUntil` を過ぎた場合だけ成功。失敗時は既存項目を返させて状態を判定する。`expiresAt` と `leaseUntil` の役割は `clarify.md` Q-002 に定める |
| 完了 | `UpdateItem` で `done` にする |
| 解放 | 受け渡し失敗時に `DeleteItem`（確保した試行の `leaseUntil` が一致する場合だけ） |
| 削除ポリシー | `DESTROY`。保存内容は3日で失効する識別子だけで、Secretを含まない。削除時の影響は再配信の重複に限られる |
| Lambdaの権限 | このテーブルのARNに対する `PutItem`、`UpdateItem`、`DeleteItem` だけ。`Scan`、`Query`、`GetItem` は付与しない |

TTLの削除は遅れるため、期限判定は常に書き込み条件と読み取り側で行う（A7）。

### SQS 標準キュー

| 項目 | 内容 |
| --- | --- |
| 種類 | 標準キュー（J-4） |
| 保持期間 | 4日（既定値を明示する。A10）。GitHubの再配信期間3日より長い |
| 暗号化 | SSE-SQS（SQS管理キー） |
| 転送の暗号化 | キューポリシーで非TLSのリクエストを拒否する |
| 可視性タイムアウト | 本Specでは既定値のまま。消費側の処理時間に依存するため、Issue #5で決める |
| DLQ | 作らない。消費側が無い本Specでは再受信が起きない。DLQと `maxReceiveCount` はIssue #5で定める（P4: DLQの保持期間は元のキューより長くする） |
| Lambdaの権限 | このキューのARNに対する `SendMessage` だけ |
| Output | キューのARNとURLを非機密Outputとして出す。Issue #5が参照する |

後続メッセージの契約（許可リスト。Q-010）は次のとおり。bodyをそのまま渡さない。

| 項目 | 型 | 備考 |
| --- | --- | --- |
| `schemaVersion` | 数値 | 初版は1。互換性を壊す変更で増やす |
| `deliveryId` | 文字列 | `X-GitHub-Delivery`。診断用。署名対象外で送信側が付け替えられるため、冪等キーにはしない |
| `bodyDigest` | 文字列 | 署名対象の生の本文のSHA-256（16進小文字64桁）。Issue #5の冪等キー |
| `event` | 文字列 | `workflow_job` のみ（`ping` は渡さない） |
| `receivedAt` | 文字列 | Lambdaの受信時刻（ISO 8601、UTC） |
| `action` | 文字列 | `queued`、`in_progress`、`completed`、`waiting`。Issue #5が選別する |
| `jobId`、`runId` | 数値 | `workflow_job.id`、`workflow_job.run_id` |
| `labels` | 文字列の配列 | `workflow_job.labels` |
| `status` | 文字列 | `workflow_job.status` |
| `repositoryId`、`repositoryFullName` | 数値、文字列 | `repository` は必須（G8） |
| `installationId` | 数値または null | `installation` は任意（G8）。null を #5 が扱う |
| `organizationLogin` | 文字列または null | `organization` は任意（G8） |

#### Issue #5への冪等性の要請

標準キューは同じメッセージを複数回配信しうる。さらに、キュー送信は成功したが重複排除の `done` 更新が失敗した場合、
受信側は確保を解放して503を返し、GitHubの再配信で同じ本文のメッセージがもう一度送られる。
GitHubの再配信では本文が同じになる前提のため、本文のダイジェスト（`bodyDigest`）も同じ値になる（実GitHubでの確認はフェーズ9）。配信IDは署名されず付け替えられるため、判定に使わない。
したがって、Issue #5は `bodyDigest` を冪等キーとして、同じメッセージの再受信を無害に処理しなければならない。
`deliveryId` は冪等キーにしない。この要請を、キューのOutputの説明と本Specの契約テストの前提に記載する。

## 期限判定の仕様（J-1）

検査順は `clarify.md` の「応答と診断の契約」に従う。順8（JSON検証）の直後の順9で `ping` を200で受理して終了し、
`workflow_job` の抽出と期限判定（順10）は `workflow_job` にだけ適用する。
`ping` の本文は `workflow_job` を持たないため、「解釈できる時刻が無い」ことによる `payload_invalid` は `ping` に適用しない。

- 比較する値は、受信時刻と、本文（署名検証後のJSON）の時刻項目の差の絶対値とする。差が3日を超えたら `expired`（400）で拒否する。
- 時刻項目は `workflow_job` の `created_at`、`started_at`、`completed_at` のうち、値が日時として解釈できるものの最新を使う。
  `created_at` は全actionで必須かつnull不可なので（上表）、解釈できる値が1つも無いことは `payload_invalid` として拒否する。
- 本文は署名対象なので改ざんされない。GitHubとLambdaの時計のずれは3日に比べて十分小さいことを前提とする。
- 絶対値を使うのは、未来の時刻を持つ配信も異常とみなすためである。

注意点がある。ジョブが3日を超えて継続する場合、`completed` の配信は `completed_at` を持つため問題にならない。
一方、`completed_at` が null のまま届く `completed` は、`created_at` と `started_at` だけで判定され、拒否されうる。
この経路が実際に起きるかは実AWSとGitHubでの確認が要るため、検証境界の「実環境でのみ」に載せる。

## CDK構成とStack分割

### 既存のFoundationStackとの関係

新しいStackは作らず、既存の `FoundationStack` に `WebhookReceiver` Constructを追加する。

| 案 | 評価 |
| --- | --- |
| 同じ `FoundationStack` に追加する（採用） | Secret、リソースポリシー、Lambdaロールが同じStackにあるため、ロールの参照が同一テンプレート内で完結する |
| 別Stackに分ける | SecretのリソースポリシーがStack BのロールARNを参照し、Stack BがSecret ARNを参照するため、Stack間の循環参照になる。固定のロール名で回避する案は、ARNがアカウントIDを含むトークンになり、同じ問題が残る |

SecretはRETAINで、受信系のリソースは作り直せる。Stackを分けて解決できる性質のものではないため、分割しない。

### ファイル構成

| パス | 責務 |
| --- | --- |
| `cdk/lib/webhook-receiver.ts`（新規） | HTTP API、Lambda、DynamoDB、SQS、Outputを作る |
| `cdk/lib/github-app-integration.ts`（変更） | 読取りロールとして `IRole` を受け取り、Denyの除外条件へ追加する |
| `cdk/lib/foundation-stack.ts`（変更） | Lambdaロールを作り、上の2つのConstructへ渡す |
| `cdk/lib/github-app-config.ts`（変更） | `webhookReceiver` 設定の読込み |
| `cdk/bin/app.ts`、`cdk/bin/check-app.ts`（変更） | 設定値のStackへの受け渡し |
| `src/webhook/`（新規） | 検証ロジック、ポートの型、Lambdaハンドラー |
| `scripts/github-app/validate-config.mjs`（変更） | 設定契約の拡張に合わせた検証 |
| `config/github-app.example.json`（変更） | `webhookReceiver` の項目の追加 |
| `test/` 配下（新規・変更） | 契約テスト、CDKアサーション、設定検証 |
| `scripts/quality/check-structure.mjs`（変更） | `specs/003-webhook-receiver/*` を必須成果物に追加 |
| `docs/05-GitHub AppとWebhook導入手順.md`（変更） | 後述の文書修正 |
| `package.json`（変更） | esbuildの追加。必要なら新しい検査スクリプト |

### 未整合1の解決: Lambdaロールの読取り許可

#### 問題

`cdk/lib/github-app-integration.ts` はロールARNを、12桁のアカウントIDを持つ文字列の正規表現で検証する。
同じStackで作るLambdaロールのARNはデプロイ前にはトークンであり、この検証を通らない。
設定ファイルの `additionalReaderRoleArns` へは書けない。

#### 決定

文字列のARNではなく、型付きの `iam.IRole` として渡す。

1. `FoundationStack` が、権限ポリシーを持たない `iam.Role`（信頼先は `lambda.amazonaws.com`）を先に作る。ロール名は固定しない。
2. `GitHubAppIntegration` に `webhookReaderRoles?: iam.IRole[]` を追加する。
   Denyの `ArnNotLike` 条件の値は、既存の文字列ARN（検証済み）に、`role.roleArn` を連結して作る。
3. 文字列ARNは、これまでどおり正規表現と同一アカウント検査（`assertReaderRolesInAccount`）を通す。
   `IRole` は型で「同じStackで作ったロール」であることを保証するため、正規表現の対象外とする。
   正規表現の緩和（トークンを許す）はしない。ワイルドカードや別種のARNが紛れ込む経路を増やさないためである。
4. `WebhookReceiver` は、同じ `IRole` をLambdaの実行ロールとして使う。Secretへの読取りは `role.addToPrincipalPolicy` で、
   `GetSecretValue` を `secret.secretArn` だけに許可する文として追加する。

#### 循環参照の有無

CloudFormation上のリソースの依存は次のとおりで、循環は無い。

| リソース | 依存先 |
| --- | --- |
| IAMロール | なし（権限ポリシーを持たない） |
| Secret | なし |
| Secretのリソースポリシー（`AWS::SecretsManager::ResourcePolicy`） | Secret、IAMロール |
| ロググループ | なし（ロール名に依存しない） |
| ロールの権限ポリシー（`AWS::IAM::Policy`） | IAMロール、Secret、テーブル、キュー、ロググループ |
| Lambda関数 | IAMロール、ロールの権限ポリシー、ロググループ（環境変数でSecret ARN等を参照） |

循環になるのは、ロールの権限ポリシーをロールの定義の中へ埋め込み（インラインで`Policies`として持たせ）、
ロールがSecretに依存し、同時にSecretのポリシーがロールに依存する場合である。
CDKの `iam.Role` は権限を別リソースの `AWS::IAM::Policy` として出力するため、この形になる。
ただし、これはCDKの出力の挙動への依存であり、実装後に必ずテストで確認する。

#### 回避と検証

- `Template` のJSONから、`Ref`、`Fn::GetAtt`、`DependsOn` を辿って依存グラフを作り、循環が無いことを検査するテストを追加する。
- CDKは `Ref` による暗黙の循環をsynth時に検出しない場合がある。そのため、synthの成功だけを根拠にしない。
- 同じテストで、Secretのリソースポリシーの `ArnNotLike` が、管理者ロールと追加ロールに加えて、
  Lambdaロールの `Fn::GetAtt`（`Arn`）を含むことを確認する。
- 認可の実効性（`aws:PrincipalArn` がAssumeRole後のLambdaでロールのARNとして評価されること）は、
  公式文書がロールのARNを指定するよう示している（P3）。ただし実際のDenyの挙動は実AWSでのみ確認できる。

#### 副作用

`docs/05` は「Webhook処理ロールを `additionalReaderRoleArns` に追加する」と書いている。
採用した方式では、Lambdaロールは自動で追加されるため、この記述は不要になり、誤解を招く。
文書の修正はtasksに載せる（未整合2と同じ文書）。`additionalReaderRoleArns` は、人間の運用ロールを追加する用途に限る。

## 設定契約の拡張（J-2、J-3）

`config/github-app.example.json` に、`webhookReceiver` オブジェクトを追加する。

| キー | 型 | 必須 | 既定値 | 内容 |
| --- | --- | --- | --- | --- |
| `webhookReceiver.rateLimit` | 正の整数 | 必須 | なし | HTTP APIのステージの定常レート（件/秒）。J-2 |
| `webhookReceiver.burstLimit` | 正の整数 | 必須 | なし | 同バースト。API Gatewayの設定がレートとバーストの組を要するため、J-2に含める |
| `webhookReceiver.reservedConcurrency` | 正の整数 | 必須 | なし | Lambdaの予約同時実行数。J-2 |
| `webhookReceiver.maxBodyBytes` | 正の整数 | 任意 | 6291456 | body上限（バイト）。上限値は6291456（6 MB。`spec.md` の非機能要件）。J-3 |

値そのものはこの計画で決めない。`config/github-app.example.json` には、実値の代わりに null を置く。

### 検証の規則

| 場面 | 規則 |
| --- | --- |
| 設定の構造検証（`validateGitHubAppConfig`） | `webhookReceiver` と必須の3項目のキーの存在を要求する。値は正の整数か null（null の拒否はデプロイ経路だけで行う）。未知のキーは拒否する |
| 品質ゲートのsynth（プレースホルダー許可） | null を許す。Stackへは検査専用の固定値を渡す。この値は `cdk/bin/check-app.ts` だけに置き、デプロイ経路では使わない |
| デプロイ経路（`loadGitHubAppConfig(false)`） | 必須の3項目のどれかが null または欠落なら、synthを開始せずに失敗する。既存のプレースホルダー拒否と同じ経路にする |
| `maxBodyBytes` | 指定された場合は 1 以上 6291456 以下の整数。超過は設定エラー |
| `burstLimit` と `rateLimit` | `burstLimit` が `rateLimit` 以上であることを検査する |
| `reservedConcurrency` | アカウントの残りに依存する上限は、AWSがデプロイ時に拒否する（P2）。設定側では正の整数だけを検査する |

### Issue #3の検証スクリプトへの影響

| 対象 | 影響 |
| --- | --- |
| `allowedConfigKeys`（`validate-config.mjs`） | `webhookReceiver` を追加する |
| `rejectForbiddenKeys` | 新しいキー名は `secret`、`token`、`password`、`private key`、`credential` を含まないため、拒否に当たらない |
| 既存の設定ファイル | `webhookReceiver` が無い設定は不合格になる。導入済みの顧客の設定には移行が要る。移行手順は `docs/05` に載せる |
| `github-app:check` | 例の設定が null を持つ形で合格すること。デプロイ経路は別に拒否すること、の両方をテストする |
| `test/github-app.test.mjs` | 必須項目の欠落、null、負数、0、小数、上限超過、`burstLimit < rateLimit` の拒否を追加する |
| `assertReaderRolesInAccount` | 変更しない。`IRole` は対象外 |

## 診断とHTTP応答

`clarify.md` の「応答と診断の契約」を、そのまま契約テストの入力にする。plan で追加する規則は次のとおり。

- 診断の出力先は、Lambdaの標準出力（CloudWatch Logs）のJSON1行とする。相関IDはLambdaのリクエストIDを使い、`X-GitHub-Delivery` は検証後だけ出す。
- API Gatewayのスロットルによる429は、Lambdaに到達しないため診断が出ない。GitHubの配信履歴とAPI Gatewayのメトリクスで把握する。
- 429と、予約同時実行数によるLambdaのスロットルで拒否された配信は、GitHubが自動で再配信しないため（G3）、運用者が再配信する。
  J-2の値を小さくしすぎると正規の配信を失う。Runbookにこの点を記載する。
- 期限切れ（順10）は、重複排除に記録しない。再配信しても同じ理由で拒否される。復旧が要る場合は、運用者がRunbookで判断する。

## 検証境界

### ローカル（AWS認証なし）で検証できるもの

| 対象 | 方法 |
| --- | --- |
| HMAC検証（正常、不一致、形式不正、長さ違い、候補2つ） | 純粋関数への契約テスト。ポートはメモリ実装で差し替える |
| raw bodyと `isBase64Encoded` の復元、body上限 | 同上 |
| 順1〜13の検査の順序とHTTPステータス、診断の分類 | 同上。順序の入れ替えを検出するテストを含める。`workflow_job` を持たない `ping` の本文も入力に含める |
| ログと例外にSecret、body、トークンが出ないこと | 出力を捕捉して文字列検査する |
| 期限判定の境界（3日ちょうど、3日超、未来、時刻が欠落） | 時計を注入して検査する |
| 重複排除の状態遷移（新規、処理済み、処理中、解放、期限切れ項目） | メモリ実装での契約テスト。条件付き書き込みの意味はMinistackでも確認する |
| CDKのリソース構成（API、ルート、スロットル、予約同時実行、テーブルのTTL、キューの暗号化と保持） | CDK assertions |
| IAMの最小権限（Secretの`GetSecretValue`が固定ARNだけ、テーブルとキューも固定ARN、書き込み系のSecret操作が無い） | CDK assertionsでPolicyDocumentを検査する |
| Secretのリソースポリシーの除外条件にLambdaロールが含まれること、依存グラフに循環が無いこと | CDK assertionsとテンプレートの依存グラフ検査 |
| `GitHubAppWebhookUrl` Outputの存在 | CDK assertions |
| 設定契約（J-2、J-3の必須、null、範囲） | Node.jsの契約テスト |
| 公開情報の検査 | `security:check` |

Ministack（`compose.yaml`）は、DynamoDBの条件付き書き込みとSQSの送受信の動作確認に使える範囲で使う。
Ministackの対応状況は未確認のため、使えない項目は実AWSの項目へ移し、tasksで確定する。

### 実AWSでのみ検証できるもの

| 対象 | 理由 |
| --- | --- |
| Secretのリソースポリシーが、LambdaロールのAssumeRole後の呼び出しを許し、他の主体を拒否すること | IAMの評価はエミュレーターで再現できない |
| API Gatewayのスロットルによる429、Lambdaの予約同時実行数によるスロットルの実際の応答 | サービスの挙動（P1は「目標値」としている） |
| 予約同時実行数がアカウントの未予約分から100を引いた範囲に収まること | アカウントのクォータに依存（P2） |
| 6 MB付近のbodyの実際の挙動 | API GatewayとLambdaのイベント化により、本文より大きなイベントが作られるため、受け付けられる実効的な上限は6 MBより小さい可能性がある。未確認 |
| `completed_at` が null の `completed` の実際の配信 | GitHubの実配信でのみ確認できる |
| ロググループへの書き込み（`logs:CreateLogStream`、`logs:PutLogEvents`）の実際の許可 | IAMの評価はエミュレーターで再現できない。デプロイ後にLambdaを呼び、ログが出ることで確認する |
| GitHub Appに登録した後の `ping`、署名つき配信、再配信 | 実際のGitHub App |
| Secretのキャッシュ反映と、ローテーション中の `AWSPENDING` の受理 | 実際のSecrets Manager |
| CloudTrailへの `GetSecretValue` の記録 | 実AWS |
| コールドスタートを含む3秒のタイムアウトの妥当性 | 実測 |

実AWSでの検証は、本Specの実装範囲の外とする（`spec.md` の対象外）。導入時の確認事項として `docs/05` に記載する。

## セキュリティ

| 項目 | 設計 |
| --- | --- |
| 署名の比較 | `node:crypto` の `timingSafeEqual` を使う。長さが異なる場合は、比較せずに不一致とする（長さを先に確認する。`timingSafeEqual` は長さが違うと例外を投げるため） |
| 全候補の比較 | `AWSCURRENT` と `AWSPENDING` の両方に対してHMACを計算し、一致しても途中で打ち切らず、結果を最後にまとめる（Q-006） |
| raw body | `body` が `isBase64Encoded` ならバイト列へ戻す。そうでなければUTF-8のバイト列にする。パースと再シリアライズをした値では計算しない |
| 署名前の検査 | 長さ、`Content-Type`、イベント種別、配信IDの形式、署名ヘッダーの形式。これらはbodyの内容を使わない |
| 秘密の読取り範囲 | Lambdaロールは `GetSecretValue` のみ、固定のSecret ARNのみ。`PutSecretValue`、`UpdateSecretVersionStage`、`DeleteSecret`、`ListSecrets`、`DescribeSecret` は付与しない（Q-007） |
| Secretのリソースポリシー | Denyの除外にLambdaロールを加える。それ以外の主体からの取得は引き続き拒否される |
| ログの権限 | `logs:CreateLogStream` と `logs:PutLogEvents` を、CDKで作ったロググループのARNに限って許可する。`logs:CreateLogGroup` は付与しない |
| 他リソースの権限 | テーブルは `PutItem`、`UpdateItem`、`DeleteItem`、キューは `SendMessage` だけ。いずれもARNを指定し、`*` を使わない |
| ログ | Secret、署名の途中の値、本文、ヘッダー値、トークンを出さない。例外は分類コードだけを出し、メッセージとスタックを出さない |
| 増幅攻撃 | 不一致の度にSecretを再取得しない。ヘッダーだけで判定できる不正は、Secretの取得の前に拒否する（`clarify.md` の順3、順4） |
| 認証 | 署名検証のみ。IP制限とWAFは採用しない（Q-004） |
| TLS | API GatewayのエンドポイントはHTTPSのみ。SQSは非TLSを拒否する |
| 公開情報 | AWSアカウントID、実在するARN、Secretの実値を、Spec、設定の例、テストの出力に書かない。`security:check` の規則に触れない |
| GitHub Appの権限 | `Actions: read` と `Metadata: read` のみ。書き込みが必要になった場合は別Specで再承認する |

## 未整合2の解決方針: ローテーション手順への追記

`docs/05-GitHub AppとWebhook導入手順.md` の「ローテーション」を、次のとおりtasksで修正する。この工程では修正しない。

| 箇所 | 追記内容 |
| --- | --- |
| 手順2と手順3の間 | 手順2の後に、Lambdaのキャッシュに `AWSPENDING` が反映されるまで300秒以上待つ。待ってから手順3へ進む |
| 手順3から手順5 | 反映前に届いて拒否された配信は、手順5の再配信で復旧する。再配信は過去3日分が可能（G4） |
| 手順6 | `AWSPENDING` を `AWSCURRENT` へ昇格した後も、Lambdaのキャッシュが古い版を最大300秒保持する。キャッシュの期間中は、受信側が持つ2版の組が昇格前の状態のままになる。昇格の前後で署名に使われるSecretの値は変わらないため、昇格の直前にGitHub側が `AWSPENDING` の値へ切り替わっていれば拒否は起きない。昇格後300秒は旧版を使う配信が無いことを確認してから、旧版の利用を止める |
| 手順7 | 失敗時にGitHub側を現行版へ戻す場合も、現行版は `AWSCURRENT` のままなので、反映待ちは要らない |

そのほかのtasksで直す `docs/05` の記述は次のとおり。

| 箇所 | 修正内容 |
| --- | --- |
| 権限の最後の項目 | Webhook処理ロールは `additionalReaderRoleArns` に追加しない。Stack内のロールが自動で追加される |
| 登録手順の手順6 | `ping` は署名検証後に200で受理されること。Content-Typeを `application/json` にすること |
| 新規の節 | `webhookReceiver` の設定項目（rateLimit、burstLimit、reservedConcurrency、maxBodyBytes）と、既存の設定の移行 |
| 新規の節 | 429や503で拒否された配信を再配信する手順 |

## 未整合3の解決方針: spec.md の古い記述

`spec.md` の「未決事項と決定」以外の節に残っていた未決の表現を、決定に合わせて修正する。
この工程で `spec.md` と `clarify.md` を修正した。対象と修正の内容は次のとおり。

| `spec.md` の箇所 | 修正内容 |
| --- | --- |
| 対象外の「Secretの自動ローテーション」 | 「未決事項として扱い」を削除し、別Spec（Q-006）と明記 |
| 受信するヘッダーの `X-GitHub-Event` | `ping` の扱いは Q-009 の決定（200で受理）に置き換え |
| 受信するヘッダーの `X-GitHub-Delivery` | 「clarify で確認する」を削除し、再配信でも同一IDであることの確認済み（G2）に置き換え |
| タイムスタンプの説明 | 候補の列挙を、J-1の決定に置き換え |
| 非機能要件の入力サイズ上限とタイムアウト | 上限は設定可能で既定6 MB（J-3）、タイムアウトは3秒（Q-008）。「10 MBより小さく」の想定は6 MBが先に効くという訂正に置き換え |
| 依存する既存の契約の読取り権限 | Lambdaロールは追加読取りロールの文字列ではなく、Stack内のロールとして加える（plan） |
| 受け入れ条件の期限切れ | 「判定方法は clarify で確定する」を、J-1の規則に置き換え |
| FR-009 | 「plan で定める」を、本書の「後続メッセージの契約」への参照に置き換え |
| 追加した FR-010 | 設定契約（J-2、J-3）の要件 |
| 未決事項と決定の表 | Q-001、Q-003、Q-008、Q-010 を決定へ更新。「未決は plan に進めない」の注記を更新 |
| 末尾の「他の節の文言は、plan の前に整合させる」 | 整合の完了を示す文に置き換え |

`clarify.md` は、J-1〜J-5 の決定結果を記録する節を追加し、判定の一覧と、planへ引き継いだ制約の記述を、planでの解決に合わせて更新した。

## コスト概算の大枠

実際の金額はリージョンと利用量で変わる。単価は公式の料金ページで確認する必要があるが、
取得時に単価が動的表示で読み取れなかったため（P6）、この計画には金額を書かない。tasksまたは導入前に、料金計算ツールで見積もる。

| 要素 | 費用を決める量 | 備考 |
| --- | --- | --- |
| API Gateway（HTTP API） | 受信リクエスト数、転送量 | 1ジョブあたり最大4回の `workflow_job`（`clarify.md` Q-003）。拒否されるリクエストも課金対象になる想定 |
| Lambda | 実行回数、実行時間、メモリ | 予約同時実行数の設定自体に追加料金は無い（P2）。上限が費用の上限を決める |
| DynamoDB（オンデマンド） | 書込み回数（確保、完了、解放で最大3回 / 配信）、保持量 | TTLで保持量が3日分に収まる |
| SQS | リクエスト数（送信と受信）、メッセージ量 | 保持4日。DLQは本Specで作らない |
| Secrets Manager | Secretの月額、API呼び出し回数 | キャッシュで、実行環境ごと・300秒ごとに最大2回（CURRENTとPENDING）に抑える |
| CloudWatch Logs | 取り込み量、保持期間 | 診断はbodyを含まず小さい。保持期間は30日（J-5） |

月間の配信数の見積もりの式は、次のとおり。

```text
月間リクエスト数 ≒ 月間ジョブ数 × 3〜4（queued, in_progress, completed, 必要なら waiting）
```

不正な大量リクエストは、ステージのスロットル（J-2）とbodyの上限（J-3）で費用の増加を抑える。
スロットルは「目標値」であり、厳密な上限ではない（P1）。

## ロールバック方法

| 場面 | 手順 |
| --- | --- |
| デプロイが失敗した | CloudFormationの自動ロールバックに任せる。Secretは `RETAIN` のため、失われない |
| 受信を止めたい | GitHub AppのWebhookを無効にする。AWS側のリソースは残してよい |
| 直前の版へ戻したい | コミットを戻して再デプロイする。`GitHubAppWebhookUrl` はAPIを作り直さない限り変わらないため、GitHub側の再登録は要らない |
| Stackを削除する | 先にGitHub AppのWebhookを無効にする。キューにメッセージが残る場合は、Issue #5が消費し終えるまで削除しない。Secretは `RETAIN` で残る。テーブルは削除される（3日分の重複排除が失われ、再配信で重複が起きうるが、Issue #5が冪等に処理する） |
| 設定契約を元に戻す | `webhookReceiver` を削除すると、新しい検証が不合格になる。Issue #3相当へ戻す場合は、コミットごと戻す |
| Lambdaロールの権限を誤って広げた | Secretのリソースポリシーは別にDenyを持つため、Lambdaロール以外は読めない。コミットを戻して再デプロイする |

API Gatewayの種類を変えるとURLが変わり、全顧客でGitHub Appの再登録が要る（`clarify.md` Q-004）。種類は変えない。

## 決定済みの項目

### J-5 ロググループの保持期間

ユーザーが選択肢A（30日）に決定した。決定時点の選択肢を記録として残す。

| 選択肢 | 内容 | メリット | デメリット |
| --- | --- | --- | --- |
| A（決定） | 30日 | 費用を抑えられる。GitHubの再配信期間（3日）の10倍で、障害の調査には足りる | 長期の監査には足りない。Secret取得の監査はCloudTrailが担う |
| B | 90日 | 調査の余裕が大きい | 費用が増える。診断は小さいので差は小さい見込み（実測は無い） |
| C | 期限なし | 設定が不要 | 費用が増え続ける。診断を永続的に保持する理由が無い |

Aを採る理由は、診断にbodyを含めないため調査対象が小さく、再配信の判断が3日以内であることによる。
Secret取得の監査は、ログではなくCloudTrailで行う（Q-007）。
30日という数値そのものに公式の根拠は無く、ユーザーの決定による。保持期間の要件が別に生じた場合は、別の判断として扱う。

## テストの .ts 読込み方式（T060）

決定: `.ts` を読むテストは、子プロセスで `node --import tsx --input-type=module -e` を実行し、
子の中で `createRequire` を使って読む。テストプロセスへ tsx のローダーを直接登録しない。

| 項目 | 内容 |
| --- | --- |
| 採用した方式 | 子プロセス（`execFileSync`）で `node --import tsx` を実行し、`createRequire` で `.ts` を読む |
| 採用の根拠 | `test/github-app-cdk.test.mjs` の6行目のコメントどおり、tsxのローダーをテストプロセスへ直接登録すると、CDKの読込みで循環参照により失敗する |
| 採用の根拠（CJS） | `package.json` に `"type"` が無いため `.ts` はCJSとして扱われる。ESMの `import()` では名前付きexportが `default` の下に入る。`createRequire` ならそのまま読める（`test/webhook-config.test.mjs` で確認） |
| 不採用 | `test` スクリプトに `--import tsx` を付ける方式。上の循環参照の経緯による。実際には試していない |
| 不採用 | Node.js の型除去（`--experimental-strip-types`）。`engines` は `>=22.0.0` で、版と挙動の検証をしていない |
| 検証 | `test/webhook-config.test.mjs` の10件が成功。`node --test` 全体の結果は `implementation-log.md` に記録 |

## T061 ESLintのglobalsの決定

決定: globalsは `test/**/*.mjs` だけに `Buffer` を追加する（`eslint.config.mjs` の既存の設定を採用）。
`**/*.mjs` 全体には広げない。`src/**/*.ts` は ESLint の対象外のままとし、TypeScript用のパーサーは追加しない。

| 項目 | 内容 |
| --- | --- |
| 追加するglobals | `Buffer`（`test/**/*.mjs` のみ）。他の追加は無し |
| 採らなかった案 | `**/*.mjs` 全体へ広げる。`src` と設定ファイルでBufferを使う理由が無く、対象が広がる |
| `.ts` の扱い | ESLintの対象外のまま。型検査は `corepack pnpm typecheck`（`tsc --noEmit`）で行う |
| 根拠 | テストだけがBufferを使い、本体（`src/webhook/*.ts`）は `tsc` の対象。対象を最小にするため |
| 検証 | `Buffer` を使う `test/webhook-units.test.mjs` などを含め、`node_modules/.bin/eslint .` が成功する |

## 残る未整合

フェーズ1（T001〜T004）の結果。根拠と詳細は `implementation-log.md` に記録している。

| 項目 | 結果 |
| --- | --- |
| CDK L2の `throttle` の可否（T001） | 可。`HttpStage` の `throttle`（`aws-cdk-lib` 2.177.0、`aws-apigatewayv2/lib/common/stage.d.ts` 56〜60行）を使う。`HttpApi` は `createDefaultStage: false` にする |
| Ministackで確認できる範囲（T002） | DynamoDBの条件付き書き込み、TTL属性の設定、SQSの送受信と保持期間は確認できた。IAMの評価、TTL削除の時刻、SSE-SQSの暗号化、キューポリシーの拒否は未確認。フェーズ9へ対応づけた（IAMは T063、キューのTLS拒否は T064、SSE-SQSは T065、TTL削除は T066） |
| 6 MB付近の実効的な上限（T003） | 未確認。測り方（base64は復元前にバイト長を計算する）は決めた。実測はT055 |
| `completed_at` が null の `completed` の扱い（T004） | 規則と期待結果の一覧を決めた。実配信での発生は未確認。T056 |
