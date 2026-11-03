# Issue #4 実装ログ

## 概要

Spec Kit の implement のフェーズ1（T001〜T004）の結果を記録する。このフェーズは検証のみで、プロダクトコードは変更していない。
コミット、push、PR作成は行っていない。

| 項目 | 内容 |
| --- | --- |
| 作業場所 | 永続worktree（ブランチ `feature/issue-4-webhook`） |
| 変更したファイル | `specs/003-webhook-receiver/` 配下の文書のみ |
| AWS | 実AWSには接続していない。ローカルのエミュレーターだけを使った |

## T001 CDK L2でHTTP APIのステージにスロットルを設定できるか

結果: 完了。L2の `HttpStage` の `throttle` プロパティを採用する。

根拠（`node_modules/aws-cdk-lib`、版 2.177.0 を確認）:

| 確認した点 | 場所 |
| --- | --- |
| `StageOptions.throttle?: ThrottleSettings` | `aws-apigatewayv2/lib/common/stage.d.ts` 56〜60行 |
| `ThrottleSettings` に `rateLimit?`、`burstLimit?` がある | 同ファイル 78〜90行 |
| `HttpStageOptions extends StageOptions`。`HttpStage` が `throttle` を受ける | `aws-apigatewayv2/lib/http/stage.d.ts` 62行 |
| `HttpStage` が `throttle` を `CfnStage.defaultRouteSettings` の `throttlingRateLimit` と `throttlingBurstLimit` に変換する | `aws-apigatewayv2/lib/http/stage.js`（1行に圧縮された実装） |
| `HttpApi` の `createDefaultStage` は既定で true | `aws-apigatewayv2/lib/http/api.d.ts` 109行 |
| `NodejsFunction`（`aws-cdk-lib/aws-lambda-nodejs`）が同じ版に含まれる | `aws-lambda-nodejs/lib/function.d.ts` 95行 |

採用する書き方: `HttpApi` を `createDefaultStage: false` で作り、`HttpStage` を `stageName: '$default'` と
`throttle: { rateLimit, burstLimit }` で明示的に作る。L1の `CfnStage` は使わない。

未確認: `createDefaultStage: true` のままで自前のステージを併用したときの動作。既定のステージとの衝突を避けるため、
上記の書き方にする。実際のスロットルの応答（429）はT052で確認する。

## T002 Ministackで確認できる範囲

結果: 判定と記録は完了した。フェーズ9への対応づけが一部残るため、タスクは `[ ]` のまま残す。

前提:

- `compose.yaml` の画像は `localstack/localstack:4.8.1` である。`docs/02` では「Ministack」と呼んでいて、
  `ministack:check` もこの画像名を要求する。以下、この画像を「エミュレーター」と呼ぶ。
- `compose.yaml` は変更していない。確認用に、リポジトリ外から同じ画像を次のサービス指定で一時的に起動した。
  `dynamodb,sqs,secretsmanager,lambda,apigateway,iam,logs`。ヘルスチェックで `edition: community`、`version: 4.8.1` を確認した。
- AWS CLIはエミュレーターのエンドポイントにだけ接続した。認証情報は扱っていない（後述の実行中の注意）。

確認結果:

| 項目 | 結果 | 確認方法 |
| --- | --- | --- |
| DynamoDB テーブル作成（パーティションキー `deliveryId`、オンデマンド） | 確認できた | `create-table` の結果が `ACTIVE` |
| TTL属性 `expiresAt` の設定 | 確認できた | `update-time-to-live` と `describe-time-to-live` で `ENABLED` |
| TTLによる期限切れ項目の削除 | 未確認 | 削除時刻は非同期で、本確認では検査していない。読み取り側の期限判定はユニットテストで確認する |
| 条件付き `PutItem`（`attribute_not_exists`、`expiresAt` が過去、`leaseUntil` が過去） | 確認できた | 新規は成功。期限内の処理中は `ConditionalCheckFailedException`。期限切れとlease切れは成功 |
| `ReturnValuesOnConditionCheckFailure: ALL_OLD` | 確認できた | 条件失敗の応答に既存項目が含まれた |
| 条件付き `UpdateItem` と `DeleteItem` | 確認できた | 条件が一致すれば成功。`leaseUntil` が無い項目の条件付き削除は失敗 |
| SQS 標準キューの作成と保持期間（345600秒） | 確認できた | `get-queue-attributes` で `MessageRetentionPeriod` を確認 |
| SSE-SQS の属性（`SqsManagedSseEnabled=true`） | 属性の保存のみ確認できた | 暗号化の実施はAWS側の動作のため、エミュレーターでは検証していない |
| SQS の `SendMessage` と `ReceiveMessage` | 確認できた | 送信した本文を受信で読み出せた |
| キューポリシー（`aws:SecureTransport` の Deny） | 保存のみ確認できた | `set-queue-attributes` の成功と読み出し。拒否の評価は未確認 |
| IAMポリシーの評価（最小権限による拒否） | 未確認 | 権限の無い主体で試すには認証情報が要る。認証情報を扱わない方針のため実施していない。Community版でIAM強制が有効かも、公式文書の該当箇所を取得できず確認できなかった |

フェーズ9への対応づけ:

| 項目 | 既存のタスク | 扱い |
| --- | --- | --- |
| Secretの権限の実効性、ログ書き込みの権限 | T051、T062 | 対応済み |
| テーブルとキューのIAM拒否 | なし | 確認項目の追加が必要 |
| キューポリシーのTLS拒否 | なし | 確認項目の追加が必要（案: 非TLSの `SendMessage` が拒否されることを実AWSで確認） |
| SSE-SQS の暗号化の実施 | なし | 確認項目の追加が必要（案: 実AWSでキュー属性を確認） |
| DynamoDB TTL による削除 | なし | 確認項目の追加が必要（案: 期限後の削除時刻を実AWSで観察） |

