#!/usr/bin/env bash
# 1 つのシナリオを実行する：設定を適用 → 負荷開始 → 平常時 → 遅延を注入 → 解除 → 回復 → 被害スコアを書き出す
# 使い方: scenarios/run.sh 00-no-defense
set -euo pipefail
cd "$(dirname "$0")/.."

SCENARIO=${1:?usage: scenarios/run.sh <scenario>}
WARMUP=${WARMUP:-60}
NORMAL=${NORMAL:-60}
FAULT=${FAULT:-120}
RECOVERY=${RECOVERY:-120}
FAULT_LATENCY_MS=${FAULT_LATENCY_MS:-5000}
ORDERS_RPS=${ORDERS_RPS:-60}
PRODUCTS_RPS=${PRODUCTS_RPS:-10}

TOXIPROXY=http://localhost:8474
GRAFANA=http://localhost:3000
TESTID="$SCENARIO-$(date +%Y%m%d-%H%M%S)"
OUT="scenarios/$SCENARIO/results"
mkdir -p "$OUT/raw"

now_ms() { python3 -I -c 'import time; print(int(time.time() * 1000))'; }

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

# Grafana に時刻 $2（ミリ秒）のアノテーションを付けて ID を返す
annotate() {
  curl -s -X POST "$GRAFANA/api/annotations" -H 'Content-Type: application/json' \
    -d "{\"dashboardUID\":\"lab\",\"time\":$2,\"tags\":[\"$SCENARIO\"],\"text\":\"$1\"}" \
    | python3 -I -c 'import json,sys; print(json.load(sys.stdin).get("id",""))' 2>/dev/null || true
}

# 点のアノテーションに終了時刻を足して、障害の時間帯を帯で表示する
close_annotation() {
  [ -n "$1" ] || return 0
  curl -s -X PATCH "$GRAFANA/api/annotations/$1" -H 'Content-Type: application/json' \
    -d "{\"timeEnd\":$(now_ms),\"text\":\"$2\"}" >/dev/null || true
}

clear_fault() {
  curl -s -X DELETE "$TOXIPROXY/proxies/payment-api/toxics/latency" >/dev/null || true
}

# 遅延を入れ、API にリクエストを送る直前と応答を受けた直後の時刻（ミリ秒）を出す。遅延が効き始めるのはこの間
# 時刻を別のプロセスで取ると、その起動の分だけ記録が遅れるので、接続を済ませてから同じプロセスで前後を測る
inject_fault() {
  python3 -I - "$TOXIPROXY" "$FAULT_LATENCY_MS" <<'PY'
import http.client, json, sys, time, urllib.parse

url = urllib.parse.urlsplit(sys.argv[1])
body = json.dumps({"name": "latency", "type": "latency", "stream": "downstream",
                   "attributes": {"latency": int(sys.argv[2]), "jitter": 0}})
conn = http.client.HTTPConnection(url.hostname, url.port, timeout=10)
conn.connect()
before = time.time()
conn.request("POST", "/proxies/payment-api/toxics", body, {"Content-Type": "application/json"})
res = conn.getresponse()
res.read()
after = time.time()
if res.status != 200:
    sys.exit(f"Toxiproxy が {res.status} を返した")
print(int(before * 1000), int(after * 1000))
PY
}

restart_count() {
  kubectl -n app get pod -l app=order-api -o jsonpath='{.items[0].status.containerStatuses[0].restartCount}'
}

log "シナリオ $SCENARIO の設定を適用"
clear_fault
kubectl apply -k "k8s/scenarios/$SCENARIO" >/dev/null
kubectl -n app rollout status deploy/payment-api --timeout=300s >/dev/null
kubectl -n app rollout status deploy/order-api --timeout=300s >/dev/null
# 古い Pod が消えきるのを待つ（restartCount を新しい Pod から読むため）
for _ in $(seq 60); do
  [ "$(kubectl -n app get pod -l app=order-api --no-headers 2>/dev/null | wc -l | tr -d ' ')" = 1 ] && break
  sleep 2
