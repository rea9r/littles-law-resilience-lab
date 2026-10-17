"""1 回のシナリオ実行の被害スコアを Prometheus から集計し、score.json と時系列の CSV を書き出す"""

import argparse
import csv
import json
import math
import pathlib
import urllib.parse
import urllib.request

PROM = "http://localhost:9090"
A = 'job="order-api"'
APIS = 'uri=~"/orders|/products"'


def query(expr, t):
    url = f"{PROM}/api/v1/query?" + urllib.parse.urlencode({"query": expr, "time": t})
    result = json.load(urllib.request.urlopen(url))["data"]["result"]
    if not result:
        return None
    value = float(result[0]["value"][1])
    return None if math.isnan(value) else value


def query_range(expr, start, end, step=1):
    url = f"{PROM}/api/v1/query_range?" + urllib.parse.urlencode(
        {"query": expr, "start": start, "end": end, "step": step}
    )
    result = json.load(urllib.request.urlopen(url))["data"]["result"]
    if not result:
        return []
    return [(int(float(t)), float(v)) for t, v in result[0]["values"] if v != "NaN"]


def ratio(ok, total):
    return None if not total else ok / total


def k6_success(testid, scenario, t_end, seconds):
    sel = f'testid="{testid}",scenario="{scenario}"'
    ok = query(f'sum(increase(k6_http_reqs_total{{{sel},expected_response="true"}}[{seconds}s]))', t_end)
    total = query(f"sum(increase(k6_http_reqs_total{{{sel}}}[{seconds}s]))", t_end)
    return ratio(ok or 0, total)


def window_stats(testid, t_from, t_to):
    n = t_to - t_from
    lam = query(f"sum(increase(http_server_requests_seconds_count{{{A},{APIS}}}[{n}s])) / {n}", t_to)
    w_sum = query(f"sum(increase(http_server_requests_seconds_sum{{{A},{APIS}}}[{n}s]))", t_to)
    w_count = query(f"sum(increase(http_server_requests_seconds_count{{{A},{APIS}}}[{n}s]))", t_to)
    w = ratio(w_sum, w_count)
    return {
        "seconds": n,
        "products_success": k6_success(testid, "products", t_to, n),
        "orders_success": k6_success(testid, "orders", t_to, n),
        "threads_busy_avg": query(f"avg_over_time(tomcat_threads_busy_threads{{{A}}}[{n}s])", t_to),
        "threads_busy_max": query(f"max_over_time(tomcat_threads_busy_threads{{{A}}}[{n}s])", t_to),
        "lambda_rps": lam,
        "w_avg_seconds": w,
        "lambda_times_w": None if lam is None or w is None else lam * w,
        "hikari_active_max": query(f"max_over_time(hikaricp_connections_active{{{A}}}[{n}s])", t_to),
        "hikari_pending_max": query(f"max_over_time(hikaricp_connections_pending{{{A}}}[{n}s])", t_to),
        "cpu_avg": query(f"avg_over_time(process_cpu_usage{{{A}}}[{n}s])", t_to),
        "payment_rps": query(f'sum(increase(http_server_requests_seconds_count{{job="payment-api",uri="/payments/authorize"}}[{n}s])) / {n}', t_to),
        "payment_threads_max": query(f'max_over_time(tomcat_threads_busy_threads{{job="payment-api"}}[{n}s])', t_to),
        "k6_dropped": query(f'sum(increase(k6_dropped_iterations_total{{testid="{testid}"}}[{n}s]))', t_to),
    }


def raw_samples(expr, t_from, seconds):
    url = f"{PROM}/api/v1/query?" + urllib.parse.urlencode({"query": f"{expr}[{seconds}s]", "time": t_from + seconds})
    result = json.load(urllib.request.urlopen(url))["data"]["result"]
    return [] if not result else [(float(t), float(v)) for t, v in result[0]["values"]]


def threads_after_fault(fault_start):
    # 1 秒ごとの生のサンプルで、障害開始から何秒後に何本埋まっていたかを見る（丸めると最大 1 秒ずれるため）
    max_threads = query(f"max(tomcat_threads_config_max_threads{{{A}}})", fault_start)
    samples = [(round(t - fault_start, 2), v) for t, v in raw_samples(f"tomcat_threads_busy_threads{{{A}}}", fault_start, 15)
               if t >= fault_start]
    exhausted = next((t for t, v in samples if max_threads is not None and v >= max_threads), None)
    return exhausted, samples[:6]


