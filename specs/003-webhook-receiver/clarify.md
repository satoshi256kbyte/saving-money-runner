# Issue #4 Clarify結果

## 位置づけ

`spec.md` の未決事項 Q-001〜Q-011 を1件ずつ検討した結果を記録する。
判定は次の3種類とする。

| 判定 | 意味 |
| --- | --- |
| 根拠で決められる | 公式仕様または既存のリポジトリ契約から一意に決まる。決定として固定する |
| 既定案を置けば足りる | 根拠を示せる既定値で足りる。plan で変更する場合は理由を記録する |
| 人の判断が必要 | 根拠だけでは決まらない、または数値の根拠を示せない。未決のまま残し、選択肢を示す |

根拠の無い数値（許容時間、上限値、保持期間など）は、既定案にしていない。
示せる根拠はGitHub公式、AWS公式の既定値と上限、既存のリポジトリ契約に限る。

## 判定の一覧

| 番号 | 判定 | 結論 |
| --- | --- | --- |
| Q-001 | 人の判断が必要（決定済み） | 選択肢Bに決定（J-1）。受信時刻と本文の時刻項目の差が3日を超えたら拒否する |
| Q-002 | 既定案を置けば足りる | DynamoDBの条件付き書き込み。保持期間は3日（GitHubの再配信期間） |
| Q-003 | 一部が人の判断（決定済み） | 応答と再試行の規則は既定案。受付レートと予約同時実行数は顧客ごとの必須設定（J-2） |
| Q-004 | 既定案を置けば足りる | 認証は署名検証のみを必須とする。IP制限とWAFは採用しない |
| Q-005 | 既定案を置けば足りる | HTTP API（payload format 2.0）を使う |
| Q-006 | 根拠で決められる | 手動Runbookを正式契約とする。自動化は別Spec。切り替え中は2版を検証する |
| Q-007 | 根拠で決められる | `docs/05` の登録手順と権限を運用契約として採用する |
| Q-008 | 一部が人の判断（決定済み） | Lambdaタイムアウト3秒とSecretキャッシュ300秒は既定案。body上限は6 MB（6291456バイト）を既定とする設定値（J-3） |
| Q-009 | 根拠で決められる | `ping` は署名検証とJSON検証の後に200で受理し、後続へ渡さない。`workflow_job` の抽出と期限判定は適用しない |
| Q-010 | 一部が人の判断（決定済み） | 渡す項目の範囲は既定案。受け渡し手段はSQS標準キュー（J-4） |
| Q-011 | 根拠で決められる | 処理済みの重複は200を返す。処理中の重複は503を返す |

人の判断が必要だった項目は、本書末尾の「人の判断が必要な項目」にまとめ、「人の判断の結果」に決定を記録する。
J-1〜J-4 の選択肢と推奨は、判断時点の記録として残している。
J-5（診断ログの保持期間）の選択肢は `plan.md` の「決定済みの項目」に記録し、決定はこの文書の「人の判断の結果」に記す。

## 参照した根拠

### GitHub公式ドキュメント

| 記号 | URL | 確認した内容 |
| --- | --- | --- |
| G1 | <https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries> | 署名は `X-Hub-Signature-256`。`sha256=` で始まるHMAC hex digest。UTF-8で扱う。定数時間比較を使う。途中で変更されたpayloadは検証に失敗する |
| G2 | <https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks> | 10秒以内に2XXを返す。イベント種別とactionを処理前に確認する。リプレイ対策は `X-GitHub-Delivery` で配信の一意性を確認する。再配信でも同じ値になる。IP許可リストは任意で、IPは変更される |
| G3 | <https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries> | GitHubは失敗した配信を自動で再配信しない。10秒を超える応答は失敗として記録される |
| G4 | <https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks> | 再配信できるのは過去3日以内の配信 |
| G5 | <https://docs.github.com/en/webhooks/webhook-events-and-payloads> | 配信ヘッダー一覧にタイムスタンプは無い。payloadの上限は25 MB。`ping` は新しいwebhookの作成時に送られる確認用イベントで、GitHub Appsも対象。`workflow_job` のactionは `queued`、`in_progress`、`completed`、`waiting` |
| G6 | <https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks> | webhook作成後にGitHubが `ping` を送る |
| G7 | <https://docs.github.com/en/rest/apps/webhooks> | GitHub Appのwebhook設定の更新APIはJWT（App秘密鍵で署名）を要する |
| G8 | <https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json> | `workflow_job` payloadのスキーマ。`workflow_job` に `id`、`run_id`、`labels`、`created_at`、`started_at`、`completed_at` がある |

