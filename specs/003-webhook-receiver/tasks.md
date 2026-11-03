# Issue #4 実装タスク

## 位置づけ

`spec.md`、`clarify.md`、`plan.md` を入力に、実装タスクを順序付きで定める。
J-1〜J-5 は決定済みで、このタスクでは変更しない。
`analyze` と `implement` は別の工程で行う。この文書は実装の手順だけを定める。

### 決定の前提

| 番号 | 決定 |
| --- | --- |
| J-1 | 受信時刻と本文の時刻項目の差が3日を超えたら拒否する |
| J-2 | `rateLimit`、`burstLimit`、`reservedConcurrency` は顧客ごとの必須設定。未指定ならデプロイを失敗させる。品質ゲートのsynthだけ null を許す |
| J-3 | body上限は設定可能。既定は6 MB（6291456バイト） |
| J-4 | 後続への受け渡しはSQS標準キュー。DLQは本Specで作らない（Issue #5で定める） |
| J-5 | 診断ログ（Lambdaのロググループ）の保持期間は30日 |

### 書き方

- 各タスクは `T001` からの連番、チェックボックス、内容、対象ファイル、依存、完了条件で書く。
- 依存に書いたタスクが完了するまで、そのタスクに着手しない。
- 「ローカル」はAWS認証なしで実行できる検証、「実AWS」は実AWSまたは実際のGitHub Appでだけ確認できる検証を指す。
- 実AWSの確認は最後の「実AWSでのみ確認する項目」にまとめ、本Specでは実行しない。
- AWSアカウントID、実在するARN、Secretの実値は書かない。必要な箇所はプレースホルダー（`<SECRET_ARN>` など）を使う。

## フェーズ1 残った未整合の確認

`plan.md` の「残る未整合」4件を最初に確認する。結果は `plan.md` の「残る未整合」の表に反映する。
ローカルで結論が出る部分と、実AWSでしか確認できない部分を分けて記録する。

- [x] T001 CDK L2 でHTTP APIのステージにスロットルを設定できるかを確認する
  - 内容: `aws-cdk-lib` 2.177.0 の `aws-apigatewayv2` の型定義で、ステージの既定ルート設定に
    rate と burst を渡せるかを確認する。渡せない場合は L1 の `CfnStage` の `defaultRouteSettings` を使う。
  - 対象ファイル: `specs/003-webhook-receiver/plan.md`（結果の記録のみ）。型定義は読むだけで変更しない
  - 依存: なし
  - 完了条件: L2で可否のどちらかが、型定義のファイルとプロパティ名つきで `plan.md` に記録されている。
    採用する書き方（L2またはL1）が1つに決まっている。
    `aws-cdk-lib/aws-lambda-nodejs` が同じ版に含まれることも確認している。

- [x] T002 Ministackで確認できる範囲を確定する
  - 内容: `compose.yaml` の `SERVICES` は現状 `s3,lambda,apigateway,ec2,autoscaling,secretsmanager,cloudwatch,logs`
    で、DynamoDBとSQSを含まない。リポジトリを変更せず、リポジトリ外の一時的なcompose上書きで次を試す。
    DynamoDBの条件付き `PutItem`（`ConditionExpression`）、TTL属性の設定、SQSの `SendMessage` と受信、
    SQSの暗号化属性、IAMポリシーの評価。
  - 対象ファイル: `specs/003-webhook-receiver/plan.md`（結果の記録のみ）
  - 依存: なし
  - 完了条件: 項目ごとに「Ministackで確認できる」「できない」が `plan.md` に記録されている。
    できない項目は、フェーズ9のどのタスクで確認するかが対応づけられている。

- [x] T003 6 MB付近の実効上限と、body長の測り方を確定する
  - 内容: ローカルで決められる部分を決める。`isBase64Encoded` が真のとき、上限判定に使う長さを
    「受信した文字列の長さ」と「復元後のバイト長」のどちらにするか、または両方を見るかを決める。
    署名検証の前に判定することと、復元のメモリ確保を上限内に抑えることを満たす方式にする。
    API GatewayとLambdaが6 MB付近で実際に受け付ける上限は、ローカルでは確認できないため T055 に載せる。
  - 対象ファイル: `specs/003-webhook-receiver/plan.md`（結果の記録のみ）
  - 依存: なし
  - 完了条件: 長さの測り方が `plan.md` に記録され、T012 の完了条件に使える形（境界値つき）になっている。
    実効上限が未確認であることと、確認先が T055 であることが記録されている。

- [x] T004 `completed_at` が null の扱いを確定する
  - 内容: `plan.md` の期限判定は、`created_at`、`started_at`、`completed_at` のうち
    日時として解釈できる値の最新を使う。null、欠落、解釈できない値を「解釈できない」として除外する規則を、
    テスト入力の一覧（`created_at` のみ、`completed_at` が null、すべて不正など）として確定する。
    `completed_at` が null の `completed` が実際に届くかは、ローカルでは確認できないため T056 に載せる。
  - 対象ファイル: `specs/003-webhook-receiver/plan.md`（結果の記録のみ）
  - 依存: なし
  - 完了条件: テスト入力の一覧と期待結果が `plan.md` に記録され、T016 と T024 の入力に使える。
    実配信での発生有無が未確認であることと、確認先が T056 であることが記録されている。

## フェーズ2 設定契約（J-2、J-3）

- [x] T005 設定例に `webhookReceiver` を追加する
  - 内容: `webhookReceiver` オブジェクトを追加する。`rateLimit`、`burstLimit`、`reservedConcurrency` は
    実値を決めず null を置く。`maxBodyBytes` は任意項目で、例には含めず既定（6291456）に任せる。
  - 対象ファイル: `config/github-app.example.json`
  - 依存: なし
  - 完了条件: JSONとして有効で、実値の数値が入っていない。T006 の検証を通る。

- [x] T006 設定検証に `webhookReceiver` の規則を加える
  - 内容: `allowedConfigKeys` に `webhookReceiver` を追加し、`plan.md` の「検証の規則」を実装する。
    3つの必須項目のキーの存在を要求する。値は正の整数か null。未知のキーは拒否する。
    `maxBodyBytes` は1以上6291456以下の整数。`burstLimit` は `rateLimit` 以上。
    `reservedConcurrency` は正の整数だけを検査する（AWS側の上限は検査しない）。
  - 対象ファイル: `scripts/github-app/validate-config.mjs`
  - 依存: T005
  - 完了条件: `corepack pnpm github-app:check` が、null を持つ設定例で成功する。
    新しいキー名が `rejectForbiddenKeys` に当たらない。

- [x] T007 設定検証の異常系テストを追加する
  - 内容: `webhookReceiver` の欠落、必須キーの欠落、0、負数、小数、文字列、`maxBodyBytes` の上限超過、
    `burstLimit` が `rateLimit` 未満、未知のキーを、それぞれ拒否することを検査する。
    正常系として、3項目が正の整数の設定と、`maxBodyBytes` が6291456ちょうどの設定が通ることも検査する。
  - 対象ファイル: `test/github-app.test.mjs`
  - 依存: T006
  - 完了条件: `corepack pnpm test` で追加したテストが成功する。拒否ケースごとに別のテストか別のサブテストになっている。