対応づけのない項目が4件あるため、T002 の完了条件（対応づけ済み）を満たさない。追加するかは人の判断になる（後述）。

## T003 6 MB付近の実効上限を測る方法

結果: 完了（測り方を決めた）。実効上限の値は未確認で、T055 で測る。

決定した判定方法:

1. `isBase64Encoded` が偽のとき: `Buffer.byteLength(body, 'utf8')` が `maxBodyBytes` を超えたら 413 とする。
2. `isBase64Encoded` が真のとき: 復元する前に、base64文字列から復元後のバイト長を計算する。
   - 文字列の長さが4の倍数で、末尾の `=` が0〜2個、それ以外がbase64の文字だけであることを確認する。
   - 復元後のバイト長は「長さ ÷ 4 × 3 − `=` の個数」で求める。`maxBodyBytes` を超えたら 413 とする。
   - 全文を走査する前に、文字列の長さが `ceil(maxBodyBytes / 3) * 4` を超えていれば 413 とする。
   - 基準を満たした場合だけ `Buffer.from(body, 'base64')` で復元する。上限を超える入力で大きなメモリを確保しないためである。
3. 判定は署名検証より前に行う（clarify の順1）。

境界の扱い: 上限ちょうど（6291456）は受理し、上限+1は 413 とする。`maxBodyBytes` の値の検証は設定契約（T006）で行う。

T012 の境界値テストの入力:

| 入力 | 期待 |
| --- | --- |
| `isBase64Encoded` が偽、UTF-8で6291456バイト | 受理 |
| `isBase64Encoded` が偽、6291457バイト | 413 `payload_too_large` |
| `isBase64Encoded` が真、復元後6291456バイト（末尾の `=` なし） | 受理 |
| `isBase64Encoded` が真、復元後6291457バイト | 413 `payload_too_large` |
| `isBase64Encoded` が真、復元後6291456バイトで末尾に `=` が1個 | 受理（`=` を数えて計算する） |
| `isBase64Encoded` が真、base64の文字以外を含む | 400 `payload_invalid`（人の判断、後述） |
| `isBase64Encoded` が真、長さが4の倍数でない | 400 `payload_invalid`（同上） |

T055 で実効上限を測る方法:

- API Gatewayへ送るbodyは、JSONのパディング用フィールドで長さを調整する。署名は実際のSecretで計算する。
  送るサイズは 6291455、6291456、6291457 バイトの3通りとし、実効上限を探すために 6000000、6200000 バイトも送る。
- 1回ごとの結果を次の3つで区別する。
  - API Gatewayが413を返し、Lambdaのログが出ていない。
  - API Gatewayが5xxを返し、Lambdaのログが出ていない。
  - Lambdaが呼ばれ、診断ログに `bodyBytes` が出る。
- ログに出すのはバイト数と `isBase64Encoded` の値だけで、本文は出さない。
- `Content-Type: application/json` の要求で、API Gatewayが `isBase64Encoded` を真にするかは未確認。T055 で記録する。

注意: Lambdaの同期呼び出しの上限6 MBは、イベントの形式（ヘッダーや `requestContext` を含む）を含めた全体に掛かる（A4）。
base64のbodyは元のバイト数より約33%大きくなる。したがって、実際に受け付けるbodyのバイト数は6291456より小さくなる可能性がある。
T055 の結果が6291456より小さい場合は、既定値を下げるかを人が判断する。

## T004 completed_at が null の completed の扱い

結果: 完了（規則とテスト入力を決めた）。実配信での発生は未確認で、T056 で確認する。

規則（plan.md の期限判定の仕様に従う）:

1. 時刻項目は `created_at`、`started_at`、`completed_at` のうち、ISO 8601 の日時文字列として解釈できる値を集める。
   null、欠落、解釈できない値は集めない。
2. 集めた値が1つも無いときは `payload_invalid`（400）とする。
3. 集めた値の最新を基準時刻とする。受信時刻との差の絶対値が3日（259200秒）を超えたら `expired`（400）とする。
   ちょうど3日は受理する。

テスト入力と期待結果（T016、T024 の入力に使う。時計は注入して固定する）:

| 番号 | action | created_at | started_at | completed_at | 期待 |
| --- | --- | --- | --- | --- | --- |
| 1 | queued | 現在の1時間前 | 欠落 | 欠落 | 受理（基準は created_at） |
| 2 | completed | 現在の1時間前 | 現在の30分前 | null | 受理（基準は started_at） |
| 3 | completed | 現在の3日より前 | 現在の3日より前 | null | `expired` |
| 4 | completed | 現在の3日より前 | 現在の1時間前 | null | 受理（基準は started_at） |
| 5 | completed | 現在の1時間前 | 現在の1時間前 | 現在の1時間前 | 受理（completed_at を含めて最新） |
| 6 | completed | 現在から3日ちょうど前 | 欠落 | 欠落 | 受理（境界） |
| 7 | completed | 現在から3日と1秒前 | 欠落 | 欠落 | `expired` |
| 8 | queued | 現在より3日と1秒後 | 欠落 | 欠落 | `expired`（未来の時刻も拒否） |
| 9 | queued | 解釈できない文字列 | 欠落 | 欠落 | `payload_invalid` |
| 10 | queued | 数値（例: 1700000000） | 欠落 | 欠落 | `payload_invalid`（文字列以外は解釈しない） |
| 11 | queued | 解釈できない文字列 | 現在の1時間前 | 欠落 | 受理（基準は started_at。不正な created_at は除外） |

注意点:

- 行11は規則の帰結である。G8 では `created_at` が全 action で必須かつnull不可のため、不正な `created_at` を受理するのは不自然である。
  この扱いは人の判断にする（後述）。
- 行3は、ジョブの開始から3日以上たってから配信が届いた場合の拒否である。GitHubの再配信は元の配信から3日以内に限られる（G4）。
  この条件が実際に起きるかは実配信で確認する（T056）。

## 人の判断が必要な項目

### 判断1: フェーズ9への確認項目の追加（T002）

| 選択肢 | メリット | デメリット |
| --- | --- | --- |
| A: 対応づけのない4項目（テーブルとキューのIAM拒否、キューのTLS拒否、SSE-SQS、TTL削除）をフェーズ9へ新規タスクとして追加する | 実AWSでの確認漏れが無い | tasks.md の変更が必要 |
| B: 追加せず、導入時の記録に任せる | tasks.md の構成を変えず、フェーズ1の範囲を守れる | 確認が漏れるおそれがある。T002 の完了条件を満たせない |

推奨: A。tasks.md の T002 は、対応づけ済みであることを完了条件にしている。B では T002 を完了にできない。
追加する項目の内容（確認方法と対象）は、A を選んだ後で作成する。

採用: A。フェーズ2の作業指示で、フェーズ9へ T063〜T066 を追加するよう指示された。

### 判断2: 不正なbase64の応答（T003）

| 選択肢 | メリット | デメリット |
| --- | --- | --- |
| A: 400 `payload_invalid` で拒否する | 形式の誤りは内容の誤りなので、400が意味に合う | clarify.md の応答の表に該当行が無く、行を追加する必要がある |
| B: 413 `payload_too_large` で拒否する | 表を変えずに済む | サイズの問題ではないのに、サイズの応答として扱うことになる |

推奨: A。clarify.md の応答の表に、順の行を追加する必要がある点を確認してほしい。

### 判断3: `created_at` が不正でも他の時刻があれば受理するか（T004 行11）

| 選択肢 | メリット | デメリット |
| --- | --- | --- |
| A: plan の規則どおり受理する | 規則が単純で、実装も単純 | 必須項目の不正を受理する |
| B: `created_at` が解釈できないときは `payload_invalid` にする | G8 の必須項目の定義と合う | plan の規則を変更する必要がある |

推奨: B。G8 では `created_at` が全 action で必須かつnull不可のため、不正な `created_at` は拒否するのが自然である。
ただし plan の規則を変えるため、人が決める。

### 判断4: 実効上限が6291456より小さい場合（T055）

T055 の結果が出てから判断する。今は選択肢を決められない。

## 実行中の注意

- エミュレーターの確認で、Docker コマンドに認証情報を環境変数として `export` する操作が、ホストの安全ポリシーで止められた。
  その後は `--no-sign-request` を付けた AWS CLI で、エミュレーターにだけ接続した。認証情報の内容は読んでいない。
- 既定プロファイルの認証セッションは期限切れだった。`--no-sign-request` を付けない呼び出しは
  `Your session has expired` で失敗した。実AWSには接続していない。`aws login` は利用者が行う操作のため、実施していない。
- 一時的に起動したエミュレーターのコンテナ（`t002-ministack`）は削除した。

## タスクの状態

| タスク | 状態 | 理由 |
| --- | --- | --- |
| T001 | 完了 | 上の根拠で、L2の `throttle` を採用する方式が1つに決まった |
| T002 | 完了 | フェーズ9へ T063〜T066 として対応づけた（判断1の選択肢Aを採用） |
| T003 | 完了 | 判定方法と境界値テストの入力を記録した。実効上限はT055で測る |
| T004 | 完了 | 規則と入力一覧を記録した。実配信での確認はT056で行う |

## フェーズ2 設定契約（T002の整理、T005〜T009）

作業場所は永続worktree（ブランチ `feature/issue-4-webhook`）。コミット、push、PR作成は行っていない。
AWS認証情報は読んでおらず、環境変数にも設定していない。実AWSには接続していない。

| タスク | 状態 | 理由 |
| --- | --- | --- |
| T002 の整理 | 完了 | 下の「T002 の整理」。フェーズ9へ T063〜T066 を追加した |
| T005 | 完了 | 設定例に `webhookReceiver` を追加した |
| T006 | 完了 | 設定検証の規則を加えた |
| T007 | 完了 | 異常系と正常系のテストを追加した |
| T008 | 完了 | 読込みと null 拒否を実装した。テストの追加は T009 に含まれる |
| T009 | 完了 | 依存の T060 を先に決めた。下の「T060 と T009」を参照 |

### T002 の整理

tasks.md の T002 のうち、実AWSでしか確認できない4項目を、フェーズ9の新しいタスクとして追加した。
各タスクに「実AWSでのみ実行。ローカルの完了条件には含めない」と書いた。既存の番号は変えていない。

| 項目 | 追加したタスク | 根拠（ファイル） |
| --- | --- | --- |
| テーブルとキューへのIAM拒否 | T063 | `specs/003-webhook-receiver/tasks.md`（フェーズ9） |
| キューの非TLS要求の拒否 | T064 | 同上 |
| キューのSSE-SQS暗号化 | T065 | 同上 |
| DynamoDB TTLによる期限切れ項目の削除 | T066 | 同上 |

Secretの権限の実効性（T051）とロググループへの書込み権限（T062）は、既存のタスクで対応済みである。
`plan.md` の「残る未整合」のT002の行も、対応先（T063〜T066）を書くよう更新した。

### T005 設定例に webhookReceiver を追加する

結果: 完了。

| 確認した点 | 根拠 |
| --- | --- |
| `webhookReceiver` に3項目が null で入っている | `config/github-app.example.json` 13〜17行 |
| `maxBodyBytes` は例に含めず、既定に任せている | 同上 |
| 設定例が検証を通る | `corepack pnpm github-app:check` の終了コード0 |