### AWS公式ドキュメント

| 記号 | URL | 確認した内容 |
| --- | --- | --- |
| A1 | <https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vs-rest.html> | HTTP APIは低価格で機能が少ない。AWS WAF、リソースポリシー、APIキー、使用量プランはREST APIのみ |
| A2 | <https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html> | HTTP APIのpayload上限は10 MB、統合タイムアウトの上限は30秒（引き上げ不可） |
| A3 | <https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html> | format 2.0はヘッダー名を小文字にする。重複ヘッダーはカンマで連結される。`body` と `isBase64Encoded` を渡す |
| A4 | <https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html> | 同期呼び出しのリクエストは6 MB。非同期は1 MB。同時実行数の既定は1,000 |
| A5 | <https://docs.aws.amazon.com/lambda/latest/dg/configuration-timeout.html> | Lambdaタイムアウトの既定値は3秒 |
| A6 | <https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-configuring.html> | 非同期呼び出しの再試行は0〜2回。イベントの保持は最大6時間 |
| A7 | <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html> | TTLの削除は期限後に遅れる（通常は数日以内）。期限切れの項目は読み取り側で除外する |
| A8 | <https://docs.aws.amazon.com/secretsmanager/latest/userguide/whats-in-a-secret.html> | `AWSCURRENT`、`AWSPREVIOUS`、`AWSPENDING` のラベル。ラベル無しの取得は `AWSCURRENT` |
| A9 | <https://docs.aws.amazon.com/systems-manager/latest/userguide/ps-integration-lambda-extensions.html> | Secrets ManagerのキャッシュTTL（`SECRETS_MANAGER_TTL`）の既定値と上限は300秒 |
| A10 | <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html> | SQSの保持期間は既定4日（最大14日）、メッセージは最大1 MiB |
| A11 | <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-exactly-once-processing.html> | FIFOキューの重複排除は5分間 |
| A12 | <https://docs.aws.amazon.com/secretsmanager/latest/userguide/cloudtrail_log_entries.html> | Secrets ManagerのAPI呼び出しはCloudTrailに記録される |

### 既存のリポジトリ契約

| 記号 | ファイルと行 | 内容 |
| --- | --- | --- |
| R1 | `docs/04-脅威モデルとセキュリティ基準.md` 53行、73行 | SEC-002 は「イベントID、受信時刻、冪等性キー、期限検査」でリプレイと重複を拒否または冪等に収束させる |
| R2 | 同 54行、74行 | SEC-003 は形式、サイズ、許可値を検証し、未検証値をAWS APIへ渡さない |
| R3 | 同 61行、63行、81行、83行 | SEC-010、SEC-012 はレート制限と同時実行上限を備えることを必須とする |
| R4 | `docs/05-GitHub AppとWebhook導入手順.md` 25行（GitHub側の設定の手順6） | Webhook URLは本Issueの `GitHubAppWebhookUrl` から取得して登録する |
| R5 | 同 54〜61行（登録手順）、63〜73行（権限） | Secretの登録手順と権限。Webhook処理ロールは `additionalReaderRoleArns` に追加し、このSecret ARNだけに読取りを付与する |
| R6 | 同 81〜94行 | ローテーションの手動Runbook。`AWSPENDING` を作り、受信処理は `AWSCURRENT` と `AWSPENDING` の両方を検証する |
| R7 | `specs/002-github-app-webhook/clarify.md` 13行 | Private Keyは顧客環境外へ出さない。AWS側で参照する場合は別Secret契約を追加する |
| R8 | `cdk/lib/github-app-integration.ts` 11行、18〜22行、51〜52行、60〜64行 | ロールARNを正規表現で検証し、Secretのリソースポリシーが読取りロール以外の `GetSecretValue` をDenyする |
| R9 | `docs/03-完成ロードマップ.md` の04、05の節 | #4はHMAC、リプレイ、タイムスタンプ、入力サイズ、冪等性を検証する。#5は検証済みWebhookから対象リポジトリ、ラベル、ジョブ情報を抽出する |

## 決定事項

### Q-001 タイムスタンプの許容時間

判定は人の判断が必要。

根拠は次のとおり。

- G5 の配信ヘッダー一覧にタイムスタンプは無く、署名はbodyだけを対象にする（G1）。
  Stripeのような署名付き時刻による「数分の許容時間」は、GitHubでは成立しない。
