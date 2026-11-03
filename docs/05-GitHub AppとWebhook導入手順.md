# GitHub AppとWebhook導入手順

## 概要

この手順は、顧客OrganizationへPrivate GitHub Appを導入し、顧客AWSアカウントのSecrets ManagerでWebhook Secretを管理するためのものです。
GitHub側の登録とAWS側の構築を分けて実行します。

## 事前条件

- 対象GitHub Organizationの管理者権限があること
- 顧客AWSアカウントへAWS CDKを実行できる認証設定があること
- Node.js 22以上、Corepack、PNPMが利用できること
- GitHub Appの表示名と対象Organizationを確認済みであること
- 1つの顧客AWSアカウントには、1つの環境（本番など）だけをデプロイする。Secret名は固定のため、同じアカウントに複数環境を置くとSecret名が衝突する
- Webhook Secretを読み取る管理者ロールのARNを確認済みであること。設定の`adminRoleArn`に、実在するIAMロールのARNを指定する

## GitHub側の設定

1. GitHub Organization内でPrivate GitHub Appの作成画面を開く。
2. App名を`config/github-app.example.json`の`appName`と一致させる。
3. Appの所有者とインストール先を対象Organizationに限定する。
4. Repository permissionsとしてActions Read-onlyとMetadata Read-onlyだけを設定する。
   Organization permissionsは付与せず、Administration権限も付与しない。Issue #5でランナー登録などにAdministration権限が必要と判定した場合は、別Specで対象API、理由、範囲を示して再承認する。
5. Webhookイベントは`workflow_job`だけを有効にする。
6. Webhook URLはIssue #4が提供するCloudFormation Output `GitHubAppWebhookUrl`から取得して登録する。Issue #3のCDKはSecret ARNと非機密設定値だけを出力する。
7. Appを対象Organizationへインストールし、対象Repositoryの範囲を確認する。

GitHub AppのPrivate Key、Webhook Secret、GitHub Tokenはリポジトリ、Issue、ログへ記載しません。
GitHub画面で権限名が利用できない場合は、推測で変更せず、OrganizationのポリシーとGitHubの権限一覧を確認してください。

## AWS側の構築

設定例を検証します。

```bash
corepack pnpm github-app:check
```

AWS CDKの構成を確認します。
デプロイ経路（`cdk.json`の`app`）は、組織名と管理者ロールARNがプレースホルダーのままなら環境変数に関係なく拒否します。品質ゲートの検査synthだけがプレースホルダーを許可します。

```bash
corepack pnpm cdk:check
```

Secret ARN、Organization名、App名はCloudFormationの出力から確認します。
Webhook Secretの実値は出力へ表示されません。

## Secretの受け渡し

Webhook Secretの実値はAWS Secrets Managerが生成・保存します。実値はCloudFormation Output、CDKテンプレート、CIログ、Git管理対象へ出しません。
GitHub側への登録は、次の手動手順で一度だけ行います。

### 登録手順

1. 承認済みの管理端末を用意する。OSの画面共有、スクリーンショット、クリップボード同期を無効にした状態で使う。
2. Secret取得権限を持つ管理者が、`saving-money-runner/github-app/webhook`の現行値を`secretsmanager:GetSecretValue`で一度だけ取得する。
3. 取得した値を、GitHub AppのWebhook Secret入力欄へ直接貼り付けて保存する。値を標準出力、ファイル、シェル履歴、チャットへ残さない。
4. 登録後、Secret取得に使った端末のクリップボードを消去し、画面履歴を閉じる。
5. CloudTrailで`GetSecretValue`の記録を確認し、想定外の取得がないことを確認する。
6. 登録後の疎通確認は、Issue #4のWebhook受信で正しい署名を受け入れ、誤った署名を拒否することで行う。

### 権限

- `GetSecretValue`を許可する主体は、`adminRoleArn`に指定した読取り専用の管理者ロールと、`additionalReaderRoleArns`に指定したロールだけとする。リソースポリシーのDenyが、それ以外の主体を拒否する。
- 読取りを許可するロールは、デプロイ先と同じAWSアカウントのものに限る。別アカウントのロールは、この設計では許可しない。デプロイ時に、ロールARNのアカウントIDがデプロイ先と一致することを確認する。
- `adminRoleArn`には、広い権限を持つ共有の管理者ロールを指定しない。導入前に、そのロールの信頼ポリシー（AssumeRoleできる主体）とIAM権限をIAMレビューで確認する。確認結果は導入記録へ残す。
- 許可のResourceは、このWebhook SecretのARNだけに限定する。`Resource: "*"`や、他のSecretを含むワイルドカードは使わない。
- 登録用の管理者ロールには、`ListSecrets`、`PutSecretValue`、`DeleteSecret`を付与しない。
- ローテーション用には、別の一時ロールを使う。このロールに付与するのは、このWebhook SecretのARNに限定した`PutSecretValue`と`UpdateSecretVersionStage`だけとする。`DeleteSecret`は付与しない。
- 一時ロールは、ローテーションが終わった時点で削除する。MFAと短時間セッションを必須とする。
- Lambda、ランナー、CI、開発者の共有ロールには、この手動手順のための権限を付与しない。
- Issue #4のWebhook処理ロールは、設定の`additionalReaderRoleArns`に追加してから、このSecret ARNだけに読取り権限を付与する。