def seconds_until_recovered(testid, t_fault_end, t_end, hold=15):
    # 両方の API の成功率（直近 6 秒）が 99% 以上の状態が hold 秒続いた最初の時刻を回復とみなす
    series = {}
    for scenario in ("orders", "products"):
        sel = f'testid="{testid}",scenario="{scenario}"'
        expr = (
            f'sum(rate(k6_http_reqs_total{{{sel},expected_response="true"}}[6s]))'
            f" / sum(rate(k6_http_reqs_total{{{sel}}}[6s]))"
        )
        series[scenario] = dict(query_range(expr, t_fault_end, t_end))
    healthy_since = None
    for t in range(t_fault_end, t_end + 1):
        ok = all(series[s].get(t, 0) >= 0.99 for s in series)
        if ok:
            healthy_since = healthy_since or t
            if t - healthy_since >= hold:
                return healthy_since - t_fault_end
        else:
            healthy_since = None
    return None


TIMESERIES = {
    "threads_busy": f"max(tomcat_threads_busy_threads{{{A}}})",
    "threads_max": f"max(tomcat_threads_config_max_threads{{{A}}})",
    "lambda_times_w": f"sum(rate(http_server_requests_seconds_sum{{{A},{APIS}}}[10s]))",
    "hikari_active": f"max(hikaricp_connections_active{{{A}}})",
    "hikari_pending": f"max(hikaricp_connections_pending{{{A}}})",
    "cpu": f"max(process_cpu_usage{{{A}}})",
    "uptime": f"max(process_uptime_seconds{{{A}}})",
    "b_threads_busy": 'max(tomcat_threads_busy_threads{job="payment-api"})',
}


def write_timeseries(path, testid, t_start, t_end):
    columns = dict(TIMESERIES)
    for scenario in ("orders", "products"):
        sel = f'testid="{testid}",scenario="{scenario}"'
        columns[f"{scenario}_success"] = (
            f'sum(rate(k6_http_reqs_total{{{sel},expected_response="true"}}[6s]))'
            f" / sum(rate(k6_http_reqs_total{{{sel}}}[6s]))"
        )
    data = {name: dict(query_range(expr, t_start, t_end)) for name, expr in columns.items()}
    with open(path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["t", *columns])
        for t in range(t_start, t_end + 1):
            writer.writerow([t - t_start, *[data[c].get(t, "") for c in columns]])


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--scenario", required=True)
    p.add_argument("--testid", required=True)
    for name in ("t-start", "t-normal-start", "t-fault-start", "t-fault-end", "t-end",
                 "fault-before-ms", "fault-after-ms", "restarts"):
        p.add_argument(f"--{name}", type=int, required=True)
    p.add_argument("--out", required=True)
    a = p.parse_args()

    out = pathlib.Path(a.out)
    raw = out / "raw"
    config = {}
    for app in ("order-api", "payment-api"):
        cfg = raw / f"{app}-config.json"
        if cfg.exists():
            config[app] = json.loads(cfg.read_text())

    # 遅延が効き始めたのは、遅延を入れる API を呼ぶ直前と、応答を受けた直後の間。その中点を障害の時刻とする
    fault_start_ms = (a.fault_before_ms + a.fault_after_ms) / 2
    exhausted, samples_after_fault = threads_after_fault(fault_start_ms / 1000)
    score = {
        "scenario": a.scenario,
        "testid": a.testid,
        "config": config,
        "normal": window_stats(a.testid, a.t_normal_start, a.t_fault_start),
        "fault": window_stats(a.testid, a.t_fault_start, a.t_fault_end),
        "recovery": window_stats(a.testid, a.t_fault_end, a.t_end),
        "seconds_until_threads_exhausted": exhausted,
        "threads_after_fault": samples_after_fault,
        "seconds_until_recovered": seconds_until_recovered(a.testid, a.t_fault_end, a.t_end),
        "order_api_restarts": a.restarts,
        "timeline": {
            "start": a.t_start,
            "normal_start": a.t_normal_start,
            "fault_start": a.t_fault_start,
            "fault_start_ms": fault_start_ms,
            "fault_inject_ms": [a.fault_before_ms, a.fault_after_ms],
            "fault_end": a.t_fault_end,
            "end": a.t_end,
        },
    }
    (out / "score.json").write_text(json.dumps(score, ensure_ascii=False, indent=2) + "\n")
    write_timeseries(raw / "timeseries.csv", a.testid, a.t_start, a.t_end)

    def pct(v):
        return "-" if v is None else f"{v * 100:.1f}%"

    f = score["fault"]
    print(f"[{a.scenario}] 障害中：/products 成功率 {pct(f['products_success'])}、/orders 成功率 {pct(f['orders_success'])}")
    print(f"  スレッド最大 {f['threads_busy_max']}、枯渇まで {score['seconds_until_threads_exhausted']} 秒、"
          f"取得待ち最大 {f['hikari_pending_max']}、CPU 平均 {pct(f['cpu_avg'])}")
    print(f"  再起動 {a.restarts} 回、回復まで {score['seconds_until_recovered']} 秒")
    n = score["normal"]
    print(f"  平常時：実測 L {n['threads_busy_avg']}、λ×W {n['lambda_times_w']}")


if __name__ == "__main__":
    main()