- 手動の再配信は過去3日分が可能で（G4）、GitHubは自動再配信をしない（G3）。
  Runbookの手順5（R6）は、拒否された配信を再配信で復旧する前提である。
  そのため、数秒〜数分の短い許容時間で拒否すると、正規の再配信を拒否する。
- 再配信でも `X-GitHub-Delivery` は元の配信と同じ値になる（G2）。
  配信IDの保持期間（Q-002）が、重複排除によるリプレイ防止の範囲になる。
- R1 は「受信時刻」と「期限検査」を求める。受信時刻はLambdaが記録できる。
  比較する相手の時刻は、署名対象bodyの中にある `workflow_job` の時刻項目（G8）だけが、改ざんされない値である。
- 「何秒」という短い許容時間の数値には、GitHub公式にも既存契約にも根拠が無い。選択肢にしない。

選択肢は「人の判断が必要な項目」の J-1 に記載する。

### Q-002 重複排除の保存先と保持期間

判定は既定案を置けば足りる。

根拠は次のとおり。

- 配信IDは重複排除キーとして使える（G2）。再配信でも同じ値になるため、保持期間は再配信期間3日（G4）を下回れない。
- SQS FIFOの重複排除は5分間で（A11）、3日間の保持を満たさない。
- DynamoDBのTTLは削除が遅れるため（A7）、読み取り側で期限を判定する。

既定案は次のとおり。

| 項目 | 既定案 |
| --- | --- |
| 保存先 | DynamoDB。キーは配信ID（GUID形式を検証したものだけ） |
| 保持期間 | 処理時刻から3日。TTL属性 `expiresAt`（秒単位のUnix時刻）に設定する |
| 書き込み方式 | 条件付き `PutItem`。確保の条件は次の「状態の遷移」に定める |
| 保存する項目 | 配信ID、状態（`processing`、`done`）、`expiresAt`、`leaseUntil`、受信時刻。bodyとヘッダーは保存しない |
| 記録するタイミング | 署名検証と構文検証を通過した配信だけ。拒否した配信は記録しない（再配信で復旧するため） |
| 状態の遷移 | 後続の受け渡し前に `processing` で確保する。成功したら `done` にする。失敗したら確保を解放する |
| 確保の条件 | 項目が無い、または `expiresAt` を過ぎた、または `state` が `processing` かつ `leaseUntil` を過ぎた場合だけ成功させる。それ以外は既存項目を返し、`done` なら `duplicate`、期限内の `processing` なら `duplicate_in_flight` とする |
| `expiresAt` と `leaseUntil` の役割 | `expiresAt` は項目の保持期間（処理時刻から3日。TTL属性）。`leaseUntil` は1回の試行の処理時間の見積もり上限（Lambdaタイムアウトと同じ秒数。1回の試行はタイムアウトを超えられないため）。`leaseUntil` を過ぎた `processing` は、試行が異常終了した項目として再確保できる |

保持期間の3日は、Q-001でどちらの選択肢を採っても下限として必要である。

### Q-003 Lambdaの同時実行とエラー応答

判定は、応答と再試行の規則が既定案、同時実行数とレートの値が人の判断。

根拠は次のとおり。

- GitHubは2xx以外と10秒超を失敗として記録し、自動では再配信しない（G2、G3）。
  後続の受け渡しや依存先の一時障害には5xxを返す。再配信は運用者が行う（G4）。
- 失敗した配信IDを重複として扱わない（受け入れ条件）ため、`processing` の確保を解放する（Q-002）。
- R3 は、レート制限と同時実行上限を備えることを必須としている。設定しない選択肢は取れない。
- 1つのジョブは `queued`、`in_progress`、`completed` の3回（承認待ちがあれば `waiting` を加えて最大4回）の
  `workflow_job` を発生させる（G5）。サブスクリプションではactionを絞れないため、受信側はこの件数を受ける。
- 同時実行数の既定は1,000（A4）。これは上限の目安であり、本Specの設定値の根拠にはならない。

応答の契約は「応答と診断の契約」の表に記載する。値の選択肢は J-2 に記載する。

### Q-004 Webhook URLの認証の要否

判定は既定案を置けば足りる。

根拠は次のとおり。

- GitHubが定める認証の手段は署名検証である（G1）。
  IP許可リストは「設定できる」という任意の手段で、IPは変更されるため定期更新が要る（G2）。
- 顧客ごとに別のAWSアカウントへ導入する（`docs/03-完成ロードマップ.md` 29〜30行、`docs/05` 14行）。
  IP許可リストの更新を顧客ごとに運用する負担は、署名検証だけで得られる保護に比べて大きい。
