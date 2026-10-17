package dev.rea9r.lab.order

import io.github.resilience4j.bulkhead.Bulkhead
import io.github.resilience4j.bulkhead.BulkheadRegistry
import io.github.resilience4j.circuitbreaker.CircuitBreaker
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry
import io.github.resilience4j.retry.Retry
import io.github.resilience4j.retry.RetryRegistry
import org.springframework.http.client.JdkClientHttpRequestFactory
import org.springframework.stereotype.Component
import org.springframework.web.client.RestClient
import java.net.http.HttpClient
import java.util.function.Supplier

@Component
class PaymentClient(
    builder: RestClient.Builder,
    private val props: LabProperties,
    bulkheadRegistry: BulkheadRegistry,
    circuitBreakerRegistry: CircuitBreakerRegistry,
    retryRegistry: RetryRegistry,
) {
    // タイムアウトは HTTP クライアントで掛ける。Resilience4j の TimeLimiter はブロッキング呼び出しには効かない
    private val restClient = builder
        .baseUrl(props.payment.baseUrl)
        .requestFactory(
            JdkClientHttpRequestFactory(
                HttpClient.newBuilder()
                    .version(HttpClient.Version.HTTP_1_1)
                    .connectTimeout(props.payment.connectTimeout)
                    .build(),
            ).apply { setReadTimeout(props.payment.timeout) },
        )
        .build()

    private val bulkhead = bulkheadRegistry.bulkhead("payment")
    private val circuitBreaker = circuitBreakerRegistry.circuitBreaker("payment")
    private val retry = retryRegistry.retry("payment")

    fun authorize() {
        var call = Supplier { restClient.post().uri("/payments/authorize").retrieve().toBodilessEntity() }

        // 内側から順に包む。アノテーションを使ったときの既定の順序と同じく Retry(CircuitBreaker(Bulkhead(呼び出し)))。
        // Retry が一番外側なので、試行のたびに Bulkhead と CircuitBreaker を通り直す。
        if (props.resilience.bulkheadEnabled) call = Bulkhead.decorateSupplier(bulkhead, call)
        if (props.resilience.circuitBreakerEnabled) call = CircuitBreaker.decorateSupplier(circuitBreaker, call)
        if (props.resilience.retryEnabled) call = Retry.decorateSupplier(retry, call)

        call.get()
    }
}
