package dev.rea9r.lab.order

import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RestController

data class Product(val id: Long, val name: String, val price: Int)

data class OrderRequest(val productId: Long, val quantity: Int)

data class OrderResponse(val orderId: Long)

@RestController
class LabController(
    private val jdbc: JdbcClient,
    private val orderService: OrderService,
) {
    /** 決済 API を使わない API。DB を読むだけ */
    @GetMapping("/products")
    fun products(): List<Product> =
        jdbc.sql("select id, name, price from products order by id limit 20")
            .query { rs, _ -> Product(rs.getLong("id"), rs.getString("name"), rs.getInt("price")) }
            .list()

    /** 決済 API を呼ぶ API */
    @PostMapping("/orders")
    fun order(@RequestBody request: OrderRequest): OrderResponse =
        OrderResponse(orderService.placeOrder(request.productId, request.quantity))
}