- [x] T008 設定の読込みと検証を実装する
  - 内容: `GitHubAppConfig` に `webhookReceiver` を加える。デプロイ経路（`loadGitHubAppConfig(false)`）で、
    必須3項目のどれかが null または欠落ならsynthを開始せずに失敗させる。null の拒否判定は、
    設定オブジェクトを引数に取る関数に切り出してテストできるようにする。`loadGitHubAppConfig` の
    シグネチャは変えない。この範囲は設定の読込みと検証までとし、Stackへの受け渡し
    （`cdk/bin/app.ts`、`cdk/bin/check-app.ts`、検査専用の固定値）は T037 で行う。
  - 対象ファイル: `cdk/lib/github-app-config.ts`
  - 依存: T006
  - 完了条件: `loadGitHubAppConfig(true)` は null を許し、`loadGitHubAppConfig(false)` は null で例外を投げる。
    エラーメッセージに設定値が含まれない。`cdk/bin` 配下のファイルを変更していない。

- [x] T009 デプロイ経路が未指定を拒否するテストを追加する
  - 内容: T008 で切り出した関数に対し、3項目それぞれが null、欠落のとき失敗することを検査する。
    3項目が揃っているときは成功することも検査する。
  - 対象ファイル: `test/github-app.test.mjs`、または新規の `test/webhook-config.test.mjs`
  - 依存: T008、T060
  - 完了条件: 3項目 × (null、欠落) の拒否と、全項目指定時の成功が `corepack pnpm test` で成功する。

## フェーズ3 検証ロジック（ローカル）

AWS SDKに依存しない純粋な関数とポートの型を `src/webhook/` に置く。
Secret取得、重複排除、キュー送信はポートとして注入し、テストではメモリ実装に差し替える。

T060 と T061 は、T010 より前に決める項目として後から追加したため、番号が T060 以降になっている。
実行順は番号ではなく依存で決まる。

- [x] T060 テストが `.ts` を読み込む方式を決める
  - 内容: `test` スクリプトは `node --test` で、`test/` は `.mjs` だけである。`src/webhook/*.ts` と
    `cdk/lib/*.ts` をテストから読む方式を1つ決める。候補は次のとおり。
    `test` スクリプトに `--import tsx` を付ける。Node.js の型除去機能を使う（`package.json` の `engines` は
    `>=22.0.0` のため、使えるNode.jsの版を確認する）。`.ts` を子プロセスで読み込む既存方式
    （`test/github-app-cdk.test.mjs` の冒頭コメントのとおり、tsxのローダーをテストプロセスへ直接登録すると
    CDKの読込みで循環参照により失敗した）を、`src/webhook/` にも使う。`.mjs` から読める形に限定する。
    採用前に、既存の全テストが同じ方式で成功することを確認する。
  - 対象ファイル: `specs/003-webhook-receiver/plan.md`（採用した方式と理由の記録）。採用した方式に応じて `package.json`
  - 依存: なし
  - 完了条件: 採用した方式が `plan.md` に記録されている。サンプルの `.ts` を読み込む最小のテストで
    `corepack pnpm test` が成功し、既存のテストも成功する。

- [x] T061 ESLintのglobalsをテスト対象ファイルへ広げるか決める
  - 内容: `eslint.config.mjs` の `globals` は `URL`、`console`、`process` だけで、`no-undef` が有効である。
    新しいテストが使う `Buffer` などの参照が `no-undef` に当たるため、globalsを `**/*.mjs` 全体に広げるか、
    `test/**/*.mjs` だけに広げるかを決め、追加する名前を一覧にする。`.ts` は ESLint の対象外のままとするか
    （パーサーを追加しない）を併せて記録する。
  - 対象ファイル: `specs/003-webhook-receiver/plan.md`（決定の記録）。採用した決定に応じて `eslint.config.mjs`
  - 依存: なし
  - 完了条件: 決定と追加するglobalsの一覧が `plan.md` に記録されている。`Buffer` を使うサンプルの `.mjs` で
    `corepack pnpm lint` が成功する。

- [x] T010 ポートと型を定義する
  - 内容: Secret取得、重複排除ストア、後続キュー、時計、ログ出力のポートを定義する。
    API Gateway HTTP API payload format 2.0 の入力型（`body`、`isBase64Encoded`、小文字のヘッダー）と、
    応答型、診断の分類コードの型を定義する。
  - 対象ファイル: `src/webhook/types.ts`（新規）
  - 依存: T003、T004、T060、T061
  - 完了条件: `corepack pnpm typecheck` が成功する。ポートの型にAWS SDKの型が含まれない。

- [x] T011 応答と診断の契約を定数にする
  - 内容: `clarify.md` の「応答と診断の契約」の順1〜13と、署名ヘッダー欠落（`signature_missing`）、
    想定外の例外（`internal_error`）の、HTTPステータスと分類コードを定数の表にする。
  - 対象ファイル: `src/webhook/contract.ts`（新規）
  - 依存: T010
  - 完了条件: 表の行数と各行のステータス、分類コードが `clarify.md` と一致する。
    一致は T020〜T023 の契約テストで機械的に検査される。

- [x] T012 bodyの復元と上限判定を実装する
  - 内容: `isBase64Encoded` が真ならバイト列へ戻し、偽ならUTF-8のバイト列にする。
    上限判定は T003 で決めた測り方で、署名検証より前に行う（順1）。上限は設定値（既定6291456）。
  - 対象ファイル: `src/webhook/body.ts`（新規）
  - 依存: T011、T003
  - 完了条件: 上限ちょうど、上限+1、base64の場合の境界値で、受理と `payload_too_large`（413）が期待どおりになる。
    JSONのパースや再シリアライズを経ずに、受信したバイト列が署名計算へ渡る。

- [x] T013 ヘッダー検査を実装する
  - 内容: 順2〜5を実装する。`Content-Type` が `application/json`、`X-GitHub-Event` が `workflow_job` か `ping`、
    `X-GitHub-Delivery` がGUID形式、`X-Hub-Signature-256` が `sha256=` と64桁のhexで重複していない、を検査する。
    署名ヘッダーが無い場合は `signature_missing`（401）にする。`X-Hub-Signature`（SHA-1）は参照しない。
    この段階ではbodyの内容を使わない。
  - 対象ファイル: `src/webhook/headers.ts`（新規）
  - 依存: T011
  - 完了条件: 各検査の失敗が、契約表のステータスと分類コードになる。連結されたカンマ区切りの署名ヘッダーが拒否される。
    SHA-1のヘッダーだけを持つ入力が拒否される。