### 失敗時

- GitHub側の登録に失敗しても、AWS側のSecretを削除・再生成しない。
- 登録値と取得値が一致しない疑いがある場合は、GitHub側のWebhook Secretを再入力し、疎通確認を繰り返す。
- 値の漏えいが疑われる場合は、Secrets Managerで新しい版を作成し、GitHub側を新しい値へ切り替えてから旧版の利用を止める。

### ローテーション

Issue #3では自動ローテーションを有効にしません。次の手動Runbookで行います。
Secrets Managerで`PutSecretValue`により新しい版を作ると、ステージ指定がない場合は`AWSCURRENT`が即座に新しい版へ移る。
前提として、ローテーション用の一時ロールで操作する。権限は「権限」の節のとおり。
そのため、新しい版は`AWSPENDING`ラベルで作成し、GitHub側の切り替えと確認が終わってから`AWSCURRENT`へ昇格させる。

1. 変更前に、Webhook受信の疎通が成功していることを確認する。現行版は`AWSCURRENT`のまま変更しない。
2. 新しい値を`AWSPENDING`ラベルで作成する。`AWSCURRENT`は移動しない。
3. GitHub側のWebhook Secretを`AWSPENDING`の値へ更新する。切り替え直後に、GitHubの配信履歴で拒否件数を確認する。
4. Issue #4の受信処理が`AWSPENDING`の値で正しい署名を受け入れ、誤った署名を拒否することを確認する。受信処理は、切り替え期間中に`AWSCURRENT`と`AWSPENDING`の両方を検証対象にする。
5. 拒否された配信は、GitHubの再配信機能で再送し、欠落がないことを確認する。
6. 確認が終わったら`AWSPENDING`を`AWSCURRENT`へ昇格させ、旧版の`AWSPREVIOUS`を利用しないことを確認する。
7. 失敗した場合は、GitHub側の値を`AWSCURRENT`の現行版へ戻す。`AWSCURRENT`は変更していないため、Secrets Managerの操作は不要である。

### リソースポリシー

Secretのリソースポリシーは、`adminRoleArn`と`additionalReaderRoleArns`に指定したIAMロール以外からの`secretsmanager:GetSecretValue`を拒否する。
IAMポリシーで許可を与えても、このDeny文が優先される。
そのため、Issue #4でWebhook処理がSecretを読む場合は、そのロールのARNを許可条件へ追加する。
追加しない場合、Webhook処理は署名検証に必要なSecretを読めず、受信が全件拒否される。

### 既存Secretと再作成

- Secretは`RemovalPolicy.RETAIN`のため、Stackを削除してもSecretは残ります。
- 同名のSecretが存在する状態でStackを再作成すると失敗します。既存Secretを削除せず、対象Organization、AWSアカウント、Secret名を照合してから再導入します。
- 既存Secretを別顧客や別環境の再利用に使いません。

## 更新と復旧

- App権限を変更する場合は、変更前後の権限と理由をレビュー記録へ残す。
- Webhook URLを変更する場合は、旧URLの停止と新URLの疎通確認を順番に行う。
- Secretをローテーションする場合は、GitHub側とAWS側の切り替え手順を事前に確認する。
- GitHub側の登録に失敗しても、AWSの既存Secretを削除または上書きしない。
- App ID、Secret ARN、Webhook URLのいずれかが不明な場合は、導入を停止して再確認する。

## 撤去

GitHub AppのOrganizationからのアンインストールと、AWS側リソースの撤去は別々に確認します。
撤去前に、対象Organization、AWSアカウント、Secret名を照合し、別顧客の設定を対象にしていないことを確認します。

## 残留リスク

| 項目                                 | 内容                                                                                                                                                                                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 管理者ロールの実効権限と信頼ポリシー | コードでは検証しない。導入前のIAMレビューで確認し、結果を導入記録へ残すことを手順として必須にする                                                                                                                                       |
| 受容の判断                           | Issue #3では、デプロイ経路がまだないため、実AWSでの検証は行わない。ユーザーが残留リスクとして受容した                                                                                                                                   |
| 対応の期限                           | Issue #4またはIssue #5でデプロイ経路を作るときに、AWS APIによる信頼ポリシーの検査を検討する                                                                                                                                             |
| 追加の読取りロールの実効権限         | `additionalReaderRoleArns`に指定したロールが、Webhook Secret以外のSecretも読める権限を持つかは、コードでは検証しない。専用ロールで、そのSecretのARNだけに`GetSecretValue`を限定する手順を必須にする。ユーザーが残留リスクとして受容した |
