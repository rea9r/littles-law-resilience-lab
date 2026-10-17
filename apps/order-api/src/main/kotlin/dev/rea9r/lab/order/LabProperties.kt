package dev.rea9r.lab.order

import org.springframework.boot.context.properties.ConfigurationProperties
import java.time.Duration

/** シナリオごとに切り替える設定。値は application.yml 経由で環境変数（LAB_*）から入る */
@ConfigurationProperties("lab")
data class LabProperties(
    val payment: Payment,
    val resilience: Resilience,
) {
    data class Payment(
        val baseUrl: String,
        val connectTimeout: Duration,
        /** 決済 API の呼び出し 1 回あたりの上限。障害時はこれがそのまま W になる */
        val timeout: Duration,
        /** true なら注文のトランザクションの中で決済 API を呼ぶ（コネクションを握ったまま待つ） */
        val callInTransaction: Boolean,
    )

    data class Resilience(
        val bulkheadEnabled: Boolean,
        val circuitBreakerEnabled: Boolean,
        val retryEnabled: Boolean,
    )
}