done
CM=$(kubectl -n app get deploy order-api -o jsonpath='{.spec.template.spec.containers[0].envFrom[0].configMapRef.name}')
kubectl -n app get configmap "$CM" -o jsonpath='{.data}' > "$OUT/raw/order-api-config.json"
CMB=$(kubectl -n app get deploy payment-api -o jsonpath='{.spec.template.spec.containers[0].envFrom[0].configMapRef.name}')
kubectl -n app get configmap "$CMB" -o jsonpath='{.data}' > "$OUT/raw/payment-api-config.json"
RESTARTS_BEFORE=$(restart_count)

TOTAL=$((WARMUP + NORMAL + FAULT + RECOVERY))
log "k6 を開始（${TOTAL} 秒、/orders ${ORDERS_RPS} rps、/products ${PRODUCTS_RPS} rps）"
kubectl -n loadtest delete job k6 --ignore-not-found --wait=true >/dev/null
kubectl -n loadtest create configmap k6-script --from-file=loadtest/orders-products.js \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null
sed -e "s/__TESTID__/$TESTID/" -e "s/__DURATION__/${TOTAL}s/" \
  -e "s/__ORDERS_RPS__/$ORDERS_RPS/" -e "s/__PRODUCTS_RPS__/$PRODUCTS_RPS/" \
  k8s/loadtest/job.yaml | kubectl apply -f - >/dev/null
until kubectl -n loadtest get pod -l job-name=k6 -o name 2>/dev/null | grep -q .; do sleep 1; done
kubectl -n loadtest wait --for=condition=Ready pod -l job-name=k6 --timeout=120s >/dev/null
T_START=$(date +%s)

sleep "$WARMUP"
T_NORMAL_START=$(date +%s)
log "平常時（${NORMAL} 秒）"
sleep "$NORMAL"

FAULT_MS=$(inject_fault)
read -r FAULT_BEFORE_MS FAULT_AFTER_MS <<< "$FAULT_MS"
FAULT_START_MS=$(( (FAULT_BEFORE_MS + FAULT_AFTER_MS) / 2 ))
T_FAULT_START=$((FAULT_START_MS / 1000))
FAULT_ANNOTATION=$(annotate "障害中：payment-api の応答に ${FAULT_LATENCY_MS}ms の遅延" "$FAULT_START_MS")
log "障害開始：payment-api の応答に ${FAULT_LATENCY_MS}ms の遅延（${FAULT} 秒）"
sleep "$FAULT"

clear_fault
T_FAULT_END=$(date +%s)
close_annotation "$FAULT_ANNOTATION" "障害：payment-api の応答に ${FAULT_LATENCY_MS}ms の遅延"
log "遅延を解除（回復を ${RECOVERY} 秒観察）"
sleep "$RECOVERY"
T_END=$(date +%s)

kubectl -n loadtest wait --for=condition=complete job/k6 --timeout=180s >/dev/null || log "k6 の終了を確認できませんでした"
kubectl -n loadtest logs job/k6 > "$OUT/raw/k6.log" 2>&1 || true
kubectl -n app get events --sort-by=.lastTimestamp --field-selector involvedObject.kind=Pod > "$OUT/raw/events.txt" 2>&1 || true
RESTARTS=$(( $(restart_count) - RESTARTS_BEFORE ))

log "被害スコアを集計"
python3 -I scenarios/score.py \
  --scenario "$SCENARIO" --testid "$TESTID" \
  --t-start "$T_START" --t-normal-start "$T_NORMAL_START" \
  --t-fault-start "$T_FAULT_START" --t-fault-end "$T_FAULT_END" --t-end "$T_END" \
  --fault-before-ms "$FAULT_BEFORE_MS" --fault-after-ms "$FAULT_AFTER_MS" --restarts "$RESTARTS" --out "$OUT"

if [ -d tools/node_modules ]; then
  log "グラフを PNG に書き出す"
  node tools/capture.mjs "$OUT" >/dev/null && log "→ $OUT/panels/"
fi