- [x] T014 HMAC検証を実装する
  - 内容: `node:crypto` の `timingSafeEqual` で、全候補（`AWSCURRENT`、`AWSPENDING`）に対して
    HMAC-SHA256を計算して比較する。一致しても途中で打ち切らず、結果を最後にまとめる。
    長さが異なる場合は比較せず不一致にする（例外を投げさせない）。
  - 対象ファイル: `src/webhook/signature.ts`（新規）
  - 依存: T011
  - 完了条件: 候補1つの一致、候補2つのうち後ろだけ一致、前だけ一致、両方不一致、長さ違いの署名が期待どおりになる。
    比較が全候補に対して実行されたことを、テストで検査できる（呼び出し回数）。
    `timingSafeEqual` をスパイし、呼ばれたことを検査する（`node:crypto` の `timingSafeEqual` を
    モジュールの名前空間経由で呼び、テストで差し替えられるようにする）。

- [x] T015 JSON検証と後続メッセージの許可リスト抽出を実装する
  - 内容: 署名検証後にJSONとしてパースし、不正なら `payload_invalid`（400）にする。この検証は `ping` にも適用する。
    JSON検証と抽出は別の関数にし、抽出は `workflow_job` だけに適用する（`ping` は対象外）。
    `plan.md` の「後続メッセージの契約」の項目だけを抽出する。`schemaVersion` は1。
    `installation` と `organization` は任意なので、無い場合は null にする。`repository` が無い場合は
    `payload_invalid` にする。bodyをそのまま渡さない。
  - 対象ファイル: `src/webhook/message.ts`（新規）
  - 依存: T011、T004
  - 完了条件: 許可リスト外の項目が出力に含まれない。`installation`、`organization` が無い入力で null になる。
    `repository` が無い入力が拒否される。`ping` は抽出の対象外であり、`workflow_job` を持たない `ping` の本文で
    抽出が呼ばれず、`payload_invalid` にならない（呼び分けはハンドラー側。T019、T026 で検査する）。

- [x] T016 期限判定を実装する（J-1）
  - 内容: `workflow_job` の `created_at`、`started_at`、`completed_at` のうち日時として解釈できる値の最新と、
    受信時刻の差の絶対値を求め、3日を超えたら `expired`（400）にする。解釈できる値が1つも無ければ
    `payload_invalid` にする。時計は注入する。T004 で確定した入力の一覧に従う。
    期限判定は `workflow_job` だけに適用し、`ping` は対象外とする（`ping` には「解釈できる時刻が無い」ことによる
    `payload_invalid` も適用しない）。
  - 対象ファイル: `src/webhook/expiry.ts`（新規）
  - 依存: T015、T004
  - 完了条件: 3日ちょうどは受理、3日を1ミリ秒超えると拒否、未来側の3日超も拒否される。
    `completed_at` が null でも、他の値で判定される。`ping` の本文（時刻項目なし）に対して、
    期限判定が呼ばれず、`expired` も `payload_invalid` も返らない（ハンドラー側の呼び分けは T019、T026 で検査する）。

- [x] T017 重複排除の判定ロジックを実装する
  - 内容: `plan.md` の状態遷移を、ストアのポートに対する関数として実装する。
    確保（`processing`、`leaseUntil`、`expiresAt` は処理時刻から3日）、完了（`done`）、
    確保時の `leaseUntil` は受信時刻にタイムアウト秒数（3秒）を足した値とし、秒数は引数で渡す、
    解放（`leaseUntil` が一致する場合だけ）。確保の条件は「項目が無い、または `expiresAt` を過ぎた、
    または `state` が `processing` かつ `leaseUntil` を過ぎた」とする。したがって、`leaseUntil` を過ぎた
    `processing` は再確保できる。既存項目が `done` なら `duplicate`（200）、`leaseUntil` を過ぎていない
    `processing` なら `duplicate_in_flight`（503）、`expiresAt` を過ぎた項目は新規として扱う。
    `ping` は記録しない。メモリ実装のストアも用意する。
  - 対象ファイル: `src/webhook/dedupe.ts`（新規）
  - 依存: T010
  - 完了条件: 新規、処理済み、処理中（`leaseUntil` 内）、解放後の再確保、期限切れ項目の再確保、
    lease失効後の再確保（`leaseUntil` を過ぎた `processing` を再確保できること）、
    他の試行の解放の拒否が、メモリ実装で期待どおりになる。時計は注入して境界（`leaseUntil` の直前と直後）を検査する。ストアに本文とヘッダー値が渡らない。

- [x] T018 診断ログを実装する
  - 内容: JSONの1行ログを出す。項目は診断の分類、HTTPステータス、検証済みの配信ID、所要時間、
    LambdaのリクエストIDだけとする。配信IDはGUID形式を検証した後に限って出す。
    例外は分類コードだけを出し、メッセージとスタックを出さない。
  - 対象ファイル: `src/webhook/diagnostics.ts`（新規）
  - 依存: T011
  - 完了条件: 出力のキー集合が許可リストに一致する。body、ヘッダー値、Secret、署名の途中の値が出力に現れない。

- [x] T019 ハンドラー本体を実装する
  - 内容: 順1〜13を、契約表の順序で実行する。失敗した時点で終了する。署名検証を通過するまでbodyの内容を使わない。
    `ping` は署名検証とJSON検証（順8）の後、順9で200（`ping_accepted`）として受理して終了し、後続へ渡さない。
    `ping` には `workflow_job` の抽出（T015）と期限判定（T016）を適用しない（順10は `workflow_job` だけ）。
    後続への受け渡しが失敗したら確保を解放して503（`handoff_failed`）。受け渡し成功後に `done` へ更新する。
    `done` の更新が失敗した場合は確保を解放して503にする（`plan.md` の「Issue #5への冪等性の要請」）。
    想定外の例外は500（`internal_error`）。期限切れと署名不一致は重複排除に記録しない。
  - 対象ファイル: `src/webhook/handler-core.ts`（新規）
  - 依存: T012、T013、T014、T015、T016、T017、T018
  - 完了条件: ポートをメモリ実装にしたまま、正常系、拒否系、再試行系の入力で、
    契約表のステータスと分類コードが返る。詳細は T020〜T026 で検査する。

- [x] T020 契約テスト: 正常系
  - 内容: 正しいSecretで署名した `workflow_job` が202になり、後続への引き渡しが1回であること、
    成功の診断が記録されること、診断にbodyとSecretが含まれないことを検査する。
    後続メッセージが許可リストの項目だけであることも検査する。
  - 対象ファイル: `test/webhook-contract.test.mjs`（新規）
  - 依存: T019
  - 完了条件: `corepack pnpm test` で成功する。引き渡し回数がちょうど1である。

- [x] T021 契約テスト: 拒否系
  - 内容: 次の入力を、ステータスと分類コードで検査する。いずれも引き渡し0回、ランナー起動に相当する処理の呼び出し0回。
    署名の欠落、形式不正、不一致。Secret取得の失敗（不在、権限なし）。期限切れ。上限超過（署名検証より前。
    Secret取得が呼ばれないことも検査する）。`workflow_job` と `ping` 以外のイベント。配信IDの欠落と形式不正。
    署名は正しいがJSONとして不正なbody（署名検証後に拒否）。`Content-Type` の不一致。
  - 対象ファイル: `test/webhook-contract.test.mjs`
  - 依存: T019
  - 完了条件: 入力ごとのテストが成功する。ヘッダーだけで判定できる不正（順3、順4、順5）と上限超過では、
    Secret取得が0回である。

