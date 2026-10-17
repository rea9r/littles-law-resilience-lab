# 記事の本文（書いた節から）

[記事の構成](article-outline.md)のうち、本文を書いた節。図に書くもの（部品の名前、数と式、凡例、切り口の注釈）と、本文に書くもの（前提、結果の流れ、計算や単純化の断り、実測との比べ、次の節への橋渡し）を分けて、図と本文をあわせて読む前提で書いている。図の注記を本文で言い直さず、本文には図から読み取ってほしい解釈と、図の外のこと（タイムアウトのあと、コネクション、実測）を書く。画像のパスは Zenn に移すときに `/images/...` に直す。

---

### 3.2 λW が上限を超えると、共有している資源を通じて広がる

order-api のスレッド 40 本は /orders・/products・/livez のすべてで、HikariCP のコネクション 10 本は /orders と /products で共有しています。この節では、Resilience4j などの防御をまだ何も入れていない状態（5 章の実験 0 と同じ設定）で考えます。

/orders は、決済 API の応答が返るまでスレッドを 1 本握ったままにします。上限がなければ、同時に握る本数は λW で決まります。/products は DB を読むだけで 1 ミリ秒足らずで返るので、スレッドはほとんど使いません。決済 API の応答が 0.05 秒から 5.05 秒になると、λW は平常時の 3 本から 300 本になり、上限の 40 本を大きく超えます。

![障害の広がり方](images/failure-spread.ja.png)
*スレッドだけを描いた単純化。コネクションについては下の本文*

40 本がすべて埋まると、あとから来たリクエストは、どのエンドポイント宛てかに関係なく、Tomcat の中の 1 本の列に並んでスレッドの空きを待ちます。負荷をかける k6 は 5 秒でタイムアウトします（決済 API に入れた遅延の 5 秒とは別の設定です）。そのため、次のことが起きます。

- **/products**：決済 API を呼ばないのに、空きを待つうちに 5 秒を過ぎ、ほぼすべて失敗する
- **/orders**：スレッドを取れても 5 秒以内には返らず、失敗する。クライアントがあきらめたあとも処理は続き、スレッドは握られたまま
- **/livez**：応答できず、Kubernetes が Pod を再起動する

コネクションでも同じことが起きます。実験 0 では決済 API をトランザクションの中で呼ぶので、/orders はコネクションも 5.05 秒握ります。コネクションの λW も約 300 本です。上限は 10 本とスレッドより少ないので、スレッドより先に尽きます。そのあとスレッドが埋まるまでのあいだにスレッドを取れた /products も、コネクションの空きを待ちます。2 つの共有の資源がどちらも上限を超えているので、片方だけを増やしても /products は助かりません。6 章では、この 2 つの W を順に抑えます。

遅くなったのは決済 API だけです。それでも、共有している資源を通じて、決済と関係のない API まで止まります。

---

### 5.2 予測：何秒で、どこまで壊れるか

3.2 の 300 本は、上限がなかった場合に、流れが落ち着いたあとの値です。障害の直後にスレッドがどう埋まるかは、1 件ずつの動きを追うと分かります。到着を等間隔にし、スレッドだけを数えて計算したのが次の図です。

図の 1 行が 1 本のスレッドです。縦に切ったときに交わる棒の数が、その瞬間に使っているスレッドの数 L になります。障害の前は、0.05 秒の短い棒が上の 3 行を入れ替わりで使っています（/products は 1 ミリ秒足らずで返るので、棒は描いていません）。

![障害の直後にスレッドが埋まっていく様子（計算）](images/thread-timeline.ja.png)
*計算（実測ではない）*

図から読み取ってほしいことは 3 つです。

- **埋まるまでの時間は、空いている本数と到着率で決まる。** 障害の時点で処理中だった 3 件も応答が遅れるので、空いているのは 37 本です。終わる棒がないまま 1 秒に 60 本ずつ増えるので、約 0.6 秒で埋まります。棒が十分に長ければ、5 秒でも 30 秒でも同じです（どこまで短くすれば埋まらないかは、6.1 で求めます）
- **上限がなくても、300 本にはすぐにはならない。** 1.0 秒の時点では 63 本です。300 本で落ち着くのは、最初の棒が終わり始め、増える棒と終わる棒が釣り合う 5 秒後からです
- **L = λW の λ は、その資源に実際に入る率。** 2 章では λ を到着率と呼びましたが、上限で頭打ちのあいだ、スレッドに入れる率は到着率よりずっと小さくなります。0.6〜5 秒は 1 件も入れず、5 秒後からは平均で 40 ÷ 5.05 ≈ 8 件/秒です。落ち着けば 40 本 = 8 件/秒 × 5.05 秒で成り立ちます。入れなかった分は列に並び、伸び続けます（図の上の帯）。上限がなければ入る率は到着率と同じなので、3.2 の 60 件/秒 × 5.05 秒 ≈ 300 本になります

予測は「障害から約 0.6 秒で 40 本が埋まり、/products は列に並んで 5 秒でタイムアウトする」です。

:::details 実験 0 では、もう少し早く埋まるはず
実験 0 では決済 API をトランザクションの中で呼ぶので、コネクション 10 本が先に (10 − 3) ÷ 60 ≈ 0.12 秒で尽きます。このとき使っているスレッドは、コネクションを握った /orders の 10 本です。そのあとは /products もコネクションの空きを待つあいだ（HikariCP の取得待ちの上限は 30 秒）スレッドを握るので、残りの 30 本は 1 秒に 70 本ずつ埋まり、0.12 + 30 ÷ 70 ≈ 0.55 秒で満杯になります。
:::

