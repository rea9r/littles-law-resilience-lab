// 一定の到着率（オープンモデル）で負荷をかける。サーバーが遅くなっても送る量は減らない
import http from 'k6/http';

const BASE_URL = __ENV.BASE_URL || 'http://order-api.app.svc.cluster.local:8080';
const ORDERS_RPS = Number(__ENV.ORDERS_RPS || 60);
const PRODUCTS_RPS = Number(__ENV.PRODUCTS_RPS || 10);
const DURATION = __ENV.DURATION || '6m';
const TIMEOUT_SECONDS = Number(__ENV.HTTP_TIMEOUT_SECONDS || 5);

// 同時に待てる VU の数 = 到着率 × 1 リクエストの最大待ち時間（これもリトルの法則）
// 最初から全部作っておく。足りない VU を途中で作り足すと、作り足す間の到着を捨ててしまう
const vus = (rps) => Math.ceil(rps * TIMEOUT_SECONDS * 1.2) + 5;

export const options = {
  discardResponseBodies: true,
  scenarios: {
    orders: {
      executor: 'constant-arrival-rate',
      exec: 'orders',
      rate: ORDERS_RPS,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: vus(ORDERS_RPS),
      maxVUs: vus(ORDERS_RPS),
    },
    products: {
      executor: 'constant-arrival-rate',
      exec: 'products',
      rate: PRODUCTS_RPS,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: vus(PRODUCTS_RPS),
      maxVUs: vus(PRODUCTS_RPS),
    },
  },
};

const params = (name) => ({
  timeout: `${TIMEOUT_SECONDS}s`,
  headers: { 'Content-Type': 'application/json' },
  tags: { name },
});

export function orders() {
  const body = JSON.stringify({ productId: 1 + Math.floor(Math.random() * 100), quantity: 1 });
  http.post(`${BASE_URL}/orders`, body, params('orders'));
}

export function products() {
  http.get(`${BASE_URL}/products`, params('products'));
}