- [x] T022 契約テスト: 再試行系と重複
  - 内容: 同じ本文の再受信（配信IDが変わっても同じ `bodyDigest`）で、引き渡しが二重にならず200（`duplicate`）になること。
    処理中の重複が503（`duplicate_in_flight`）になること。引き渡し失敗で503（`handoff_failed`）になり、
    確保が解放されて、次の同じ本文が重複扱いにならないこと。`done` 更新の失敗で確保が解放されること。
    再試行系の分類が、成功、拒否と区別できること。
  - 対象ファイル: `test/webhook-contract.test.mjs`
  - 依存: T019
  - 完了条件: 上記がすべて成功する。同一入力を再送した場合の引き渡し回数が期待どおり。

- [x] T023 契約テスト: 検査の順序とログの安全性
  - 内容: 順1〜13の入れ替えを検出する。たとえば、複数の不正が同時にある入力で、先の順の分類が返ること。
    すべての拒否と例外の経路で、標準出力と標準エラーを捕捉し、Secret、署名の値、bodyの内容、
    ヘッダー値が含まれないことを文字列検査する。想定外の例外で500になり、メッセージを出さないことも検査する。
  - 対象ファイル: `test/webhook-contract.test.mjs`
  - 依存: T019、T018
  - 完了条件: 順序検査と漏えい検査が成功する。検査に使うSecretは、ダミーの文字列である。

- [x] T024 契約テスト: 期限判定の境界
  - 内容: 3日ちょうど、3日超、未来側の3日超、`completed_at` が null、時刻がすべて不正、時刻が欠落、
    を時計を注入して検査する。T004 の入力の一覧をすべて使う。
  - 対象ファイル: `test/webhook-expiry.test.mjs`（新規）
  - 依存: T016、T019
  - 完了条件: T004 で記録した入力すべてについて、期待どおりのステータスと分類コードになる。

- [x] T025 契約テスト: ローテーション中の2版の検証
  - 内容: `AWSPENDING` が存在しない場合に `AWSCURRENT` だけで検証できること。
    `AWSCURRENT` で署名した配信と、`AWSPENDING` で署名した配信の両方が受理されること。
    どちらでも署名が一致しない場合に、Secretを再取得せず拒否すること。
  - 対象ファイル: `test/webhook-contract.test.mjs`
  - 依存: T014、T019
  - 完了条件: 3つの場合が成功する。不一致のとき、Secret取得ポートの呼び出し回数が増えない。

- [x] T026 契約テスト: `ping`
  - 内容: 正しい署名の `ping` が200（`ping_accepted`）で、引き渡しも重複排除の記録も0回であること。
    署名が不正な `ping` が401で拒否されることを検査する。テストの入力には、`workflow_job`、`repository`、
    時刻項目を持たない `ping` の本文を必ず含める。その入力で `expired` と `payload_invalid`（抽出由来）が
    返らないことを検査する。JSONとして不正な `ping` の本文は `payload_invalid`（400）になることも検査する。
  - 対象ファイル: `test/webhook-contract.test.mjs`
  - 依存: T019
  - 完了条件: 上記の入力が成功する。`workflow_job` を持たない `ping` の本文のテストが存在し、200を返す。

## フェーズ4 AWSアダプターとLambdaエントリ

- [x] T027 Secretの取得アダプターを実装する
  - 内容: `GetSecretValue` で `AWSCURRENT` と `AWSPENDING` を取得し、実行環境内のメモリに300秒キャッシュする。
    不一致を理由に再取得しない。`AWSPENDING` が存在しないときの `ResourceNotFoundException` は平常の状態として扱い、
    `AWSCURRENT` だけを返す。`AWSCURRENT` を取得できない場合は `secret_unavailable`（503）にする。
    AWS SDK v3 はランタイム同梱のものを使う方針だが、型解決のために `@aws-sdk/client-*` の
    devDependencies を T032 で追加する（esbuild がバンドル時に取り込むため実行時依存にしない。`plan.md` には記載が無い）。
  - 対象ファイル: `src/webhook/secret-provider.ts`（新規）
  - 依存: T010、T032
  - 完了条件: 実装が `corepack pnpm typecheck` を通る。次の挙動は T031 のテストで検査する。
    SDKクライアントを差し替えたテストで、300秒以内は再取得しないこと、300秒を超えると再取得すること、
    `AWSPENDING` の不在が失敗にならないこと、`AWSCURRENT` の失敗が503になることが成功する。
    ログと例外に、取得した値が出ない。

- [x] T028 重複排除のDynamoDBアダプターを実装する
  - 内容: 条件付き `PutItem`（項目が無い、または `expiresAt` を過ぎている、
    または `state` が `processing` かつ `leaseUntil` を過ぎた場合だけ成功）、失敗時に既存項目を返させる、
    `UpdateItem` で `done` にする、`leaseUntil` が一致する場合だけ `DeleteItem` で解放する。
    `GetItem`、`Query`、`Scan` を使わない。
  - 対象ファイル: `src/webhook/dedupe-dynamodb.ts`（新規）
  - 依存: T010、T017、T002、T032
  - 完了条件: 実装が `corepack pnpm typecheck` を通る。次の挙動は T031 のテストで検査する。
    SDKクライアントを差し替えたテストで、発行されるコマンドが `PutItem`、`UpdateItem`、`DeleteItem` だけである。
    確保の `ConditionExpression` が「項目が無い、または `expiresAt` を過ぎた、または `processing` かつ
    `leaseUntil` を過ぎた」の3条件を含み、`leaseUntil` を過ぎた `processing` を再確保できる。
    保存される属性が `bodyDigest`（キー）、`deliveryId`（診断用）、`state`、`leaseUntil`、`receivedAt`、`expiresAt` だけで、bodyとヘッダーを含まない。

- [x] T029 後続キューのSQSアダプターを実装する
  - 内容: `SendMessage` で、T015 の許可リストのメッセージ（`schemaVersion` 1、`bodyDigest` を含む）を送る。送信は `SendMessage` だけを使う。
  - 対象ファイル: `src/webhook/handoff-sqs.ts`（新規）
  - 依存: T010、T015、T032
  - 完了条件: 実装が `corepack pnpm typecheck` を通る。次の挙動は T031 のテストで検査する。
    SDKクライアントを差し替えたテストで、送信が1回で、本文が許可リストの項目だけであり、
    送信失敗が `handoff_failed` の経路に渡る。

- [x] T030 Lambdaのエントリを実装する
  - 内容: 環境変数（Secret ARN、テーブル名、キューURL、body上限）を読み、アダプターを組み立て、
    ハンドラー本体を呼ぶ。環境変数が欠けている場合は、起動時に分類コードだけで失敗する。
  - 対象ファイル: `src/webhook/handler.ts`（新規）
  - 依存: T019、T027、T028、T029
  - 完了条件: 環境変数を与えたテストでハンドラーが呼べる。環境変数の値がエラーに含まれない。
    `corepack pnpm typecheck` が成功する。

