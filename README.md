# littles-law-resilience-lab

When the payment API slows down, APIs that never call it stop too. This lab predicts how such a failure spreads with Little's Law (L = λW), reproduces it on a local kind cluster, and checks how timeouts, bulkheads and circuit breakers should be sized.

![Architecture](docs/images/architecture.en.png)

- **order-api**: Spring Boot (Kotlin), the service under test. `/orders` calls the payment API (inside a DB transaction until scenario 01b moves it out) and stores the order; `/products` only reads the database. Metrics are served on port 8081 by their own threads, so they stay readable when the main 40 run out.
- **payment-api**: a payment API mock that answers after a log-normal delay. Its six threads cap it at about 120 req/s (6 ÷ 0.05 s).
- **Toxiproxy**: sits between the two; `scenarios/run.sh` adds and removes the delay through its admin API.
- **k6**: sends requests at a constant arrival rate (an open model) and pushes its results to Prometheus.

## What goes wrong

With no defenses enabled (scenario `00-no-defense`), every endpoint of order-api shares the same 40 Tomcat threads. Normally the payment API responds in 0.05 s, so by Little's Law `/orders` keeps about 3 threads busy (60 req/s × 0.05 s). When Toxiproxy adds 5 s of latency, `/orders` would eventually need about 300 threads at the same time (60 req/s × 5.05 s). Once all 40 are busy, new requests wait in a single FIFO queue inside Tomcat, regardless of endpoint. Forty threads that each hold a request for 5.05 s can serve only about 8 req/s against 70 arriving, so the queue only grows. `/products`, which never calls the payment API, sits in that queue until k6 gives up at its own 5 s timeout (a client setting, unrelated to the injected delay). `/livez` is stuck in the same queue, so the liveness probe fails and Kubernetes restarts the Pod.

![How the failure spreads](docs/images/failure-spread.en.png)

The 10 DB connections run out too, and sooner than the threads: `/orders` calls the payment API inside a DB transaction, so it holds a connection for the full 5.05 s, and the 7 idle connections are gone in about 7 ÷ 60 ≈ 0.12 s. After that, a `/products` request that gets a thread blocks waiting for a connection, so it ties up the thread too.

The 300 is a steady-state figure. Without a limit, in-flight `/orders` requests would grow by 60 per second and reach about 300 only after 5 s; with the limit, busy threads stop at 40 long before that. What matters is how fast the 40 fill up. The chart below is a calculation, not a measurement: each row is a thread and each bar is one `/orders` request. It assumes evenly spaced arrivals and models only the thread pool, not DB connections. How long each bar lasts doesn't matter once it outlasts the fill-up: with 5 s or 30 s of delay, the 40 threads are gone at the same moment.

![Threads filling up right after the fault](docs/images/thread-timeline.en.png)

Prometheus scrapes the busy-thread count once a second. In one run, the first sample after the fault, 0.48 s in, already showed all 40 busy. In another run, 24 were busy at 0.40 s and all 40 at the next sample, 1.40 s in. The two runs land on either side of the estimate; once-a-second sampling can't resolve it more finely than that.

## Requirements

- Docker with at least 4 GB of memory for containers
- [kind](https://kind.sigs.k8s.io/) and kubectl
- JDK 21 to build the apps
- Node.js and Google Chrome, only to export graphs and diagrams as PNG

Memory limits are tuned so that everything fits in about 4 GB.

## Usage

```bash
make up
```

Creates the cluster, builds the apps and deploys everything. Grafana is at http://localhost:3000.

```bash
make scenario-00-no-defense
```

Runs one scenario and writes its damage score to `scenarios/00-no-defense/results/score.json`. It takes about 7 minutes: applying the scenario and waiting for the Pods, the 6 minutes of load below, then scoring. Use `make scenarios` to run all of them in order (about an hour).

![Timeline of one scenario](docs/images/scenario-timeline.en.png)

The score records the success rates, busy threads and connection waits for the normal and fault windows (and, for the normal one, measured L against λW), how long the threads took to run out within the first 15 s of the fault, the time to recover (until the start of the first 15 s in which both endpoints stay at or above 99% success; "not recovered" if no such 15 s fits within the 120 s after the delay is removed), and the number of Pod restarts during the load.

If `tools/node_modules` exists (`cd tools && npm install`), each run also exports its Grafana panels to `results/panels/`. To export them by hand:

```bash
node tools/capture.mjs scenarios/00-no-defense/results
```

```bash
make down
```

Deletes the cluster.

## Scenarios

Most scenarios switch on one or more defenses. Timeouts and the connection-wait limit cap how long a request waits (W), moving the payment call out of the transaction shortens how long it holds a DB connection (W), the bulkhead caps how many payment calls run at once (L), and the circuit breaker stops calls from going out (λ). The timeout, bulkhead and circuit breaker make `/orders` return sooner, so it also holds its thread for less time. Retries do the opposite and raise both W and λ. The labels in the figure are the scenario names in the table below.

![Where each defense acts](docs/images/defenses.en.png)

*Schematic of one `/orders` request, not to scale. Defenses are marked on the top row, where all three resources nest; from 01b on, requests take the shape of the bottom row.*

| Scenario | What changes | What it shows |
|---|---|---|
| `00-no-defense` | No defense: 30 s timeout, the payment call inside the DB transaction | Threads run out in about a second and `/products` goes down too |
| `01a-timeout` | Timeout cut to 300 ms | Waiting for a DB connection becomes the new W, so it still goes down |
| `01b-tx-boundary` | Payment call moved out of the transaction, 250 ms connection-wait limit | Threads settle around 60 × 0.3 + α ≈ 20 |
| `02a-no-window` | Payment API p99 raised to 600 ms, timeout 800 ms | With no valid timeout window, threads run out |
| `02b-bulkhead` | Bulkhead: at most 12 concurrent payment calls | Capping L keeps `/products` alive |
| `03a-retry` | 01b plus a retry: 3 attempts, 500 ms apart | W grows to 1.9 s; in 2 of 4 runs it had still not recovered 2 minutes after the delay was removed |
| `03b-circuit-breaker` | 03a plus a circuit breaker | Once it opens, cutting the calls to the payment API (λ) makes `/orders` fail fast, so its W drops close to zero |
| `04-all-defenses` | 01b plus a bulkhead, a circuit breaker and a gentler retry (2 attempts, 100 ms apart) | Only `/orders` fails; everything else keeps working |

Results of every scenario are compared in [scenarios/SUMMARY.md](scenarios/SUMMARY.md).

## Documentation (Japanese)

The notes behind the Zenn article are written in Japanese.

- [scenarios/README.md](scenarios/README.md) and `scenarios/<scenario>/prediction.md`: assumptions, predictions and pass criteria written before each run
- [docs/iteration-log.md](docs/iteration-log.md): every place where a prediction missed and how the lab was fixed
- [docs/article-outline.md](docs/article-outline.md): the outline of the article

## Layout

```
apps/order-api/       the service under test
apps/payment-api/     the payment API mock
k8s/base/             apps, database and Toxiproxy (values for "no defense")
k8s/scenarios/        per-scenario differences as kustomize overlays
k8s/observability/    Prometheus and Grafana, dashboard included
loadtest/             k6 script
scenarios/            run script, predictions and results
tools/                panel capture, diagram sources (tools/diagrams) and their renderer
docs/                 iteration log, article outline and diagrams
```

Diagrams are drawn in HTML/SVG under `tools/diagrams/` and exported in Japanese and English with `node tools/render-diagrams.mjs`.

## License

MIT