残件: なし。

### T006 設定検証に webhookReceiver の規則を加える

結果: 完了。

| 確認した点 | 根拠 |
| --- | --- |
| `allowedConfigKeys` に `webhookReceiver` を追加 | `scripts/github-app/validate-config.mjs` 19行 |
| 既定値（6291456）を定数として export し、読込み側から使う | 同 26行 |
| 必須3項目の一覧と、未知のキーの拒否 | 同 28〜29行、38〜46行 |
| 欠落、正の整数以外、null の扱い | 同 48〜55行。null はこの層では許す |
| `maxBodyBytes` の範囲（1以上6291456以下） | 同 57〜63行 |
| `burstLimit` が `rateLimit` 以上（両方が null でない場合だけ比べる） | 同 65〜69行 |
| 検証関数の呼び出し | 同 147行 |

`rejectForbiddenKeys` の正規表現（secret、token、password、private key、credential）は、
新しいキー名のいずれにも一致しない。`github-app:check` が通ることで確認した。

残件: なし。

判断した点（人の確認が要る場合は示す）:

- `maxBodyBytes` に null を指定すると拒否する。spec は「任意で既定値あり」としており、null の意味が定まらないため。
- `reservedConcurrency` の上限（アカウントの残りに依存する値）は検査しない。J-2 と plan.md の方針どおり。

### T007 設定検証の異常系テストを追加する

結果: 完了。`node --test` 全体で 67件すべて成功（追加前は 35件）。

| 確認した点 | 根拠 |
| --- | --- |
| 正常系: 3項目が正の整数、3項目が null、`maxBodyBytes` 省略と上限ちょうど | `test/github-app.test.mjs` 129〜147行 |
| 欠落（`webhookReceiver` 全体、配列・オブジェクト以外、3項目それぞれ） | 同 150〜166行 |
| 0、負数、小数、文字列、true（3項目それぞれ） | 同 161〜179行（ループで個別のテスト） |
| `maxBodyBytes` の 0、負数、小数、文字列、null、上限+1 | 同 181〜191行 |
| `burstLimit` が `rateLimit` 未満は拒否、同値は許可 | 同 193〜206行 |
| 未知のキー | 同 208〜214行 |
| エラーメッセージに値を含めない（小数の値が出ないこと） | 同 216〜228行 |

拒否ケースは `test()` を個別に呼んでおり、1ケースずつ失敗が分かれる。
テストの自己検査（規則を壊して失敗すること）は行っていない。

残件: なし。

### T008 設定の読込みと検証を実装する

結果: 完了。

| 確認した点 | 根拠 |
| --- | --- |
| `GitHubAppConfig` に `webhookReceiver` を加えた | `cdk/lib/github-app-config.ts` 10〜21行 |
| 3項目の未決（null または欠落）を拒否する関数を切り出した | 同 24〜43行（`assertWebhookReceiverDeployable`） |
| デプロイ経路（`false`）だけでその関数を呼ぶ | 同 62〜66行 |
| 返り値で `maxBodyBytes` の既定値を補う | 同 67〜73行 |
| `loadGitHubAppConfig` のシグネチャは変えていない | 同 49行 |
| エラーメッセージは項目名だけを出す | 同 39〜41行 |
| `cdk/bin` 配下を変更していない | `git status` で `cdk/bin` に差分が無いこと |

検証（リポジトリ外の一時コピーで実行し、削除した）:

| 呼び出し | 結果 |
| --- | --- |
| `loadGitHubAppConfig(true)` | 成功。3項目は null、`maxBodyBytes` は 6291456 |
| `loadGitHubAppConfig(false)`（組織名とロールARNをダミーに置換） | 失敗。3項目の名前だけを含むエラー |
| `assertWebhookReceiverDeployable` に3項目すべて正の整数 | 成功 |
| 同 3項目のうち1つが欠落 | 失敗。欠落した項目名だけを含むエラー |

残件:

- null を拒否する経路の自動テストは、T009 で作る。T009 は依存の T060 が未完了のため未着手である。
- 設定例の実値（組織名とロールARN）は未決のままなので、リポジトリ内の `loadGitHubAppConfig(false)` は
  プレースホルダーの検査で先に失敗する。null の検査は、この一時コピーの検証で確認した。

### T009 デプロイ経路が未指定を拒否するテストを追加する

結果: 完了。詳細は下の「T060 と T009」を参照。
以前の判断（A: T060 を先に決める、B: 後回し、C: 依存を外す）は、作業指示で A が採られた。

### 品質ゲート

フェーズの最後に `corepack pnpm quality` を一度だけ実行した。終了コードは 0。

| 検査 | 結果 |
| --- | --- |
| `node --test`（テストの内訳） | 67件すべて成功、0件失敗 |
| markdownlint（`docs:check`） | `Summary: 0 error(s)` |
| `cdk:check`（AWS認証なしのsynth） | 成功。CDK CLIの更新通知が出たが、失敗ではない |
| `ministack:check`、`security:check`、`foundation:check`、`format:check`、`lint`、`typecheck` | 成功 |

残件: T009 と、その前提の T060 の判断（上の「判断が必要な項目」）。

## T060 と T009（フェーズ2の残り）

作業場所は同じ worktree（ブランチ `feature/issue-4-webhook`）。コミット、push、PR作成はしていない。
AWS認証情報は読まず、AWS関連の環境変数も設定していない。テストと品質ゲートの実行では、
`CDK_DEFAULT_ACCOUNT` にダミーの12桁の数字（`<DUMMY_ACCOUNT_ID>`）だけを設定した。実AWSには接続していない。