### 5.3 実測：2 回とも、障害の直後の計測で 40 本に達する

計測は 1 秒ごとです（計測は業務とは別のポートで受けているので、40 本が埋まっても測れます）。予測の約 0.6 秒は計測の間隔より短いので、障害の直後の 1〜2 点で確かめます。障害の時刻をミリ秒で記録した 2 回の実行を比べます。

![障害の前後 15 秒のスレッド（2 回目の実行）](../scenarios/00-no-defense/results/panels/threads-fault.png)
*2 回目の実行。赤い帯が障害の区間。次の計測で 3 本から 40 本に跳ね上がり、そのまま横ばい*

2 回目の実行では、障害の 0.48 秒後の最初の計測で、40 本すべてが埋まっていました。図の計算（0.48 秒で 32 本）より早い側です。1 回目は、0.40 秒後に 24 本で、図の計算（27 本）より少し少なく、次の 1.40 秒後の計測で 40 本でした。2 回とも、計算の前後に数本ずつ散りながら、障害の直後の 1〜2 点で 40 本に達しています（ずれの理由は下の折りたたみ）。

![障害の前後 15 秒の HikariCP（2 回目の実行）](../scenarios/00-no-defense/results/panels/hikari-fault.png)

コネクションは、どの計測でも 10 本とも使われていて、握っている 10 本と待っている本数を足すと、スレッドの本数に一致しました（2 回目の 0.48 秒は 10 + 30 = 40、1 回目の 0.40 秒は 10 + 14 = 24）。1 回目の 0.40 秒の時点で、コネクションはもう尽きていたことになります。/products が 5 秒でタイムアウトしたことは、5.4 の成功率で確かめます。

:::details 計算とのずれの理由
コネクションの分を足した計算（5.2 の折りたたみ）では、0.40 秒で 30 本、0.48 秒で 35 本です（処理中だった 3 本 + /orders の 60 件/秒 × 経過時間 + コネクションが尽きた 0.12 秒からの /products 10 件/秒 × 経過時間）。1 回目はこれより 6 本少なく、2 回目は 5 本多くなっています。

- **2 回目が多い理由**：2 つ考えられます。1 つは障害を入れた時刻の記録の遅れです。時刻は、遅延を入れる API の応答が返ってから、別のプロセスを起動して取っています。応答が返るまでと、起動にかかる時間（この Mac で 15〜20 ミリ秒）の分だけ記録が遅れ、経過時間は数十ミリ秒短く出ます（1〜3 本ぶん）。もう 1 つは、障害の時点で処理中だった本数です。平常時は 2〜5 本でぶれるので、3 本より多かった可能性があります
- **1 回目が少ない理由**：k6 が障害の直後に送りきれなかったためと考えています。k6 は、応答を待っているリクエスト 1 件に 1 VU を使い、空いた VU がなければ、その回を捨てて VU を作り足します。障害の前に用意してあった VU は、2 つのシナリオの合計で 1 回目が 17（/orders に使えるのは多くて 12）、2 回目が 43 でした（作った VU は残るので、それまでの経過で実行ごとに数が違います）。1 回目は、/orders に使える空きの VU が障害から 0.15 秒ほどで尽き、そのあとは VU を作り足す速さ（1 秒に約 30）でしか送れていません。2 回目は、満杯になる 0.5 秒ごろまでは、用意してあった VU で足りていました。障害から 2 秒ほどで送れなかった /orders は 1 回目が 54 件、2 回目が 43 件ですが、2 回目の分は満杯のあとに出たはずです
:::

---

## README の該当部分（英語）

README の「What is shared inside order-api」の図のすぐ後に置く。

> ## What goes wrong
>
> With no defenses enabled (scenario `00-no-defense`), every endpoint of order-api shares the same 40 Tomcat threads. Normally the payment API responds in 0.05 s, so by Little's Law `/orders` keeps about 3 threads busy (60 req/s × 0.05 s). When Toxiproxy adds 5 s of latency, `/orders` would need about 300 threads at once. Once all 40 are busy, new requests wait in a single FIFO queue inside Tomcat, regardless of endpoint. `/products`, which never calls the payment API, sits in that queue until k6 gives up at its own 5 s timeout (a client setting, unrelated to the injected delay). `/livez` is stuck in the same queue, so the liveness probe fails and Kubernetes restarts the Pod.
>
> ![How the failure spreads](docs/images/failure-spread.en.png)
>
> The 10 DB connections run out too, and even sooner. `/orders` calls the payment API inside a DB transaction, so each request also holds a connection for the full 5.05 s, and with only 10 of them the connections are gone before the threads. After that, a `/products` request that gets a thread blocks waiting for a connection, so it holds the thread as well.
>
> The 300 above is steady-state demand: without the limit, demand would grow by 60 every second and reach about 300 only after 5 s, and busy threads never get there because the pool is capped at 40. What matters is how fast the 40 fill up. The chart below is a calculation, not a measurement: each row is one thread and each bar one `/orders` request, with evenly spaced arrivals and threads only. The 37 idle threads are used up in about 37 ÷ 60 ≈ 0.6 s.
>
> ![Threads filling up right after the fault](docs/images/thread-timeline.en.png)
>
> Metrics are sampled about once a second. In one run, the first sample after the fault (0.48 s) already showed all 40 threads busy, a little earlier than the chart: once the connections are gone, `/products` holds threads too, which brings the estimate down to about 0.55 s. In the other run, 24 threads were busy at 0.40 s (the chart says 27), and the next sample, at 1.40 s, showed all 40.