- WAFはREST APIだけが対応する（A1）。Q-005でHTTP APIを採るため、WAFは採用しない。

既定案は「署名検証のみを必須とする。IP制限とWAFは採用しない」である。
不正入力の大量送信は、サイズ上限、署名検証の前の軽い検査、受付レートの制限（J-2）で抑える。

注意として、API Gatewayの種類を後から変えるとURLが変わる。URLは顧客ごとにGitHub Appへ登録するため、
変更には全顧客での再登録が要る。WAFが必要になる見込みがあれば、Q-005を再検討する。

### Q-005 API Gatewayの種類

判定は既定案を置けば足りる。

根拠は次のとおり。

- 本Specが必要とする機能は、Lambdaプロキシ統合、raw bodyの取得、10 MBのpayload、30秒の統合タイムアウトで、
  HTTP APIは備える（A2、A3）。
- REST APIだけの機能（WAF、APIキー、使用量プラン、リソースポリシー、リクエスト検証）は、Q-004の決定で不要（A1）。
- HTTP APIは低価格に設計されている（A1）。金額はplanで公式の料金ページから見積もる。
- raw bodyはHTTP APIのformat 2.0の `body` と `isBase64Encoded` から復元できる（A3）。
  ヘッダー名は小文字になる。重複ヘッダーはカンマで連結されるため、`x-hub-signature-256` が連結されていたら
  形式不正として拒否する（A3）。

既定案は「HTTP API、payload format 2.0」である。

### Q-006 Secretローテーションの方式

判定は根拠で決められる。

根拠は次のとおり。

- 自動ローテーションは、GitHub Appのwebhook設定の更新API（G7）をAWS側から呼ぶ必要がある。
  このAPIはApp秘密鍵で署名したJWTを要する（G7）。
- Issue #3は、Private Keyを顧客環境外へ出さず、AWS側で参照するなら別のSecret契約を追加する、と決めている（R7）。
- 本Specは、書き込み権限が必要になる場合は別Specで再承認する、と決めている（`spec.md` の依存する既存の契約）。
  自動ローテーションはSecretへの書き込みを伴う。

決定は次のとおり。

- `docs/05` の手動Runbook（R6）を正式な運用契約として採用する。
- 自動ローテーションは別Specで扱う。本Specでは実装しない。
- 受信処理は、切り替え期間中に `AWSCURRENT` と `AWSPENDING` の両方を検証対象にする（R6、A8）。
  どちらか一方で一致すれば署名は有効とする。`AWSPREVIOUS` は使わない。
- 候補の検証は、一致しても途中で打ち切らず、すべての候補に対して定数時間比較を行う。
- `AWSPENDING` が存在しないことは平常の状態であり、失敗として扱わない。
- 署名が一致しない配信は、重複排除に記録しない（Q-002）。Runbookの手順5の再配信で復旧できる。
- 不一致の度にSecretを再取得して再検証することはしない。署名の偽造で、Secrets Managerへの呼び出しを
  増幅できるためである。キャッシュ（Q-008）の期間を前提に、Runbookの手順を次のとおり補う。

| Runbookの手順 | 本Specでの補足 |
| --- | --- |
| 手順2の後 | `AWSPENDING` がLambdaのキャッシュへ反映される300秒以上を待ってから、手順3へ進む |
| 手順3以降 | 反映前に届いて拒否された配信は、手順5の再配信で復旧する。再配信は過去3日分が可能（G4） |

`docs/05` 自体の修正は、plan 以降の工程で行う。本工程では変更しない。

### Q-007 Secret取得運用

判定は根拠で決められる。

`docs/05` の登録手順と権限（R5）を、Webhook処理側のCloudTrail監査と合わせた運用契約として採用する。
Secretの取得はCloudTrailに記録される（A12）。

運用契約の内容は次のとおり。

- Webhook処理のロールに付与するSecret操作は、`GetSecretValue` を固定のSecret ARNに対して許可するものだけとする。
  `AWSPENDING` の取得もこの権限で足りる。`PutSecretValue`、`UpdateSecretVersionStage`、`DeleteSecret` は付与しない。
- Secretのリソースポリシー（R8）のDenyに、Webhook処理ロールを読取りロールとして追加する。
  追加しない場合、署名検証に必要なSecretを読めず、受信が全件失敗する（R5）。
