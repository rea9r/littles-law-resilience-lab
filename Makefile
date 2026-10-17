CLUSTER := lab
SCENARIOS := 00-no-defense 01a-timeout 01b-tx-boundary 02a-no-window 02b-bulkhead 03a-retry 03b-circuit-breaker 04-all-defenses

.PHONY: up cluster images load deploy reload down scenario-% scenarios

## クラスタ作成からデプロイまで
up: cluster images load deploy

cluster:
	@kind get clusters | grep -qx $(CLUSTER) || kind create cluster --config kind/cluster.yaml

images:
	./gradlew -q bootJar
	docker build -q -t order-api:dev apps/order-api
	docker build -q -t payment-api:dev apps/payment-api

load:
	kind load docker-image order-api:dev payment-api:dev --name $(CLUSTER)

deploy:
	kubectl apply -k k8s/scenarios/00-no-defense
	kubectl apply -k k8s/observability
	for d in postgres toxiproxy payment-api order-api; do kubectl -n app rollout status deploy/$$d --timeout=300s; done
	for d in prometheus grafana; do kubectl -n observability rollout status deploy/$$d --timeout=300s; done
	@echo "Grafana: http://localhost:3000"

## アプリを作り直して入れ替える
reload: images load
	kubectl -n app rollout restart deploy/order-api deploy/payment-api
	for d in payment-api order-api; do kubectl -n app rollout status deploy/$$d --timeout=300s; done

## 例: make scenario-00-no-defense
scenario-%:
	scenarios/run.sh $*

## 全シナリオを順に実行（約 1 時間）
scenarios:
	@for s in $(SCENARIOS); do scenarios/run.sh $$s || exit 1; done

down:
	kind delete cluster --name $(CLUSTER)
