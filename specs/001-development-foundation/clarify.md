# Issue #1 Clarify結果

## 確定事項

| 項目 | 決定 |
| --- | --- |
| IaC | AWS CDK v2のTypeScriptアプリを使用する |
| Node.js | Node.js 22以上を対象とし、CIではNode.js 22を使用する |
| パッケージ管理 | Corepack経由のPNPMを使用し、packageManagerでバージョンを固定する |
| テスト | Node.js標準テストランナーを基盤にする |
| CDK実行 | Context lookupとAWS認証を使わず、synthでテンプレートを検証する |
| Ministack | Compose定義を開発基盤へ含め、AWS機能の結合テストはIssue #8で追加する |
| AWS認証 | Issue #1では不要。CIにもAWS認証情報を設定しない |
| コミット範囲 | Issue #1の新規基盤ファイルだけをコミットし、既存docsと`.DS_Store`は含めない |

## 未決事項の解消

- Ministackという名称は、顧客向けのAWSエミュレーション環境を指すプロジェクト用語として扱う
- Issue #1ではコンテナ起動そのものより、Compose定義と検証入口を固定する
- CDK Stackへ追加するAWSリソースと、各リソースのIAM設計は後続Issueで決定する
- CI上のDocker実行はGitHub Actionsの標準Docker環境を使い、ローカルでは既存のColima運用に従う

## 出力契約

- 各品質ゲートは成功時に0、失敗時に0以外を返す
- `quality`は最初の失敗で終了し、後続チェックを成功扱いにしない
- CDK synthはContext lookupやAWS APIアクセスを発生させない
- ログへSecret、認証情報、AWSアカウントIDを出力しない

## 判断

このIssueでは、将来のAWS実装を先取りせず、AWS CDKアプリと再現性・品質ゲートの入口だけを固定する。
実AWSへの接続は不要であり、AWS認証が要求された場合はIssue #1の範囲外として停止する。