- Webhook処理は、キャッシュの期間内はSecretを再取得しない。取得は、実行環境ごと、期間ごとに最大でCURRENTとPENDINGの
  各1回となる。
- 想定外の取得（Webhook処理ロール以外、または頻度の異常）は、CloudTrailで確認する。検知の仕組みはIssue #10の範囲とする。

planへ引き継いだ制約があった。`cdk/lib/github-app-integration.ts` はロールARNを、12桁のアカウントIDを含む
文字列の正規表現で検証する（R8の11行、18〜22行）。同じStackで作るLambdaロールのARNはデプロイ前は
CloudFormationのトークンであり、この検証を通らない。
`plan.md` の「未整合1の解決」で、文字列ARNではなく型付きの `IRole` として渡す方式に決めた。
文字列ARNの検証は緩和しない。

### Q-008 入力サイズ上限とタイムアウトの値

判定は、Lambdaタイムアウトとキャッシュ期間が既定案、body上限が人の判断。

#### Lambdaタイムアウト

既定案は3秒である。

- 3秒はLambdaの既定値である（A5）。
- GitHubは10秒で接続を切る（G2）ため、Lambdaタイムアウトは10秒未満でなければならない。
  API Gatewayの統合タイムアウトの上限30秒（A2）は、これより緩いので制約にならない。
- Secret取得（キャッシュ有り）、DynamoDBの書き込み、後続の受け渡しが3秒で足りるかは、実測の根拠が無い。
  planの検証で不足と分かった場合は、10秒未満の範囲で変更し、理由を記録する。

#### Secretのキャッシュ

既定案は300秒である。

- 300秒は、AWS Parameters and Secrets Lambda ExtensionのTTLの既定値であり上限である（A9）。
- Q-006のとおり、キャッシュの期間はローテーションの手順に影響する。
- Secret取得が失敗し、キャッシュも無い場合は、503を返す（応答と診断の契約）。

#### bodyの上限

人の判断が必要。J-3 に記載する。

訂正が1点ある。`spec.md` の非機能要件は「API Gatewayの上限10 MBより小さく設定する想定」としている。
HTTP APIのpayload上限は10 MBだが（A2）、LambdaがAPI Gatewayから同期で受けるリクエストの上限は6 MBである（A4）。
実際の上限は6 MBが先に効く。GitHub側のpayload上限は25 MBである（G5）。

### Q-009 pingイベントの扱い

判定は根拠で決められる。

根拠は次のとおり。

- GitHubは、webhookの作成後に確認用の `ping` を送る（G5、G6）。`ping` のavailabilityにGitHub Appsが含まれる（G5）。
- `docs/05` の登録手順6（R5、61行）は、登録後の疎通確認を「正しい署名を受け入れ、誤った署名を拒否すること」としている。
  `ping` を拒否すると、登録直後の配信が失敗として表示され、正しい署名を受け入れる確認ができない。
- GitHub Appの登録で `ping` が必ず送られるかは、確認した公式の文書に明記が無い。届かない場合も動作に影響しない。

決定は次のとおり。

- `X-GitHub-Event: ping` は、署名検証とJSON検証を通過した場合に限り、200を返して受理する。後続へ渡さない。
  `workflow_job` の抽出と期限判定は適用しない。検査順では順9で、期限判定（順10）より前に分岐する。
- 診断の分類は `ping_accepted` とする。署名が不正な `ping` は、他のイベントと同じく401で拒否する。
- `ping` は重複排除に記録しない。
- `ping` と `workflow_job` 以外のイベントは、署名の検証より前にヘッダーだけで拒否する。

### Q-010 後続へ渡す方式と形式

判定は、渡す項目の範囲が既定案、受け渡し手段が人の判断。

#### 渡す項目

既定案は、許可リストで選んだ項目だけを渡す、である。bodyをそのまま渡さない（`spec.md` のraw bodyの扱い、R2）。

根拠は、#5が「検証済みWebhookから対象リポジトリ・ラベル・ジョブ情報を抽出する」ことである（R9）。
項目は次のとおり。

| 区分 | 項目 |
| --- | --- |
| 受信側が付与 | 配信ID、イベント種別、受信時刻 |
| payloadから抽出（G8） | `action`、`workflow_job` の `id`、`run_id`、`labels`、`status`、リポジトリのID、リポジトリのフルネーム、`installation` のID、Organizationのログイン名 |