- [x] T031 アダプターの契約テストを追加する
  - 内容: T027〜T029 の完了条件に書いた挙動を、SDKクライアントを差し替えたテストとして1ファイルに統合する。
    T027〜T029 の完了条件のうち挙動に関する部分は、このタスクのテストで検査する（T027〜T029 は実装と
    `typecheck` まで）。T028 の `leaseUntil` 失効後の再確保も、このテストに含める。
    T002 でMinistackで確認できると判定した範囲は、フェーズ6で確認する。
  - 対象ファイル: `test/webhook-adapters.test.mjs`（新規）
  - 依存: T027、T028、T029
  - 完了条件: T027〜T029 の完了条件に挙げた挙動がすべてテストされ、`corepack pnpm test` で成功する。

## フェーズ5 AWS CDK

- [x] T032 依存を追加する
  - 内容: `esbuild` を devDependencies に追加する（`NodejsFunction` のバンドル用）。T027〜T029 の型解決のため、
    `@aws-sdk/client-secrets-manager`、`@aws-sdk/client-dynamodb`、`@aws-sdk/client-sqs` を devDependencies に追加する
    （追加する依存はこの3つに確定する）。Dockerでのバンドルは使わない。
  - 対象ファイル: `package.json`、`pnpm-lock.yaml`
  - 依存: T001
  - 完了条件: `corepack pnpm install --frozen-lockfile` が成功する。追加した版がロックファイルに固定されている。
    `corepack pnpm typecheck` が成功する。依存の追加はネットワークを使うが、AWS認証は使わない。

- [x] T033 読取りロールを `IRole` で受け取れるようにする
  - 内容: `GitHubAppIntegration` に `webhookReaderRoles?: iam.IRole[]` を追加する。Secretのリソースポリシーの
    Denyの `ArnNotLike` 条件へ、既存の文字列ARN（検証済み）に `role.roleArn` を連結して加える。
    文字列ARNの正規表現と `assertReaderRolesInAccount` は変更しない。
  - 対象ファイル: `cdk/lib/github-app-integration.ts`
  - 依存: なし
  - 完了条件: `webhookReaderRoles` を渡さない既存の呼び出しで、synth結果が変わらない。
    渡した場合に、`ArnNotLike` の値がロールの `Fn::GetAtt`（`Arn`）を含む。

- [x] T034 SQSキューとDynamoDBテーブルを作る
  - 内容: `WebhookReceiver` Constructに、標準キュー（保持4日、SSE-SQS、非TLSを拒否するキューポリシー、DLQなし）と、
    DynamoDBテーブル（パーティションキー `bodyDigest`、オンデマンド、TTL属性 `expiresAt`、削除ポリシー `DESTROY`）を作る。
    キューのARNとURLを非機密Outputで出し、説明に「Issue #5は `bodyDigest` で冪等に処理する」旨を書く。
  - 対象ファイル: `cdk/lib/webhook-receiver.ts`（新規）
  - 依存: T028、T029
  - 完了条件: synth結果に標準キュー1つ、テーブル1つがあり、TTL属性が `expiresAt` である。DLQと `RedrivePolicy` が無い。
    テーブルのパーティションキーが `bodyDigest` である。Outputの説明に冪等性の要請（`bodyDigest`）が含まれる。

- [x] T035 Lambda関数、ロググループ、権限を作る
  - 内容: `NodejsFunction`（Node.js 22、タイムアウト3秒、予約同時実行数は設定値）を作る。環境変数にSecret ARN、
    テーブル名、キューURL、body上限を渡す。ロググループを明示的に作り、保持期間を30日にする（J-5）。
    ロググループは `logGroup` プロパティで関数に渡す。
    受け取った `iam.IRole` を実行ロールに使い、権限を `addToPrincipalPolicy` で付ける。
    CDKは独自のロールを渡すと `AWSLambdaBasicExecutionRole` を付けないため（`plan.md` の「実行ロールのログ書き込み権限」）、
    ログの権限を明示的に加える。`logs:CreateLogStream` と `logs:PutLogEvents` を、このロググループのARNだけに許可する。
    `logs:CreateLogGroup` は付与しない。
    Secretは `GetSecretValue` を固定のSecret ARNだけ、テーブルは `PutItem`、`UpdateItem`、`DeleteItem` を固定のARNだけ、
    キューは `SendMessage` を固定のARNだけにする。`*` を使わない。
  - 対象ファイル: `cdk/lib/webhook-receiver.ts`
  - 依存: T030、T032、T033、T034
  - 完了条件: synth結果のLambdaが上記の設定を持ち、ロググループの `RetentionInDays` が30である。
    ロールに `logs:CreateLogStream` と `logs:PutLogEvents` があり、Resourceがロググループの参照だけである。
    IAMのActionに `PutSecretValue`、`UpdateSecretVersionStage`、`DeleteSecret`、`ListSecrets`、`DescribeSecret`、
    `Scan`、`Query`、`GetItem` が無い。

- [x] T036 HTTP API、スロットル、Outputを作る
  - 内容: HTTP API（payload format 2.0）、`POST` の1ルート、`$default` ステージ（自動デプロイ）を作る。
    スロットルは T001 で決めた書き方で、`rateLimit` と `burstLimit` を設定する。アクセスログは有効にしない。
    `GitHubAppWebhookUrl` に、エンドポイントURLとルートパスを連結して出力する。
  - 対象ファイル: `cdk/lib/webhook-receiver.ts`
  - 依存: T001、T035
  - 完了条件: synth結果にHTTP API、`POST` ルート1つ、ステージの既定ルート設定のレートとバーストがある。
    `GitHubAppWebhookUrl` のOutputがある。アクセスログの設定が無い。

- [x] T037 FoundationStackへ必須設定を追加し、既存テストを更新する
  - 内容: `FoundationStack` が権限ポリシーを持たないLambda用ロール（信頼先は `lambda.amazonaws.com`、名前は固定しない）を
    先に作り、`GitHubAppIntegration` と `WebhookReceiver` の両方へ渡す。`webhookReceiver` の設定値を必須の引数として受け取る。
    Stackへの受け渡しは `cdk/bin/app.ts`（デプロイ経路。設定の3項目が揃わなければ失敗）と
    `cdk/bin/check-app.ts`（品質ゲート用。検査専用の固定値だけを渡す。この固定値は `check-app.ts` にだけ置き、
    `app.ts` から参照しない）で行う。引数が増えた影響を受ける `test/github-app-cdk.test.mjs` を、同じタスクで更新する。
  - 対象ファイル: `cdk/lib/foundation-stack.ts`、`cdk/bin/app.ts`、`cdk/bin/check-app.ts`、
    `test/github-app-cdk.test.mjs`
  - 依存: T008、T033、T035、T036
  - 完了条件: `corepack pnpm cdk:check` がAWS認証なしで成功する。必須設定を省略したときの扱いが次のとおりである。
    デプロイ経路（`app.ts`）は設定の3項目のどれかが null または欠落ならsynthを開始せず失敗する。
    品質ゲートのsynth（`check-app.ts`）は null を許し、固定値でsynthできる。
    更新後の `test/github-app-cdk.test.mjs` が `corepack pnpm test` で成功し、既存のSecretとOutputの検査が変わらない。

