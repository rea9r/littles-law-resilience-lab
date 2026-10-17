"""全シナリオの score.json を読み、被害スコアの比較表（Markdown）を scenarios/SUMMARY.md に書き出す"""

import json
import pathlib

ROOT = pathlib.Path(__file__).parent


def pct(v):
    return "-" if v is None else f"{v * 100:.1f}%"


def num(v, digits=1):
    return "-" if v is None else f"{v:.{digits}f}"


def sec(v):
    return "-" if v is None else f"{v} 秒"


def main():
    rows = []
    for score_path in sorted(ROOT.glob("*/results/score.json")):
        s = json.loads(score_path.read_text())
        n, f = s["normal"], s["fault"]
        rows.append([
            s["scenario"],
            pct(f["products_success"]),
            pct(f["orders_success"]),
            f"{num(f['threads_busy_max'], 0)} / 40",
            sec(s["seconds_until_threads_exhausted"]),
            num(f["hikari_pending_max"], 0),
            pct(f["cpu_avg"]),
            num(f.get("payment_rps"), 0),
            str(s["order_api_restarts"]),
            sec(s["seconds_until_recovered"]),
            f"{num(n['threads_busy_avg'])} / {num(n['lambda_times_w'])}",
            pct(n["orders_success"]),
        ])

    header = [
        "シナリオ",
        "障害中の /products 成功率",
        "障害中の /orders 成功率",
        "スレッドの最大値",
        "スレッドが尽きるまで",
        "コネクション取得待ちの最大",
        "障害中の CPU",
        "障害中に決済 API が受けた呼び出し（件/秒）",
        "再起動",
        "回復まで",
        "平常時の L / λ×W",
        "平常時の /orders 成功率",
    ]
    lines = [
        "# 被害スコアの比較",
        "",
        "`python3 scenarios/summary.py` で各シナリオの `results/score.json` から生成している。",
        "",
        "| " + " | ".join(header) + " |",
        "|" + "---|" * len(header),
    ]
    lines += ["| " + " | ".join(r) + " |" for r in rows]
    (ROOT / "SUMMARY.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
