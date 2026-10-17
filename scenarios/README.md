# シナリオ

すべてのシナリオで、同じ負荷（`/orders` 60 rps、`/products` 10 rps）をかけたまま、payment-api の応答に 5 秒の遅延を 2 分間注入する。設定の差分は `k8s/scenarios/<シナリオ>/kustomization.yaml` にある。

## 共通の前提（base の値）

| 項目 | 値 |
|---|---|
| order-api の Tomcat スレッド数（maxThreads） | 40 |
| order-api の HikariCP のプール | 10（取得待ちの上限は既定の 30 秒） |
| payment-api の応答時間 | 平均 50ms、p99 120ms |
| payment-api の処理能力 | スレッド 6 ÷ 平均 0.05 秒 = 120 rps |
| 1 回の流れ | ウォームアップ 60 秒 → 平常時 60 秒 → 障害 120 秒 → 回復 120 秒 |

## 平常時の見積もり

- スレッド：L = 60 rps × 約 0.06 秒 + 10 rps × 約 0.005 秒 ≈ 3.6（上限 40 に対して 1 割弱）
- タイムアウトの窓：下限は平常時の p99 120ms に余裕を足して約 200ms、上限は 40 × 0.7 ÷ 60 rps ≈ 470ms

各シナリオの予測と合格条件は `<シナリオ>/prediction.md`、結果は `<シナリオ>/results/` にある。