`action` が `queued` の配信だけを後続へ渡し、`in_progress`、`completed`、`waiting` は検証後に200で受理して
渡さない、という切り分けの要否は、#5の要件に依存する。#5のSpecが無いため、本Specでは決めない。
既定案は、4つのactionすべてを許可リストの項目付きで渡し、#5が選別することとする。
渡す側が先に選別すると、#5が `completed` を使うことになった場合に、本Specの再改訂が要るためである。

項目の最終確認は、plan で、各項目がnull値を取りうるかをG8のスキーマで確認して行う。

#### 受け渡し手段

人の判断が必要。J-4 に記載する。

GitHubへの応答を10秒以内に返すため、受け渡しは非同期にする。これはGitHub公式の推奨である（G2）。

### Q-011 重複時の応答

判定は根拠で決められる。

根拠は次のとおり。

- GitHubは2xxを成功、それ以外を失敗として扱う（G2、G3）。処理済みの重複に4xxを返すと、GitHubの配信履歴で
  失敗に見え、運用者が不要な再配信を繰り返す。
- 処理中の重複は、最初の試行がまだ失敗する可能性がある。ここで2xxを返すと、最初の試行が失敗したときに
  イベントが欠落する。GitHubは自動で再配信しないため（G3）、5xxを返して再配信の余地を残す。

決定は、処理済みの重複に200、処理中の重複に503である。区別は診断の分類（`duplicate`、`duplicate_in_flight`）で行う。

## 応答と診断の契約

FR-005 の契約テストで固定する値の既定案を示す。
GitHubは2xxとそれ以外しか区別しないため（G2、G3）、具体的なステータスの選択はHTTPの意味（RFC 9110）に従う。
診断にbody、Secret、トークン、ジョブ内容を含めない（FR-004）。配信IDは、GUID形式を検証した後だけ記録する。

検査は上から順に行い、失敗した時点で終了する。署名検証を通過するまで、bodyの内容を使わない。

| 順 | 検査 | 失敗時のステータス | 診断の分類 |
| --- | --- | --- | --- |
| 1 | 受信したbodyの長さが上限以下（J-3） | 413 | `payload_too_large` |
| 1a | 順1の内部。`isBase64Encoded` が真で、本文が base64 として不正（文字種が違う、長さが4の倍数でない） | 400 | `payload_invalid` |
| 2 | `Content-Type` が `application/json` | 415 | `unsupported_media_type` |
| 3 | `X-GitHub-Event` が `workflow_job` または `ping` | 400 | `event_not_allowed` |
| 4 | `X-GitHub-Delivery` がGUID形式 | 400 | `delivery_id_invalid` |
| 5 | `X-Hub-Signature-256` が `sha256=` と64桁のhexで、重複していない | 401 | `signature_malformed` |
| 6 | Secretを取得できる（キャッシュまたはSecrets Manager） | 503 | `secret_unavailable` |
| 7 | HMAC-SHA256が、いずれかの候補と定数時間で一致する | 401 | `signature_mismatch` |
| 8 | bodyがJSONとして有効 | 400 | `payload_invalid` |
| 9 | `ping` なら受理して終了（`workflow_job` の抽出と期限判定は適用しない） | 200 | `ping_accepted` |
| 10 | `workflow_job` の必須項目を抽出できる（`repository` など）。かつ期限内（J-1） | 400 | `payload_invalid`、`expired` |
| 11 | 重複排除の確保に成功 | 重複で処理済みは200、処理中は503 | `duplicate`、`duplicate_in_flight` |
| 12 | 後続への受け渡しに成功 | 失敗時は確保を解放して503 | `handoff_failed` |
| 13 | 受理 | 202 | `accepted` |

署名ヘッダーが無い場合は、順5で `signature_missing`（401）とする。
`ping` は順9で終了するため、順10の抽出、期限判定、および「解釈できる時刻が無い」ことによる `payload_invalid` を適用しない。
`workflow_job` を持たない `ping` の本文でも、署名とJSONが有効なら200で受理する。
想定外の例外は500（`internal_error`）とし、例外の内容を応答にも診断にも出さない。

順3と順4を順6より前に置くのは、ヘッダーだけで判定できる不正入力に対して、Secretの取得を行わないためである。
この2つのヘッダーは、GitHubの配信ヘッダーとして定義されている（G5）。

診断の出力先と相関IDは、planで定める。ログの保持期間は30日である（J-5）。

## 追加で確認した事項

`spec.md` の未決事項に無いが、clarifyの範囲で決められたものを記録する。