- [x] T038 CDKアサーション: リソース構成とOutput
  - 内容: API（種類、ルート、スロットル）、Lambda（ランタイム、タイムアウト3秒、予約同時実行数）、
    テーブル（TTL、キー、課金）、キュー（保持、暗号化、DLQなし）、ロググループ（30日）、
    `GitHubAppWebhookUrl` のOutputを検査する。
  - 対象ファイル: `test/webhook-cdk.test.mjs`（新規）
  - 依存: T037
  - 完了条件: `corepack pnpm test` で成功する。受け入れ条件の「Outputが存在する」が検査される。

- [x] T039 CDKアサーション: IAMの最小権限
  - 内容: Lambdaロールの全ポリシー文を取り出し、Secretは `GetSecretValue` のみで対象がSecretの参照だけであること、
    テーブルとキューが固定の参照で、許可するActionが計画どおりであること、書き込み系のSecret操作が無いこと、
    `Resource` に `*` が無いことを検査する。許可リストに `logs:CreateLogStream` と `logs:PutLogEvents` を加え、
    その `Resource` がロググループの参照だけであること、`logs:CreateLogGroup` が無いことを検査する
    （ロググループARNの末尾が `:*` の形になる場合は、ロググループ配下に限られるため許可し、Resource全体が `*` のものを拒否する。
    形はsynth結果で確認する）。
  - 対象ファイル: `test/webhook-cdk.test.mjs`
  - 依存: T037
  - 完了条件: 上記が成功する。`*` を含むポリシー文の入力で検査が失敗することを、テストの自己検査で確認する。

- [x] T040 CDKアサーション: Secretのリソースポリシーと依存グラフ
  - 内容: Secretのリソースポリシーの `ArnNotLike` が、管理者ロール、追加ロール、Lambdaロールの `Fn::GetAtt` を含むことを検査する。
    テンプレートの `Ref`、`Fn::GetAtt`、`DependsOn` から依存グラフを作り、循環が無いことを検査する。
    synthの成功だけを根拠にしない。
  - 対象ファイル: `test/webhook-cdk.test.mjs`
  - 依存: T037
  - 完了条件: 循環の検査が成功する。循環を含む小さなテンプレートの入力で検査が失敗することを、同じテストで確認する。

- [x] T041 CDKアサーション: 設定必須、再現性、秘密値の不在
  - 内容: デプロイ経路で3項目のどれかが null だとsynthが始まらず失敗すること（T009 と合わせて、`cdk/bin/app.ts` の
    実行で確認する）。synthがAWS認証なしで成功し、`cdk.context.json` を生成しないこと。
    生成したテンプレートに、Secretの実値、ダミーの署名、12桁の数字が含まれないこと。
  - 対象ファイル: `test/webhook-cdk.test.mjs`
  - 依存: T037、T009
  - 完了条件: 上記が成功する。AWS関連の環境変数を空にした状態でも成功する。

- [x] T042 既存テストの更新を確認し、品質スクリプトを更新する
  - 内容: `test/github-app-cdk.test.mjs` の更新は T037 で行った。ここでは、その更新後のテストが成功することを
    確認するだけにする。必須成果物の一覧に
    `specs/003-webhook-receiver/spec.md`、`clarify.md`、`plan.md`、`tasks.md`、`cdk/lib/webhook-receiver.ts`、
    `src/webhook/handler.ts` を追加する。`run-cdk-check.mjs` に、`GitHubAppWebhookUrl` のOutputの存在検査を加える。
  - 対象ファイル: `scripts/quality/check-structure.mjs`、`scripts/quality/run-cdk-check.mjs`
    （`test/github-app-cdk.test.mjs` は確認のみで変更しない）
  - 依存: T037
  - 完了条件: `corepack pnpm foundation:check` と `corepack pnpm cdk:check` が成功する。
    既存のSecretとOutputのテストが変更後も成功する。

## フェーズ6 Ministack（ローカルのエミュレーター）

T002 の結論に従う。確認できないと判定された項目は、このフェーズでは扱わず、フェーズ9へ移す。

- [ ] T043 Ministackの対象サービスを更新する
  - 内容: `compose.yaml` の `SERVICES` に、T002 で確認できると判定したサービス（DynamoDB、SQSなど）を追加する。
    AWS認証情報を `compose.yaml` に書かない。
  - 対象ファイル: `compose.yaml`
  - 依存: T002
  - 完了条件: `corepack pnpm ministack:check` が成功する。`compose.yaml` に認証情報の記述が無い。

- [ ] T044 Ministackでの動作確認テストを追加する
  - 内容: T002 で「確認できる」とした範囲で、DynamoDBの条件付き書き込み（新規、処理済み、処理中、期限切れ、`leaseUntil` 失効後の再確保）と
    SQSの送受信を、T028 と T029 のアダプターで確認する。Dockerが必要なため、環境変数で有効にした場合だけ実行し、
    既定の `corepack pnpm test` ではスキップする。
  - 対象ファイル: `test/ministack/webhook-adapters.test.mjs`（新規）
  - 依存: T043、T028、T029
  - 完了条件: Ministackを起動して有効にした場合に成功する。無効の場合はスキップとして報告され、失敗にならない。
    実行手順がテストファイルの冒頭に書かれている。

## フェーズ7 文書

- [ ] T045 ローテーション手順にキャッシュ待ちを追記する
  - 内容: `docs/05` の「ローテーション」を、`plan.md` の「未整合2の解決方針」のとおり修正する。
    手順2と手順3の間に、Lambdaのキャッシュへ `AWSPENDING` が反映されるまで300秒以上待つことを加える。
    手順3〜5で反映前に拒否された配信は手順5の再配信で復旧すること（過去3日分）を加える。
    手順6で昇格後もキャッシュが最大300秒古い版を保持することと、昇格後300秒は旧版を使う配信が無いことの確認を加える。
    手順7でGitHub側を現行版へ戻す場合は反映待ちが要らないことを加える。
  - 対象ファイル: `docs/05-GitHub AppとWebhook導入手順.md`
  - 依存: T027
  - 完了条件: 「300秒」が手順2と3の間、手順6、手順7に記載されている。`corepack pnpm docs:check` と
    `corepack pnpm security:check` が成功する。

- [ ] T046 Lambdaロールと登録手順の記述を直す
  - 内容: 「権限」の最後の項目（Webhook処理ロールを `additionalReaderRoleArns` に追加する）を、
    Stack内のロールが自動で追加されること、`additionalReaderRoleArns` は人間の運用ロール用であることに直す。
    「リソースポリシー」の節の同じ趣旨の記述も直す。登録手順6に、`ping` が署名検証後に200で受理されること、
    GitHub AppのWebhookの Content type を `application/json` にすることを加える。
  - 対象ファイル: `docs/05-GitHub AppとWebhook導入手順.md`
  - 依存: T037
  - 完了条件: 誤解を招く記述が無くなっている。`corepack pnpm docs:check` が成功する。

