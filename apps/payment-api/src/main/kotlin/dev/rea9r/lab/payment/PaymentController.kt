package dev.rea9r.lab.payment

import org.springframework.beans.factory.annotation.Value
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RestController
import java.util.concurrent.ThreadLocalRandom
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.sqrt

data class PaymentResponse(val tookMs: Long)

/**
 * 決済 API のモック。平均と p99 を指定した対数正規分布の時間だけスレッドを止めて返す。
 * Tomcat のスレッド数（maxThreads）がそのまま処理能力の上限になる：上限 rps = maxThreads ÷ 平均応答時間。
 */
@RestController
class PaymentController(
    @Value("\${lab.latency.mean-ms}") meanMs: Double,
    @Value("\${lab.latency.p99-ms}") p99Ms: Double,
) {
    private val sigma: Double
    private val medianMs: Double

    init {
        // 対数正規分布：mean = median·e^(σ²/2)、p99 = median·e^(2.326σ) から σ と median を逆算する
        val z99 = 2.326
        val r = ln(p99Ms / meanMs)
        require(r > 0 && r < z99 * z99 / 2) { "p99/mean must be between 1 and ${exp(z99 * z99 / 2)}" }
        sigma = z99 - sqrt(z99 * z99 - 2 * r)
        medianMs = meanMs / exp(sigma * sigma / 2)
    }

    @PostMapping("/payments/authorize")
    fun authorize(): PaymentResponse {
        val tookMs = (medianMs * exp(sigma * ThreadLocalRandom.current().nextGaussian())).toLong()
        Thread.sleep(tookMs)
        return PaymentResponse(tookMs)
    }
}