### T060 テストが .ts を読み込む方式

結果: 完了。採用した方式は、子プロセスで `node --import tsx --input-type=module -e` を実行し、
子の中で `createRequire` を使って `.ts` を読む方式である。決定の記録は `plan.md` の「テストの .ts 読込み方式（T060）」。

根拠:

| 根拠 | 場所 |
| --- | --- |
| tsxのローダーをテストプロセスへ直接登録すると、CDKの読込みで循環参照により失敗した | `test/github-app-cdk.test.mjs` 6行目のコメント |
| 子プロセスで `node --import tsx` を実行する方式が、既存テストで動いている | `test/github-app-cdk.test.mjs` 33行目 |
| `.ts` は CJS として扱われる（`package.json` に `"type"` が無い）。ESMの `import()` では名前付きexportが `default` の下に入った | `package.json`。子プロセスで `Object.keys` を確認した結果は `[ 'default', 'module.exports' ]` |

採用の判断は、作業指示で採用が指定されたものである。T060 の完了条件の「サンプルの `.ts` を読み込む最小のテスト」は、
`test/webhook-config.test.mjs` の1件目（子プロセス経由で `.ts` の関数を呼ぶ）で満たした。

不採用の方式:

- `test` スクリプトに `--import tsx` を付ける方式。上の循環参照の経緯による。この方式は試していない。
- Node.js の型除去（`--experimental-strip-types`）。`engines` は `>=22.0.0` で、版と挙動の検証をしていない。

### T009 デプロイ経路の null 拒否テスト

結果: 完了。テストファイルは `test/webhook-config.test.mjs`（新規）。対象は `cdk/lib/github-app-config.ts` の
`assertWebhookReceiverDeployable`（31行目。T008 で切り出した、設定オブジェクトを引数に取る関数）。

テストの内訳:

| 検査 | 件数 | 結果 |
| --- | --- | --- |
| 3項目 それぞれが null（拒否し、項目名だけを出す） | 3 | 成功 |
| 3項目 それぞれが欠落（拒否し、項目名だけを出す） | 3 | 成功 |
| `webhookReceiver` 全体が欠落（3項目すべてを未指定として拒否） | 1 | 成功 |
| 3項目がすべて正の整数（受理） | 1 | 成功 |
| 子プロセス経由で `.ts` を読み込み、関数を呼べる（T060 の最小テスト） | 1 | 成功 |
| synth経路 `loadGitHubAppConfig(true)` が未決の3項目（null）を許す | 1 | 成功 |

拒否の検査は、`assertWebhookReceiverDeployable` の 38行目の `if (undecided.length > 0)` に依存する。
この行を一時コピーで `if (false && ...)` に書き換えると、null と欠落の7件が失敗した（残り3件は成功）。
リポジトリ内のファイルは変更していない。このことで、テストが null 拒否を実際に守っていることを確認した。

テストを子プロセスの関数呼び出しに限った理由: `loadGitHubAppConfig(false)` は、組織名とロールARNが
プレースホルダーのままだと、null の検査より前に失敗する（`cdk/lib/github-app-config.ts` 55〜60行目のプレースホルダーの検査）。
このため、デプロイ経路の全体をテストから通すことはできない。null の検査を関数に切り出し、直接テストした。

### 検証の結果

| 検査 | 結果 |
| --- | --- |
| `node --test`（全体） | 77件すべて成功、0件失敗（既存67件と新規10件） |
| 新規テストの整形と lint（`prettier --check`、`eslint`） | 成功 |
| `markdownlint-cli2`（specs の3文書） | 0 error(s) |
| `corepack pnpm quality`（一度だけ実行） | 終了コード0 |

### 変更したファイル

| ファイル | 変更 |
| --- | --- |
| `test/webhook-config.test.mjs` | 新規。T009 のテスト（10件） |
| `specs/003-webhook-receiver/plan.md` | 「テストの .ts 読込み方式（T060）」の節を追加 |
| `specs/003-webhook-receiver/tasks.md` | T060、T009 を `[x]` にした |
| `specs/003-webhook-receiver/implementation-log.md` | T009 の表と節を完了に更新し、この節を追加 |

### 残件と判断

判断が必要な項目はない。残件は次のとおり。

- デプロイ経路 `loadGitHubAppConfig(false)` の全体（実値での成功と失敗）は未テスト。組織名とロールARNの実値が決まった後に確認する。
- `.ts` を CJS として扱う前提は、`package.json` に `"type": "module"` を入れた場合の挙動を確認していない。
  その変更をする時点で、`createRequire` の読込みを再確認する。
- フェーズ3の T061（ESLintのglobals）は未着手。T010 の前に決める必要がある。

## フェーズ3 検証ロジック（T061、T010〜T026）

前回の実行が一時的な5xxで止まったため、作業ツリーの途中成果物を検証してから不足分を補った。
ゼロからは作り直していない。フェーズ4（T027以降）には手を付けていない。
AWS認証情報は読んでおらず、環境変数にも設定していない。実AWSには接続していない。コミットとpushはしていない。

### 途中成果物の評価