- [ ] T047 `webhookReceiver` の設定項目と既存設定の移行を追記する
  - 内容: `rateLimit`、`burstLimit`、`reservedConcurrency`、`maxBodyBytes` の意味、必須か任意か、
    未指定ならデプロイが失敗すること、値の見積もりの考え方（`clarify.md` J-2）を新しい節に書く。
    導入済みの顧客の設定に `webhookReceiver` を追加する移行手順を書く。値の例は実在の値にせず、プレースホルダーにする。
  - 対象ファイル: `docs/05-GitHub AppとWebhook導入手順.md`
  - 依存: T008
  - 完了条件: 4項目が表で説明されている。移行手順がある。`corepack pnpm docs:check` と `security:check` が成功する。

- [ ] T048 再配信の手順と、導入時の実AWS確認事項を追記する
  - 内容: 429（API Gatewayのスロットル）、Lambdaの予約同時実行数によるスロットル、503で拒否された配信は、
    GitHubが自動で再配信しないため、運用者が再配信する手順を書く。J-2 の値を小さくしすぎると
    正規の配信を失うことを書く。フェーズ9の確認項目を「導入時の確認事項」として一覧にする。
  - 対象ファイル: `docs/05-GitHub AppとWebhook導入手順.md`
  - 依存: T036、T039
  - 完了条件: 再配信の手順と、フェーズ9の全項目に対応する確認事項が記載されている。
    `corepack pnpm docs:check` と `security:check` が成功する。

- [ ] T049 J-5 の反映と T001〜T004 の結果の反映を確認する
  - 内容: J-5（30日）の反映は、analyze の指摘への修正で `spec.md`、`clarify.md`、`plan.md`、`tasks.md` に済ませてある。
    ここでは確認だけを行う。J-5 が4つの文書で決定済み・30日として一致していること、30日が T035 の値と一致することを確認する。
    あわせて、T001〜T004 の結果が `plan.md` の「残る未整合」の表に反映されていることを確認する。
  - 対象ファイル: `specs/003-webhook-receiver/plan.md`、`specs/003-webhook-receiver/clarify.md`
    （確認のみ。不一致があれば直す）
  - 依存: T001、T002、T003、T004
  - 完了条件: J-5 が決定済みとして4つの文書に記載され、30日が T035 の値と一致する。
    T001〜T004 の結果が「残る未整合」に反映されている。`corepack pnpm docs:check` が成功する。

## フェーズ8 品質ゲート

- [ ] T050 品質ゲートを実行し、失敗を修正する
  - 内容: `corepack pnpm quality` を実行する。内訳は `format:check`、`lint`、`typecheck`、`test`、`foundation:check`、
    `security:check`、`github-app:check`、`docs:check`、`cdk:check`、`ministack:check`。失敗は原因を修正して再実行する。
  - 対象ファイル: 失敗の原因になったファイル
  - 依存: T001〜T049、T060、T061
  - 完了条件: `corepack pnpm quality` が終了コード0で終わる。`security:check` が、この文書と追加した文書、
    設定、テストで成功する。

## フェーズ9 実AWSでのみ確認する項目（本Specでは実行しない）

このフェーズのタスクは、実AWSまたは実際のGitHub Appでだけ確認できる。

| タスク | 状態 |
| --- | --- |
| T051〜T059、T062〜T066 | 未実施。実AWSでのみ実行する。ローカルの完了条件には含めない |

本Specの作業では実行しない（`spec.md` の対象外）。T048 で `docs/05` に確認事項として記載することだけを、
本Specの範囲とする。チェックボックスは未完了のまま残し、導入時に別の作業で実施する。
T002 でMinistackでは確認できないと判定された項目があれば、このフェーズへ追加する。

- [ ] T051 Secretのリソースポリシーの実効性を確認する
  - 内容: LambdaロールのAssumeRole後の呼び出しが許可され、他の主体が拒否されることを確認する。
  - 対象: 実AWS（Secrets Manager、IAM）
  - 依存: T050
  - 完了条件: Lambda経由の取得が成功し、Lambdaロール以外の取得が拒否される。結果が導入記録に残る。

- [ ] T052 スロットルの実際の応答を確認する
  - 内容: API Gatewayのスロットルによる429と、予約同時実行数によるLambdaのスロットルの実際の応答を確認する。
  - 対象: 実AWS（API Gateway、Lambda）
  - 依存: T050
  - 完了条件: 設定した上限を超えたときの応答と、GitHubが自動で再配信しないことによる欠落の扱いが記録されている。

- [ ] T053 予約同時実行数の設定範囲を確認する
  - 内容: 設定値が、アカウントの未予約の同時実行数から100を引いた範囲に収まることを確認する。
  - 対象: 実AWS（Lambdaのアカウント設定）
  - 依存: T050
  - 完了条件: デプロイが成功する。範囲を超える値でデプロイが失敗することを確認する場合は、その結果が記録されている。

- [ ] T054 3秒のタイムアウトの妥当性を確認する
  - 内容: コールドスタートを含めて、Secret取得、DynamoDB、SQSの処理が3秒に収まるかを実測する。
  - 対象: 実AWS（Lambda）
  - 依存: T050
  - 完了条件: 実測値が記録されている。不足なら10秒未満の範囲で変更し、理由を `plan.md` に記録する。

- [ ] T055 6 MB付近のbodyの実際の挙動を確認する
  - 内容: API GatewayとLambdaが、6 MB付近のbodyを実際にどこまで受け付けるかを確認する（T003 の確認先）。
  - 対象: 実AWS（API Gateway、Lambda）
  - 依存: T050
  - 完了条件: 受け付けられる実効的な上限が記録されている。`maxBodyBytes` の既定との差があれば、扱いが記録されている。

- [ ] T056 `completed_at` が null の `completed` の配信を確認する
  - 内容: 実際の配信で、`completed_at` が null の `completed` が届くかを確認する（T004 の確認先）。
  - 対象: 実際のGitHub App
  - 依存: T050
  - 完了条件: 届くかどうかが記録されている。届き、かつ期限判定で拒否される場合は、対応が別の判断として記録されている。

- [ ] T057 GitHub Appに登録した後の `ping`、署名つき配信、再配信を確認する
  - 内容: `GitHubAppWebhookUrl` を登録し、`ping`、`workflow_job` の署名つき配信、再配信が期待どおりに処理されることを確認する。
  - 対象: 実際のGitHub App
  - 依存: T050
  - 完了条件: `ping` が200、署名つき配信が202、再配信が200（重複）になることが配信履歴で確認されている。

- [ ] T058 ローテーション中の `AWSPENDING` の受理とキャッシュの反映を確認する
  - 内容: T045 の手順で、`AWSPENDING` が300秒以内に反映され、受理されることを確認する。
  - 対象: 実AWS（Secrets Manager）、実際のGitHub App
  - 依存: T050
  - 完了条件: 反映までの時間と、反映前に拒否された配信の再配信による復旧が記録されている。

