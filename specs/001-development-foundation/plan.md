# Issue #1 技術計画

## 構成

| パス | 責務 |
| --- | --- |
| `package.json` | PNPM、品質ゲート、AWS CDKの入口 |
| `pnpm-lock.yaml` | 依存関係の再現 |
| `tsconfig.json` | TypeScript検査の共通設定 |
| `cdk.json` | AWS CDKアプリと出力先の設定 |
| `cdk/bin/app.ts` | CDKアプリのエントリーポイント |
| `cdk/lib/foundation-stack.ts` | 後続実装の基盤Stack |
| `scripts/quality/` | 構成・CDK・Composeの検査 |
| `test/` | 開発基盤の契約テスト |
| `compose.yaml` | Ministackのローカル起動定義 |
| `.github/workflows/quality.yml` | CI品質ゲート |
| `README.md` | ローカル開発と品質ゲートの手順 |

## 品質ゲート設計

`quality`は次の順に実行する。

1. `format:check`
2. `lint`
3. `typecheck`
4. `test`
5. `foundation:check`
6. `docs:check`
7. `cdk:check`
8. `ministack:check`

CDK synthはAWS認証情報なしで実行し、Context lookupを使わない。CDK CLIがない場合は、
実行できないことを明示して終了する。成功扱いに丸めない。

## セキュリティ設計

- ComposeのSecretは環境変数から渡し、リポジトリへ値を保存しない
- AWSの認証情報をCIへ追加しない
- CDKのContext lookupを使わず、Issue #1でAWSアカウント情報を要求しない
- 品質スクリプトは固定されたプロジェクト内のパスだけを読む

## 検証境界

Issue #1で検証するのは、依存関係、設定ファイル、品質スクリプト、CDK synth、Compose定義、
CI YAMLの整合性である。AWSリソースの作成やMinistack上の結合テストは対象外とする。