| 項目 | 決定 | 根拠 |
| --- | --- | --- |
| Content-Type | `application/json` だけを受理する。GitHubの設定はJSONにする | G5はJSONとフォームエンコードの両方を配信できるとする。署名はbody全体に対するので、フォーム形式は復元の処理が要るが、本Specは要求しない |
| `X-Hub-Signature`（SHA-1） | 使わない。存在しても無視する | G1は、SHA-1の署名を互換性のためだけに残すとする |
| 署名比較の長さ | 比較前に長さが等しいことを確認し、長さが違う場合は不一致とする | G1は定数時間比較を求める |
| 文字コード | bodyをUTF-8として扱う | G1 |

## 人の判断が必要な項目

選択肢ごとのメリット、デメリット、推奨と推奨理由を示す。
推奨の根拠を示せない選択肢は載せていない。

### J-1 期限切れの判定方法（Q-001）

| 選択肢 | 内容 | メリット | デメリット |
| --- | --- | --- | --- |
| A | 期限切れの判定を行わない。重複排除（保持3日）だけでリプレイを防ぐ | 実装が小さい。payloadの時刻項目に依存しない。再配信の拒否が起きない | Issue #4の受け入れ条件「期限切れ」と、`docs/04` のSEC-002「期限検査」を満たさない。保持期間（3日）を過ぎた配信IDは再受理される |
| B | 受信時刻とpayload内の時刻項目の差が3日を超えた配信を拒否する。時刻項目は `workflow_job` のactionごとに、planで確定する | 受け入れ条件とSEC-002を満たす。3日はGitHubの再配信期間（G4）で、正規の再配信を拒否しない。重複排除の保持期間と同じ3日で、リプレイを防ぐ範囲に隙間が無い。時刻項目は署名対象のbodyの中にあり、改ざんできない | payloadの時刻項目（`created_at`、`started_at`、`completed_at`）がactionによってnullになりうるため、planで項目の選択を確定する必要がある。GitHubとLambdaの時計のずれが3日に比べて十分小さいことを前提にする |

推奨はBである。

- Aは受け入れ条件を満たさない。Bは受け入れ条件を満たし、必要な数値（3日）が公式の再配信期間から得られる。
- Bは正規の再配信を拒否しない。GitHubは自動で再配信しないため（G3）、拒否した正規の配信は運用者の手作業でしか復旧できない。
  この拒否を避けられることが、短い許容時間（採用しない）に対する決定的な差である。

### J-2 予約同時実行数と受付レートの値（Q-003）

必須であること（R3）は決まっている。値だけを決める。

値の考え方は次のとおり。

- 受付レート（件/秒）の上限は、顧客のジョブ起動のピーク（件/秒）に、1つのジョブあたりのイベント数（最大4）を掛けて見積もる（G5）。
- 予約同時実行数は、受付レートに、1回あたりの処理時間の上限（Lambdaタイムアウト、既定案は3秒）を掛けた値以上にする。

| 選択肢 | 内容 | メリット | デメリット |
| --- | --- | --- | --- |
| 1 | 今回、固定値を決めてコードに置く（値はユーザーが指定する） | 導入時の設定が増えない。契約テストで値を固定できる | 顧客ごとのジョブ規模の違いを反映できない。小さすぎると、正規のWebhookを拒否する（GitHubは自動再配信しない、G3）。大きすぎると費用の上限にならない |
| 2 | 顧客ごとの設定ファイルの必須項目にする（`config/github-app.example.json` に項目を追加する） | 顧客ごとのジョブ規模（顧客単位のAWSアカウント分離、`docs/03-完成ロードマップ.md` 29〜30行）に合う。値の根拠を導入時に記録できる | Issue #3の成果物である設定ファイルの契約を拡張する。設定の検証が増える |

推奨は2である。

- 顧客ごとにAWSアカウントを分離しており、ジョブ規模が顧客ごとに異なるため、単一の固定値に根拠を置けない。
- 値を決めるには、顧客のピークのジョブ数が要る。このデータが今は無いため、固定値（選択肢1）は根拠を示せない。
- 設定の既定値は置かず、未指定ならデプロイを失敗させる。これにより、根拠の無い値が黙って使われない。

ユーザーに確認したい点は、選択肢の判断と、選択肢1の場合の具体的な値（根拠つき）である。

### J-3 bodyの上限（Q-008）

