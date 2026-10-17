package dev.rea9r.lab.order

import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Service
import org.springframework.transaction.support.TransactionTemplate

@Service
class OrderService(
    private val jdbc: JdbcClient,
    private val tx: TransactionTemplate,
    private val paymentClient: PaymentClient,
    private val props: LabProperties,
) {
    fun placeOrder(productId: Long, quantity: Int): Long =
        if (props.payment.callInTransaction) {
            // よくある書き方：注文を仮登録 → 決済 API で与信 → 確定、を 1 つのトランザクションで行う。
            // 決済 API を待っている間もコネクションを握り続けるので、コネクションの保持時間（W）に決済 API の応答時間が入る。
            tx.execute {
                val orderId = insertOrder(productId, quantity, "PENDING")
                paymentClient.authorize()
                jdbc.sql("update orders set status = 'CONFIRMED' where id = ?").param(orderId).update()
                orderId
            }!!
        } else {
            // 決済 API をトランザクションの外で先に呼ぶ。コネクションを握るのは DB に書く一瞬だけになる
            paymentClient.authorize()
            tx.execute { insertOrder(productId, quantity, "CONFIRMED") }!!
        }

    private fun insertOrder(productId: Long, quantity: Int, status: String): Long =
        jdbc.sql("insert into orders (product_id, quantity, status) values (?, ?, ?) returning id")
            .params(productId, quantity, status)
            .query(Long::class.java)
            .single()
}
