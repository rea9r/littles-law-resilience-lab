package dev.rea9r.lab.order

import io.github.resilience4j.bulkhead.BulkheadFullException
import io.github.resilience4j.circuitbreaker.CallNotPermittedException
import jakarta.servlet.http.HttpServletRequest
import org.springframework.dao.DataAccessResourceFailureException
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.transaction.CannotCreateTransactionException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import org.springframework.web.client.ResourceAccessException
import org.springframework.web.client.RestClientResponseException
import org.springframework.web.filter.ServerHttpObservationFilter

data class ErrorResponse(val error: String)

/** 失敗の理由をステータスと本文で区別できるようにする */
@RestControllerAdvice
class ErrorHandler {
    @ExceptionHandler(BulkheadFullException::class)
    fun bulkheadFull(e: Exception, request: HttpServletRequest) =
        error(e, request, HttpStatus.SERVICE_UNAVAILABLE, "bulkhead-full")

    @ExceptionHandler(CallNotPermittedException::class)
    fun circuitOpen(e: Exception, request: HttpServletRequest) =
        error(e, request, HttpStatus.SERVICE_UNAVAILABLE, "circuit-open")

    @ExceptionHandler(ResourceAccessException::class)
    fun paymentTimeout(e: Exception, request: HttpServletRequest) =
        error(e, request, HttpStatus.GATEWAY_TIMEOUT, "payment-timeout")

    @ExceptionHandler(RestClientResponseException::class)
    fun paymentError(e: Exception, request: HttpServletRequest) =
        error(e, request, HttpStatus.BAD_GATEWAY, "payment-error")

    @ExceptionHandler(CannotCreateTransactionException::class, DataAccessResourceFailureException::class)
    fun dbConnectionTimeout(e: Exception, request: HttpServletRequest) =
        error(e, request, HttpStatus.SERVICE_UNAVAILABLE, "db-connection-timeout")

    private fun error(e: Exception, request: HttpServletRequest, status: HttpStatus, reason: String): ResponseEntity<ErrorResponse> {
        // @ExceptionHandler で処理した例外はそのままだとメトリクスの exception タグが none になるので、明示的に記録する
        ServerHttpObservationFilter.findObservationContext(request).ifPresent { it.setError(e) }
        return ResponseEntity.status(status).body(ErrorResponse(reason))
    }
}