| 対象 | 評価 | 対応 |
| --- | --- | --- |
| `src/webhook/` の10ファイル | 完了条件の大半を満たしていた。T010〜T019 の実装は契約表（clarify.md）と一致した | 使った |
| `test/webhook-units.test.mjs`（T012〜T015、T018） | 26件中25件が成功。残り1件は別テストの失敗で、この検査は成功していた | 使った（整形のみ） |
| `test/webhook-config.test.mjs`（T009、T060） | 成功 | 使った |
| `test/webhook-dedupe.test.mjs`（T017） | `RETENTION_MS` が未定義で、読込みが失敗していた。保持期間の検査の一部も「1日」の値を使い、3日の境界を検査していなかった | 直した（定数を定義し、境界を `3日` と `3日+1ms` に揃えた） |
| `src/webhook/handler-core.ts` | 開始時刻の取得とヘッダーの読取りが `try` の外にあり、`event` が null のときや時計が例外を投げたときに500にならず、未処理の例外になっていた（T019 の「想定外の例外は500」に反する） | 直した（開始時刻と入力の読取りを `try` の中へ移し、経過時間は `Math.max(0, …)` で求める） |
| `test/support/webhook-harness.mjs` | 子プロセスの標準エラーを返せず、T023 の検査ができなかった。契約表を読むモードも無かった | 直した（`spawnSync` に変更し、`runInChildWithStderr` と `exports` モードを追加。既存の `runInChild` の戻り値は変えていない） |
| `src/webhook/expiry.ts`（T016） | 完了条件を満たしていた。テストが無かった | 使った。`test/webhook-expiry.test.mjs` で検査した |

### T061 ESLintのglobals

決定は `plan.md` の「T061 ESLintのglobalsの決定」に記録した。`test/**/*.mjs` だけに `Buffer` を追加する。
`eslint.config.mjs` は、この作業の前から同じ内容の変更が入っていた。今回は内容を確認し、変更していない。

### 完了したタスク

| タスク | 結果 | 検証 |
| --- | --- | --- |
| T061 | 完了 | `node_modules/.bin/eslint .` が成功（`Buffer` を使うテストを含む） |
| T010 | 完了 | `src/webhook/types.ts` に AWS SDK の import が無い（`grep` の結果は0件）。`tsc --noEmit` が成功 |
| T011 | 完了 | `test/webhook-contract.test.mjs` の「契約表」3件が、`clarify.md` の表（13行）と一致する |
| T012 | 完了 | 上限ちょうど、上限+1、base64の境界（末尾の `=` あり・なし、超過）を検査 |
| T013 | 完了 | 順2〜5の各不正、連結された署名、SHA-1だけの入力、大文字のヘッダー名を検査 |
| T014 | 完了 | 候補の一致パターンと呼び出し回数（全候補を比較、長さ違いは比較しない）を検査 |
| T015 | 完了 | 許可リストの項目、`installation`・`organization` の null、`repository` の欠落を検査 |
| T016 | 完了 | `test/webhook-expiry.test.mjs` の入力1〜15（T004の一覧と境界）を検査 |
| T017 | 完了 | `test/webhook-dedupe.test.mjs` で、確保、lease内の重複、lease失効後の再確保、解放の条件、保持期間の境界を検査 |
| T018 | 完了 | 診断のキーが許可リストに一致する |
| T019 | 完了 | 契約テストの全件（下記）で、ステータスと分類が契約表どおり |
| T020 | 完了 | 正常系で202、引き渡し1回、後続メッセージの項目、診断の内容を検査（base64の本文を含む） |
| T021 | 完了 | 12種類の拒否入力を検査。Secret取得の回数と引き渡し0回を確認 |
| T022 | 完了 | 同一配信の再受信（200）、処理中の重複（503、再入で検査）、引き渡し失敗（503）後の再受信（202）、done更新の失敗、想定外の例外（500） |
| T023 | 完了 | 複数の不正で先の順の分類、重複排除の失敗で500、秘密・署名・本文・ヘッダー値が応答、診断、標準エラーに出ないこと |
| T024 | 完了 | `test/webhook-expiry.test.mjs` の handler 経由の検査（期限切れは記録されない） |
| T025 | 完了 | AWSPENDINGが無い場合、両方の版で署名された配信、不一致で再取得しないこと（secretCalls=1）、両候補を比較（timingSafeEqualCalls=2） |
| T026 | 完了 | 正しい署名のpingは200で引き渡し0回。古い `workflow_job` を含むpingも200。不正な署名は401、不正なJSONは400 |

### 変異テスト（テストが検査として効いていることの確認）

リポジトリを変えずに、`/tmp/mut2` の複製で本体を1か所ずつ壊し、テストが失敗するかを確認した。

| 壊した箇所 | 結果 |
| --- | --- |
| `handler-core.ts` の ping の分岐を削除 | 契約テストで3件失敗 |
| `signature.ts` の比較を最初の一致で打ち切る | 単体テストで1件失敗（呼び出し回数の検査） |
| `expiry.ts` の境界を `>` から `>=` に変更 | 期限判定テストで5件失敗 |

### テストと品質ゲートの結果

| 検査 | 結果 |
| --- | --- |
| `node --test`（全体） | 170件すべて成功（0件失敗） |
| `node_modules/.bin/tsc --noEmit` | 成功 |
| `node_modules/.bin/eslint .` | 成功 |
| `node_modules/.bin/prettier --check` | 成功 |
| `corepack pnpm quality` | 後述（最後に1回だけ実行） |

途中で見つけた既存の不具合: 前回の作業で `implementation-log.md` に、ダミーの12桁の数字をそのまま書いていた。
公開情報の検査（`security-baseline.test.mjs`）が落ちたため、プレースホルダーに置き換えた。
同じ理由で、テストの配信IDも末尾を12桁の数字だけにしないよう英字を含めた。

### 判断が必要な項目

以下は、前回のフェーズ3で示された判断のうち未決のものである。今回の作業では決めていない。
現在の実装は、推奨ではなく暫定の扱いで動いている。

| 番号 | 内容 | 現在の実装 | 選択肢と推奨（前回の記録） |
| --- | --- | --- | --- |
| 判断2 | 不正なbase64の応答（T003） | `payload_invalid`（400） | 推奨は400。clarify.md の表に該当する行は無い。表への追加が必要 |
| 判断3 | `created_at` が解釈できず、他の時刻がある場合（T004の行11） | 受理する（plan の規則どおり） | 推奨は `payload_invalid`。G8では `created_at` が必須のため。plan の規則の変更が必要 |
| 判断4 | 6 MB付近の実効上限が既定値より小さい場合（T055） | T055 で測るまで保留 | 結果が出てから決める |

