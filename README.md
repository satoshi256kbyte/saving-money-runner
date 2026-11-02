# Saving Money Runner

GitHub Actions用のセキュアなエフェメラル・セルフホステッドランナーを、
顧客AWSアカウントへ提供するプロジェクトです。

## 開発環境

Node.js 22以上とCorepackを使用します。

```bash
corepack enable
corepack pnpm install --frozen-lockfile
```

Ministackを起動する場合は、ローカル環境のDocker運用ルールに従ってください。
Colimaを使用する環境ではColimaのDockerソケットを指定し、Composeは`docker-compose`を使用します。

```bash
docker-compose -f compose.yaml up -d
docker-compose -f compose.yaml down
```

Issue #1ではCompose定義の検証までを扱います。AWS機能の結合テストはIssue #8で追加します。

## AWS CDK

AWSインフラはAWS CDK v2のTypeScriptアプリで管理します。Issue #1のCDK Stackは
後続Issueが利用する基盤だけを定義し、AWSリソースの本実装は行いません。

```bash
corepack pnpm cdk:synth
```

`cdk:synth`はContext lookupを使わないため、AWS認証情報なしで実行できます。
実AWSへのデプロイは、対象Issueで受け入れ条件と認証境界を定めてから実施します。

## 品質ゲート

個別の検査は次のコマンドで実行できます。

```bash
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm docs:check
corepack pnpm cdk:check
corepack pnpm ministack:check
```

一括実行は次のコマンドです。

```bash
corepack pnpm quality
```

AWS CDK CLIが未導入の環境では`cdk:check`が失敗します。ツール不足を成功扱いにせず、
依存関係を復元してから再実行してください。

## CI

GitHub Actionsの`quality`ワークフローは、依存関係をlockfileから復元した後、
ローカルと同じ品質ゲートを実行します。AWS認証情報は要求しません。

## Spec Kit

ロードマップの各Issueは、次の順でSpec Kitを実行します。

1. `specify`
2. `clarify`
3. `plan`
4. `tasks`
5. `analyze`
6. `implement`

`clarify`と`analyze`を省略せず、CriticalまたはHighの指摘を解消してから実装へ進みます。
Issue #1の成果物は`specs/001-development-foundation/`にあります。