| 選択肢 | 内容 | メリット | デメリット |
| --- | --- | --- | --- |
| A | 上限を、Lambdaの同期呼び出しの上限（6 MB、A4）に合わせる。値は設定可能にする。6 MBを超える入力はAPI GatewayまたはLambdaの基盤が先に拒否する | 正規のイベントを拒否する危険が最も小さい。値に根拠がある（A4）。bodyの検査は、HMACの計算より前に行える | 小さいbodyを前提にした費用の抑制は効かない。ただし費用はリクエスト数で決まり、6 MB以下のHMAC計算の費用は小さい |
| B | 実際の `workflow_job` payloadのサイズを実測し、その実測値に余裕を持たせた上限にする | 不正な大きいbodyを早く拒否できる | 実測にはGitHub側の実環境が要り、本Specの範囲（実AWS、実GitHubなし）では実測できない。「余裕」の倍率に根拠が無い |

推奨はAである。

- Bは今の段階で根拠を示せない。
- 上限を小さくしすぎると、正規のイベントが拒否され、同じbodyの再配信でも拒否が続く。
  上限が大きすぎる場合の費用は、HMAC計算の時間に限られ、リクエスト数による費用に比べて小さい。
- Aの値は設定可能にしておく。本番E2E（Issue #12）などで実測が得られたら、Bへ絞り込める。

### J-4 後続への受け渡し手段（Q-010）

受け渡す項目の範囲は、Q-010の既定案のとおり。

| 選択肢 | 内容 | メリット | デメリット |
| --- | --- | --- | --- |
| 1 | SQS標準キューへ送る | 受け渡しが非同期で、10秒の応答期限に収まる（G2）。保持期間は既定4日（最大14日）で、#5の停止中もメッセージが残る（A10）。1メッセージは最大1 MiBで、許可リストの項目は十分に収まる（A10）。#5は受信側を後から選べる | 標準キューは配信が重複しうる。重複は #5 が冪等に処理する必要がある（Q-002の重複排除とは別の層）。キューとDLQの作成が必要 |
| 2 | 後続のLambdaを非同期で呼び出す | 追加のキューが無い。再試行は0〜2回、イベントの保持は最大6時間（A6） | 保持が最大6時間で、#5の停止が長い場合にイベントを失う。#5のLambda名に直接依存するため、#5のSpecが決まる前に結合が固定される。非同期呼び出しのpayloadは1 MBまで（A4） |

推奨は1である。

- GitHubのベストプラクティスがキューによる非同期処理を勧めている（G2）。
- 保持期間が既定4日で、GitHubの再配信期間（3日、G4）より長く、#5の停止中の欠落が起きにくい。
- #5のSpecが未確定の現時点で、結合を固定しない。

EventBridgeなど他の手段は、確認できた根拠が無いため選択肢にしていない。

## 他の文書への反映が必要な事項

`specs/003-webhook-receiver/` 以外の対象は、後続の工程（tasks以降）で反映する。

| 対象 | 内容 |
| --- | --- |
| `docs/05-GitHub AppとWebhook導入手順.md` | ローテーションの手順2の後に、キャッシュの反映待ち（300秒以上）を追記する |
| `docs/05-GitHub AppとWebhook導入手順.md` | GitHub AppのWebhookのContent-Typeを `application/json` にすることを追記する |
| `cdk/lib/github-app-integration.ts` | 同じStackで作るLambdaロールを `IRole` として読取りロールへ追加する（`plan.md` で決定済み。実装はtasks以降） |
| `specs/003-webhook-receiver/spec.md` | 非機能要件の「API Gatewayの上限10 MBより小さく」は、Lambda同期呼び出しの上限6 MBが先に効く。J-3の決定に合わせて修正済み |

## 人の判断の結果

| 番号 | 決定した選択肢 | 決定の内容 |
| --- | --- | --- |
| J-1 | B | 受信時刻と本文の時刻項目の差が3日を超えたら拒否する。GitHubは署名付きタイムスタンプを送らないため、再配信期間の3日を基準にする |
| J-2 | 2 | 受付レートと同時実行上限は顧客ごとの必須設定とする。未指定ならデプロイを失敗させる。値そのものは設定契約に定義するだけで、本Specでは決めない |
| J-3 | A | body上限はLambda同期呼び出しの6 MBに合わせ、設定可能にする。既定は6 MB（6291456バイト） |
| J-4 | 1 | SQS標準キューを使う。配信は重複しうるため、Issue #5が冪等に処理する旨を契約に書く |
| J-5 | A | 診断ログ（Lambdaのロググループ）の保持期間は30日とする（ユーザーの決定）。選択肢と推奨理由は `plan.md` の「決定済みの項目」に記録している |

具体的な設定項目、検証の規則、後続メッセージの契約は `plan.md` に定める。