## フェーズ4 AWSアダプターとLambdaエントリ（T027〜T031）

作業場所は永続worktree（ブランチ `feature/issue-4-webhook`）。コミット、push、PR作成はしていない。
AWS認証情報は読んでおらず、`AWS_*` の変数を export も unset もしていない。`~/.aws` も読んでいない。
実AWSには接続せず、aws CLI も使っていない。`CDK_DEFAULT_ACCOUNT` はダミーの値だけを使った。

### 判断2と判断3の修正

判断2、判断3 を仕様どおりに修正した。

| 判断 | 修正内容 | 根拠（ファイルと行） |
| --- | --- | --- |
| 判断2: 不正な base64 は 400 `payload_invalid` | `clarify.md` の応答の表に行 `1a` を追加した。契約表の `payload_invalid` の順に `1` を加えた。表の検査は行ラベルに対応させ、14行を検査する。不正な base64 の2件を、Secret 取得0回で拒否する契約テストに加えた | `specs/003-webhook-receiver/clarify.md` 335行、`src/webhook/contract.ts` 20行、`test/webhook-contract.test.mjs`（不正な base64） |
| 判断3: `created_at` が解釈できなければ `payload_invalid` | `created_at` を必須として先に読む。解釈できなければ、`started_at` と `completed_at` が読めても拒否する。他の2項目は、解釈できない値を除外する（T004の規則のまま） | `src/webhook/expiry.ts` 34〜50行、`test/webhook-expiry.test.mjs`（入力11を `payload_invalid` に変更。入力16、17を追加） |

判断4（6 MB 付近の実効上限）は T055 の結果が要るため保留した。コードは変えていない。
本ログの T004 の表の行11（`created_at` が不正で `started_at` がある入力）は、判断3により `payload_invalid` になった。
上の表がその修正を示す。

### T032 依存の追加（一部）

結果: 3つの追加は完了。`esbuild` は未追加のため、T032 は `[ ]` のまま残した。

| 確認した点 | 根拠 |
| --- | --- |
| `@aws-sdk/client-dynamodb`、`@aws-sdk/client-secrets-manager`、`@aws-sdk/client-sqs` を、版 `3.1161.0` で完全固定して追加 | `package.json` の devDependencies。既存の依存と同じく完全固定（`--save-exact`） |
| ロックファイルを更新。`corepack pnpm install --frozen-lockfile` が成功（ロックファイルと一致） | `pnpm-lock.yaml`（+373行） |
| 型解決 | `tsc --noEmit` が成功。`ConditionalCheckFailedException.Item` は `client-dynamodb` の `errors.d.ts` 571行付近、`ResourceNotFoundException.name` は `client-secrets-manager` の `errors.d.ts` 92行付近で確認 |

`esbuild` を入れなかった理由: 今回の指示は3つの追加に限っていた。`esbuild` は `NodejsFunction` のバンドルに使うため、フェーズ5で扱う。

### T027 Secret の取得アダプター

結果: 完了。`src/webhook/secret-provider.ts`。

| 確認した点 | 根拠（ファイルと行） |
| --- | --- |
| `GetSecretValue` で `AWSCURRENT` と `AWSPENDING` を取得し、この順で返す | 同ファイル 26〜50行 |
| キャッシュは実行環境内のメモリで300秒。300秒ちょうどは有効、超えると再取得 | 同 6行（`SECRET_CACHE_TTL_MS`）、33行（`<= ttlMs`） |
| `AWSPENDING` の `ResourceNotFoundException` だけを平常扱いし、`AWSCURRENT` だけを返す | 同 41行、85行 |
| `AWSCURRENT` の失敗は `secret_unavailable`（503）。SDK のエラーは持ち越さず、値も ARN も例外に出ない | 同 38行、`SecretUnavailableError` |

検証: `test/webhook-adapters.test.mjs` の T027 の6件（300秒の境界、版の指定、不在、`AWSCURRENT` の失敗、`AWSPENDING` の他の失敗）が成功した。

### T028 DynamoDB の重複排除アダプター

結果: 完了。`src/webhook/dedupe-dynamodb.ts`。

| 確認した点 | 根拠（ファイルと行） |
| --- | --- |
| 確保は条件付き `PutItem`。条件は3つ（項目が無い、`expiresAt` を過ぎた、`processing` かつ `leaseUntil` を過ぎた） | 同 13行（`RESERVE_CONDITION_EXPRESSION`）、49行（`ALL_OLD`） |
| 秒の比較は、小数点以下3桁の文字列で行う（浮動小数点の誤差を入れない） | 同 `exactSecondsString` |
| 完了は `UpdateItem`、解放は `DeleteItem`。どちらも `leaseUntil` が一致するときだけ効く | 同 17行（`LEASE_MATCH_CONDITION_EXPRESSION`）、59行（`markDone`）、77行（`release`） |
| 保存する項目は `deliveryId`、`state`、`leaseUntil`、`receivedAt`、`expiresAt` だけ。`GetItem`、`Query`、`Scan` は使わない | 同 28〜35行。テストで発行コマンド名を検査 |

検証: T028 の テストは、新規、処理中、`leaseUntil` 失効後の再確保、処理済み、期限の境界（3日ちょうど、1ミリ秒後）、
完了と解放の不一致、発行コマンドを検査する（`test/webhook-adapters.test.mjs`）。
注意: テストの偽物は、この3つの式だけを評価する簡易な評価器である。実際の DynamoDB の条件評価は Ministack（T044）で確認する。
T044 はフェーズ6の作業のため、今回は実行していない。