- [ ] T059 CloudTrailへの `GetSecretValue` の記録を確認する
  - 内容: Lambdaロールによる取得が記録され、取得頻度が実行環境ごとに300秒ごと以下であることを確認する。
  - 対象: 実AWS（CloudTrail）
  - 依存: T050
  - 完了条件: 記録の有無と頻度が記録されている。

- [ ] T062 ロググループへの書き込み権限を確認する
  - 内容: デプロイしたLambdaを呼び、実行ロールの `logs:CreateLogStream` と `logs:PutLogEvents` で
    ロググループにログが書かれること、保持期間が30日であること（J-5）を確認する。
  - 対象: 実AWS（Lambda、CloudWatch Logs）
  - 依存: T050
  - 完了条件: ログが書かれ、診断の分類が確認できる。保持期間が30日である。結果が導入記録に残る。

- [ ] T063 テーブルとキューへのIAM拒否を確認する
  - 内容: Lambdaロールに許可していない操作（テーブルの `Scan`、`Query`、`GetItem`、キューの `ReceiveMessage`）が
    AccessDeniedになることを確認する。許可した操作（`PutItem`、`UpdateItem`、`DeleteItem`、`SendMessage`）は成功すること。
  - 対象: 実AWS（IAM、DynamoDB、SQS）。実AWSでのみ実行。ローカルの完了条件には含めない
  - 依存: T050
  - 完了条件: 許可した操作の成功と、許可していない操作のAccessDeniedが導入記録に残る。

- [ ] T064 キューの非TLS要求の拒否を確認する
  - 内容: キューポリシーの `aws:SecureTransport` のDenyが、非TLSの要求を拒否することを確認する。
    確認の方法は、IAMポリシーシミュレーターか非TLSの要求の送信のどちらかを選び、導入記録に残す。
  - 対象: 実AWS（SQS）。実AWSでのみ実行。ローカルの完了条件には含めない
  - 依存: T050
  - 完了条件: 非TLSの要求が拒否されたこと、および使った確認の方法が導入記録に残る。

- [ ] T065 キューのSSE-SQS暗号化を確認する
  - 内容: キューの属性で `SqsManagedSseEnabled` が `true` であることを確認する。
    ローカル（Ministack）では属性の保存だけ確認でき、暗号化の実施は確認していない（implementation-log.md の T002）。
  - 対象: 実AWS（SQS）。実AWSでのみ実行。ローカルの完了条件には含めない
  - 依存: T050
  - 完了条件: 属性の値が導入記録に残る。

- [ ] T066 DynamoDBのTTLによる期限切れ項目の削除を確認する
  - 内容: `expiresAt` を過ぎた項目が削除されるまでの時間を、実AWSで観察する。
    TTLの削除は遅れるため、読み取り側の期限判定（T016、T017）は削除に依存しない設計であることを前提とする。
  - 対象: 実AWS（DynamoDB）。実AWSでのみ実行。ローカルの完了条件には含めない
  - 依存: T050
  - 完了条件: 期限切れ項目の削除までの遅れが導入記録に残る。

## 受け入れ条件との対応表

`spec.md` の「受け入れ条件」の各項目と、検証するタスクの対応を示す。
ローカルで検証できる項目は、AWS認証なしの自動テストで検証される。

| 区分 | 受け入れ条件 | 検証するタスク | 検証の場所 |
| --- | --- | --- | --- |
| 正常系 | 正しい署名の `workflow_job` で2xxを返し、引き渡しが1回 | T020、T019 | ローカル |
| 正常系 | 成功の診断が記録され、bodyとSecretを含まない | T020、T018、T023 | ローカル |
| 正常系 | synth結果に `GitHubAppWebhookUrl` のOutputがある | T036、T038、T042 | ローカル |
| 正常系 | LambdaロールのSecret権限が対象の読取りに限定される | T035、T039 | ローカル（実効性はT051） |
| 拒否系 | 署名ヘッダーの欠落、形式不正、不一致を拒否し、引き渡し0回 | T021、T013、T014、T025 | ローカル |
| 拒否系 | Secret取得失敗で拒否または失敗応答、引き渡し0回 | T021、T027 | ローカル（権限なしの実効性はT051） |
| 拒否系 | 受信時刻と本文の時刻項目の差が3日超で拒否（J-1） | T021、T024、T016 | ローカル |
| 拒否系 | 入力サイズ上限の超過を署名検証の前に拒否 | T021、T012 | ローカル（実効上限はT055） |
| 拒否系 | `workflow_job` 以外のイベント、配信IDの欠落を拒否 | T021、T013 | ローカル |
| 拒否系 | JSONとして不正なbodyを署名検証後に拒否 | T021、T015 | ローカル |
| 拒否系 | 拒否時のログ、診断、例外にSecret、トークン、ジョブ内容が無い | T023、T018 | ローカル |
| 拒否系 | 拒否したいずれの入力でもランナー起動に相当する処理が呼ばれない | T021 | ローカル |
| 再試行系 | 同じ本文の再受信（配信IDが変わっても同じ bodyDigest）で引き渡しが二重にならず、重複時の応答になる | T022、T017 | ローカル（Ministack: T044） |
| 再試行系 | 引き渡し失敗で再試行を促す応答、失敗した本文のキーは重複扱いにならない | T022、T017 | ローカル |
| 再試行系 | 同じ本文でGUIDだけ違う再送は duplicate、署名失敗は重複排除に書き込まない、SQSの本文に bodyDigest がある | T017、T020、T022（`test/webhook-body-digest.test.mjs`） | ローカル |
| 再試行系 | 再試行系の診断が、成功、拒否と区別できる分類で記録される | T022、T011 | ローカル |
| 契約の固定 | 成功、拒否、再試行のステータスと診断分類が契約テストで固定される | T011、T020〜T023 | ローカル |
| 契約の固定 | ローテーション中に旧版のSecretで署名された配信を拒否しない方式が固定される | T025、T045 | ローカル（実効性はT058） |
| 契約の固定 | `corepack pnpm quality` が成功する | T050 | ローカル |

### 受け入れ条件に載らない要件の対応

| 要件 | 検証するタスク |
| --- | --- |
| FR-006 Issue #3から引き継いだ契約（Webhook URL、HMAC検証、ローテーション、Secret取得運用）の固定 | T014（HMAC）、T025（ローテーション）、T036（Webhook URL）、T045〜T048（運用の文書） |
| FR-008 書き込み権限を付与しない | T035、T039 |
| FR-009 SQS標準キューでの引き渡しと、Issue #5への冪等性の要請 | T029、T034、T038 |
| FR-010 レート、バースト、予約同時実行数の必須化と、body上限の既定 | T006〜T009、T038、T041 |
| 非機能 タイムアウト3秒 | T038（設定）、T054（実測） |
| 非機能 再現性（AWS認証なしのsynthとテスト） | T041、T050 |
| 非機能 診断ログの保持期間30日（J-5） | T035、T038、T049（確認）、T062（実AWS） |
| 非機能 ロググループへの書き込み権限 | T035、T039、T062 |
| `ping` の扱い（Q-009） | T026、T048、T057 |