### T029 SQS の送信アダプター

結果: 完了。`src/webhook/handoff-sqs.ts`。

| 確認した点 | 根拠（ファイルと行） |
| --- | --- |
| `SendMessage` を1回だけ使う | 同 39〜48行 |
| 本文は許可リストの項目だけ。型の項目を増減するとコンパイルエラーになる（`Record<keyof HandoffMessage, true>`） | 同 7〜21行（`HANDOFF_FIELDS`）、24〜30行（`toHandoffBody`） |
| 送信失敗は例外のまま渡し、ハンドラーが確保を解放して `handoff_failed`（503）にする | T030 の結合テストで確認 |

### T030 Lambda のエントリ

結果: 完了。`src/webhook/handler.ts`。

環境変数の名前は本フェーズで新しく決めた（判断C を参照）。

| 名前 | 内容 |
| --- | --- |
| `WEBHOOK_SECRET_ARN` | Secret の ARN |
| `WEBHOOK_DEDUPE_TABLE_NAME` | 重複排除テーブルの名前 |
| `WEBHOOK_HANDOFF_QUEUE_URL` | 後続キューの URL |
| `WEBHOOK_MAX_BODY_BYTES` | body 上限。数字だけ、1以上6291456以下 |

| 確認した点 | 根拠（ファイルと行） |
| --- | --- |
| 必須の値が空や未設定、上限が範囲外なら `startup_config_invalid` だけを例外にする。環境変数の名前も値も含めない | 同 `readRuntimeConfig`（41〜62行）、`StartupConfigError`（26〜32行） |
| 検査は `createLambdaHandler` の呼び出し時に行う。`export const handler` の読込み時に失敗する | 同 82行、120行 |
| SDK のクライアントは最初の呼び出しで作る。読込みの時点で AWS の設定を読まない | 同 84〜90行 |
| 診断は1行のJSONとして標準出力へ出す。`leaseSeconds` は Lambda のタイムアウト3秒 | 同 `dependenciesFor`（98〜110行）、`LAMBDA_TIMEOUT_SECONDS`（20行） |

検証: 結合テストで、SDK の偽物を組み込んだハンドラーを通した。受理は202、同じ配信IDは200の重複、送信失敗は503の
`handoff_failed` で、同じ配信IDの再試行は202、署名の不一致は401になった。Secret の取得は2回だけで、診断は6行、キーは許可リスト内だった。

### T031 アダプターの契約テスト

結果: 完了。`test/webhook-adapters.test.mjs`（30件）と、ハーネス `test/support/adapter-harness.mjs`。

- SDK のクライアントは子プロセスの中の偽物に差し替えた。偽物の `send` は、実際の SDK のコマンドクラスを受け取り、
  コマンド名と入力を記録する。子プロセスの環境は `PATH` だけにし、AWS 関連の変数は渡していない。
- 変異テスト（リポジトリ外の一時コピーで実施）: Secret のキャッシュを無効にし、SQS の本文の絞り込みを外した状態で、
  テストが4件失敗した。どちらの不具合も検出できることを確かめた。

### 検証

| 検査 | 結果 |
| --- | --- |
| `node --test`（全体） | 207件すべて成功、0件失敗 |
| `tsc --noEmit` | 成功 |
| `eslint test` | 成功（`src` は ESLint の対象外） |
| `corepack pnpm install --frozen-lockfile` | 成功 |

### フェーズ4で判断が必要な項目

以下は、実装の既定の選び方と、人が決める必要のある点である。推奨の方を実装している。

| 番号 | 内容 | 現在の実装 | 選択肢（メリット、デメリット）と推奨 |
| --- | --- | --- | --- |
| 判断A | `AWSPENDING` の取得が不在以外で失敗したとき | 503（`secret_unavailable`）で拒否する | A（実装）: 2版の検証を保証できない配信を受理しない。デメリット: 一時的な失敗で、正規の配信も落ちる。GitHub は自動で再配信しないため、運用者の再配信が要る。B: `AWSCURRENT` だけで検証して続行する。デメリット: ローテーション中に `AWSPENDING` で署名された配信が 401 になり、失敗が見えにくい。推奨: A。失敗は診断の分類で見え、再配信で復旧できる |
| 判断B | 起動失敗の分類 `startup_config_invalid` | 契約表（`clarify.md`）に無い。Lambda の初期化時の失敗として出す | A: 契約表に、HTTP 応答を伴わない「起動時」の行として登録する。B: 既存の `internal_error` で代用する。デメリット: 分類の意味が変わる。推奨: A。契約テストで固定できる |
| 判断C | 環境変数の名前 | 本フェーズで4つを新規に決めた（T030 の表） | 推奨: このまま採用する。フェーズ5の CDK が同じ名前で設定する必要がある。変えるなら、フェーズ4のテストと一緒に変える |
| 判断D | `esbuild` の追加（T032 の残り） | 未追加 | A: フェーズ5で `NodejsFunction` を書くときに追加する。B: 今追加する。推奨: A。今回の指示が3つの追加に限っていたため |

その他の未確認事項:

- Secret の値を平文の `SecretString` として扱っている。`docs/05` は値の形式（平文か JSON か）を明記していない。未確認。
- `plan.md` の期限判定の文言は、`created_at` が必須であることを明記していない。判断3の修正と文言を揃えるかは、人が決める。今回は変更していない。

### 残件

- T032 の `esbuild`（フェーズ5）。
- T044（フェーズ6）で、DynamoDB の条件式の実評価と、SQS の送受信を Ministack で確認する。
- 判断4（T055、実効上限）。
- 実AWSでの確認（フェーズ9）。
