#!/usr/bin/env python3
"""system-design import, batch 1/3 (55 cards)."""
import sys
sys.path.insert(0, "/tmp")
from sd_runner import push_cards

SCALING_PLOT = "../../media/41540605d5b8739f0299.webp"

CARDS = {
    1765860631704: ("scaling-laws",
r"""What is scaling law?""",
r"""Scaling laws describe how model performance improves as you scale **data**, **parameters**, or **compute**.

A common form:

$$\mathcal{L}(N) = A N^{-\alpha} + C$$

- $\mathcal{L}$ is loss
- $N$ is model size, dataset size, or compute
- $C$ is the irreducible loss
- $\alpha$ determines how efficiently scaling improves performance

Empirical findings show:

- Larger models trained on more data consistently reduce loss
- Gains diminish predictably, not abruptly
- There are optimal tradeoffs between parameters, data, and compute

![](""" + SCALING_PLOT + ")"),

    1765860787904: ("ml-system-design-framework",
r"""What are the system design framework?""",
r"""1. Clarifying requirements
2. Framing the problem as an ML task
3. Data preparation
4. Model development
5. Evaluation
6. Overall ML system design
7. Deployment and monitoring"""),

    1765861004088: ("non-functional-requirements",
r"""What are Non-functional requirements""",
r"""- **Privacy, ethics, and data security**
- **Business objective:** What is the primary goal of this system? What specific purpose will it serve? For example, when designing an image captioning system, it's essential to know if it will be used for generating detailed product descriptions on an e-commerce platform or for suggesting short captions for photos on social media.
- **System features:** What features should the system support that might influence the ML design? For instance, when designing an image generation system, it's important to know if users can provide feedback or rate the generated images. Similarly, when designing an LLM, it's crucial to know which languages should be supported.
- **Data:** What are the data sources? How large is the dataset? Is the data labeled?
- **Constraints:** What are the available computational resources? Will the system be cloud-based or designed to run on local devices?
- **System scale:** How many users are expected? What is the expected growth in demand?
- **Performance:** How quickly should the content be generated? Is real-time generation required? Is there a higher priority on content quality or generation speed?"""),

    1766115046159: ("perplexity",
r"""What is perplexity""",
r"""Perplexity is a standard evaluation metric for probabilistic language models. It measures how well a model predicts a sequence of tokens.

### Formal definition

Given a sequence of tokens $x_1, x_2, \dots, x_N$ and a model that assigns conditional probabilities $p(x_i \mid x_{<i})$:

$$\text{Perplexity} = \exp\!\left(-\frac{1}{N}\sum_{i=1}^{N}\log p(x_i \mid x_{<i})\right)$$

If natural logarithms are replaced by base-2 logarithms, the exponential becomes $2^{(\cdot)}$.

Lower perplexity means the model is less "surprised" by the data, so it predicts better.

Example intuition:

- Perplexity = 1 means perfect prediction.
- Perplexity = 10 means the model behaves as if it is choosing among 10 equally likely tokens at each position.

### Relation to cross-entropy

Perplexity is a monotonic transform of cross-entropy: $\text{PPL} = \exp(H)$ where $H$ is the average cross-entropy loss. Minimizing cross-entropy is equivalent to minimizing perplexity.

### Limitations

- Only comparable when vocabulary, tokenization, and dataset are identical.
- Does not directly measure downstream task quality or human-perceived fluency.
- Can be misleading for models optimized for instruction following or RLHF rather than next-token likelihood."""),

    1766115478027: ("rlhf",
r"""what is RLHF?""",
r"""RLHF stands for **Reinforcement Learning from Human Feedback**. It is a training paradigm used to align model behavior with human preferences, rather than only maximizing likelihood of training data.

### High-level idea

Instead of training a model only to predict the next token, RLHF trains it to produce outputs that humans judge as better, safer, or more helpful.

### Main components

1. **Base model (pretraining)** — train a language model with supervised learning on large text corpora; objective is next-token prediction, minimizing cross-entropy.
2. **Human feedback collection** — humans rank or score model outputs for the same prompt (e.g., given two answers A and B, a human selects the better one).
3. **Reward model** — train a separate model $R_\phi(x, y)$ to predict human preference scores. This turns qualitative feedback into a scalar reward signal.
4. **Reinforcement learning step** — fine-tune the base model using RL, commonly PPO. The model is rewarded for outputs that receive high reward model scores. A KL penalty keeps the model close to the original pretrained distribution."""),

    1766116151577: ("exact-match-at-n",
r"""what is **ExactMatch@N (EM@N)**""",
r"""**ExactMatch@N (EM@N)** is a top-N exact match metric. It checks whether the correct answer appears **anywhere among the top N model outputs**.

### Definition

For each example $i$, let the model produce an ordered list of N predictions $\hat{y}_{i,1}, \hat{y}_{i,2}, \dots, \hat{y}_{i,N}$.

$$\text{ExactMatch@}N = \frac{1}{M} \sum_{i=1}^{M} \mathbf{1} \!\left( \exists\, k \le N \text{ such that } \hat{y}_{i,k} = y_i \right)$$

where $y_i$ is the ground-truth answer and $M$ is the number of evaluation examples.

### Interpretation

- EM@1 is standard Exact Match.
- EM@N measures whether the model can generate the correct answer within its top N candidates.
- Higher EM@N means better recall under multiple guesses."""),

    1776696645174: ("durability-path",
r"""what is DURABILITY PATH in DBs?""",
r"""```
write to WAL -> fsync -> OS durably on disk -> only then ack
 (replication is a SEPARATE dimension: durable-here vs durable-elsewhere)
```"""),

    1776696885321: ("oltp-vs-olap",
r"""A system handles lots of small, real-time user actions like placing orders, updating profiles, and making payments. Another system is used to scan huge amounts of historical data for dashboards, trends, and business reports. What is the key difference between these two kinds of systems?""",
r"""**OLTP:** the first is optimized for **many small reads/writes with low latency and correctness per transaction**.

**OLAP:** the second is optimized for **large-scale reads, aggregations, and analytics over lots of data**.

A simple way to remember it: one runs the business, the other analyzes the business."""),

    1776697912347: ("btree-storage-engine",
r"""A database stores data in fixed-size pages inside a balanced tree, and updates rows in place. What storage layout is this?""",
r"""**Core idea:** a **B-tree / page-oriented storage engine**.

**Best at:** point lookups, short range scans, OLTP, mixed transactional workloads.

**Why it works well:** very shallow tree, few page reads, linked leaves help range scans.

**Main cost:** small row update can rewrite a whole page, so write amplification matters.

**Common pain points:** page splits, fragmentation, random I/O under heavy writes, vertical write-scaling limit.

**Good interview line:** "In-place page updates make reads efficient, but tiny hot writes can be expensive because the rewrite unit is the page, not the row." """),

    1776698144672: ("lsm-storage-engine",
r"""A storage engine writes to a WAL and an in-memory sorted buffer (memtable), then flushes immutable sorted files (SSTable - Sorted String Table) to disk and later merges them in background. What storage layout is this?""",
r"""**Core idea:** an **LSM-tree storage engine**.

**Best at:** write-heavy workloads, log-style ingest, time-series, KV stores.

**Why it works well:** writes are mostly sequential, so write throughput is very high.

**Main cost:** background compaction rewrites data many times.

**Main tradeoff:** you balance **write amplification, read amplification, and space amplification** — you cannot minimize all three at once.

**Common pain points:** read path may touch multiple SSTables, range scans are slower than B-trees, tombstones linger, compaction can hurt tail latency.

**Good interview line:** "LSM trees turn random writes into sequential writes, but compaction becomes the bill you pay later." """),

    1776698281952: ("btree-vs-lsm-throughput",
r"""How do you compare BTree and LSM; db engines in write, read and scan throughput?""",
r"""Very roughly, on the **same machine**:

- **LSM write throughput:** often **3x to 10x** higher than B-tree for random-write-heavy workloads
- **B-tree point read throughput:** often **1.5x to 5x** higher than LSM
- **B-tree range scan throughput:** often **2x to 10x** higher than LSM, sometimes more for long scans

That is the interview-safe order of magnitude."""),

    1776698477214: ("columnar-storage",
r"""A database stores each column contiguously instead of storing full rows together. What storage layout is this, and what kind of workload is it best for?""",
r"""**Core idea:** a **columnar storage layout**.

**Best at:** OLAP, analytics, dashboards, logs, metrics, large aggregations.

**Why it works well:** reads only needed columns, compresses extremely well (columns have similar data), and can skip many blocks during scans.

**Big advantage:** very high scan throughput, often much better than row stores for analytics.

**Main cost:** reconstructing full rows is expensive.

**Common pain points:** poor for point lookups, poor for frequent updates, not a good OLTP fit.

**Good interview line:** "Columnar wins on analytics because compression and selective column reads reduce I/O massively, but row reconstruction makes it bad for transactional access." """),

    1776699405094: ("data-sketch",
r"""What is a data sketch, and why use one?""",
r"""A data sketch is a **lossy summary** of data that keeps just enough information to answer one narrow question approximately. You use it when exact answers are too expensive in memory or compute. The core trade is: **lose detail, keep the signal**.

Example: instead of storing every visitor ID to count uniques exactly, you keep a tiny structure that says something like "about 1,042,000 ± 1%." Sketches matter when exactness is unnecessary but scale is huge."""),

    1776699433278: ("bloom-filter",
r"""What problem does a Bloom filter solve, and what guarantees does it give?""",
r"""A Bloom filter answers: **"Have I probably seen this item before?"** It supports set membership checks with this guarantee:

- **If it says no, the item is definitely not in the set**
- **If it says yes, the item is probably in the set**

So it has **no false negatives**, but it does have **false positives**.

Intuition: each item hashes to several bit positions in a bit array, and those bits are turned on. Querying checks those same positions. If any required bit is off, the item was never inserted.

Bloom filters are used to avoid unnecessary expensive lookups, like checking SSTables in LSM databases or skipping blocks that definitely do not contain a key. Typical size is about **10 bits per item for ~1% false positive rate**."""),

    1776699497051: ("hyperloglog",
r"""What does HyperLogLog estimate, and why is it so memory efficient?""",
r"""HyperLogLog estimates **cardinality** — the number of **distinct elements** in a stream, such as unique users, unique IPs, or unique series IDs. Its big advantage is that memory stays roughly **constant**, often around **12 KB**, even if the true cardinality grows from thousands to billions.

Intuition: after hashing items, the number of **leading zeros** in a hash tells you how rare that event is. A very long run of leading zeros is unlikely, and seeing it suggests you have probably seen many items. HLL spreads items across multiple buckets, tracks the strongest zero-run evidence per bucket, and combines them into an estimate. Typical error is around **1–2%**."""),

    1776699516593: ("count-min-sketch",
r"""What does Count-Min Sketch do, and what kind of error does it have?""",
r"""Count-Min Sketch answers: **"How many times have I seen item X?"** It is for approximate frequency counting over huge streams.

It uses multiple rows of counters and multiple hash functions. When an item appears, it increments one counter in each row. To estimate a count for item X, it hashes X into each row and returns the **minimum** counter value.

Why minimum? Because collisions with other items can only make counters **too large**, never too small, so the minimum is the least inflated estimate. That means Count-Min Sketch tends to **overestimate**, not underestimate.

Useful for hotspot detection, frequent IPs, common labels, and frequency queries on items you may ask about later."""),

    1776699554759: ("space-saving-vs-cms",
r"""How is Space-Saving different from Count-Min Sketch?""",
r"""Space-Saving is specialized for **top-K / heavy hitters**. If your real question is **"What are the most frequent items?"**, Space-Saving is usually the better fit. It keeps only **K slots**, each with an item and count.

- If incoming item is tracked, increment it
- If there is empty space, insert it
- If full and item is new, evict the current minimum-count item and replace it with the new one at **min_count + 1**

This gives bounded error and ensures true heavy hitters survive. So:

- **Space-Saving:** best for "show me the top 100 hottest keys"
- **Count-Min Sketch:** best for "tell me the approximate count of this particular key"

Space-Saving is top-K by construction, while Count-Min is a general frequency estimator."""),

    1776699589325: ("tdigest-hdr-histogram",
r"""What do t-digest and HDR histogram solve, and why not just store raw values?""",
r"""They estimate **percentiles** like **p50, p95, p99, p99.9** from a stream of numeric values, especially latency data. Exact percentile computation would require storing and sorting all values, which does not scale.

t-digest compresses values into **centroids**, with **finer detail near the extremes**, because tails matter most in latency analysis. HDR histogram uses **logarithmic buckets**, which is simpler and fast.

These structures are used in observability and metrics systems because you cannot just average percentiles across time windows, but you often **can merge sketches** and then query percentiles from the merged result. Useful for long-term latency tracking and rollups."""),

    1776699617908: ("sketch-design-pattern",
r"""What is the staff-level system design pattern with sketches?""",
r"""The key move is to recognize when the system **does not need exact answers**. Then choose the sketch that matches the question:

- **Bloom filter** for approximate membership
- **HyperLogLog** for distinct count
- **Count-Min Sketch** for frequency of a given item
- **Space-Saving** for top-K heavy hitters
- **t-digest / HDR histogram** for percentiles

A strong design answer includes the **question**, the **approximation**, and the **space/accuracy tradeoff**, for example: "We'll use HyperLogLog per tenant, about 12 KB each, with roughly 1% error, which is fine because we only need to detect large cardinality growth." """),

    1776699680940: ("zipfian-numbers",
r"""What are key zipfian numbers?""",
r"""Key numbers to remember:

- top 1% of users are responsible for 50% of traffic
- top 10% responsible for 80%
- top 20% responsible for 90%

Cache: 95% effective readthrough cache (reported both by Facebook's memcached tier and Cloudflare)."""),

    1776699816088: ("gorilla-compression",
r"""How does Gorilla compression store time-series timestamps and values?""",
r"""Gorilla stores each series in **chunks** over a time window, such as 2 hours. Inside each chunk, **timestamps and values are compressed separately** because they have different patterns.

For timestamps, it stores the first timestamp in full, then stores the **gap**, then the **change in the gap**. In regular scrapes, that delta-of-delta is usually 0, so it often takes only **1 bit per point**.

For values, it stores the first value in full, then XORs each new float with the previous one and stores only the bits that changed."""),

    1776699865271: ("gorilla-effectiveness",
r"""Why is Gorilla compression so effective for metrics, and when does it degrade?""",
r"""Gorilla gets 10x compression with time series data, but just 1.5-2x for general ones.

Gorilla works well because metric data often has **regular sampling intervals** and **small changes between consecutive values**. That makes timestamp delta-of-delta very compressible, and float XORs tend to produce only a few changed bits. On real-world metrics, it averages about **1.37 bytes per point**, much better than general-purpose compression like gzip.

It degrades on **irregular data**, such as flaky scrapes, varying intervals, or high-entropy values, where it may use around **3–6 bytes per point**."""),

    1776699875004: ("gorilla-vs-zstd",
r"""When should you use Gorilla vs zstd?""",
r"""Use **Gorilla** for **in-memory or on-disk time-series chunks** where you want specialized compression for timestamps and floating-point metric values.

Use **zstd** for more general data compression. **zstd level 3** is a strong default for log files at rest, object storage of batched records, backups, Kafka message compression, and network payloads where a bit of CPU is worth the bandwidth savings.

Use **higher zstd levels (9–19)** for **write-once, read-many** cold storage or static assets where you compress once and benefit from smaller size for a long time."""),

    1776704829639: ("etcd-leader-election",
r"""What is etcd, and how does it help with leader election?""",
r"""etcd is a strongly consistent distributed key-value store used for **coordination metadata**. Internally, etcd itself uses Raft and has one Raft leader at a time.

Applications use etcd to elect their own leader by storing a lease-backed key, for example `/scheduler/leader`. The instance that holds and renews the lease is the current leader. If it dies or loses connectivity, the lease expires, the key is removed, and another instance can take over. Workers usually learn the new leader by watching the leader key for changes."""),

    1776723091945: ("data-vs-traffic-skew",
r"""What types of skews are important in hashing?""",
r"""Data skew = one shard is bigger.

Traffic skew = one shard is busier.

They often don't coincide."""),

    1776906051037: ("rdma-transfer",
r"""what is RDMA transfer?""",
r"""Zero-copy GPU-to-GPU transfer with minimal CPU involvement."""),

    1776906370070: ("openai-sse-vs-webrtc",
r"""Does ChatGPT / OpenAI use SSE or WebRTC for streaming?""",
r"""For the **API**, normal text/token streaming uses **SSE**.
For the **Realtime API**, **WebRTC** is recommended for client-side realtime sessions, and it can carry **text too**, not just voice/video.

Good mental model:

- **typed chat streaming** → SSE
- **realtime voice/video** → WebRTC
- **realtime text session** → can also use WebRTC"""),

    1776906505967: ("websocket-vs-webrtc",
r"""What are the drawbacks of **WebSocket** compared to **WebRTC** for realtime communication?""",
r"""For realtime voice/video, WebSocket is weaker because:

- it runs over **TCP**, so packet loss/delay can stall later data
- it has **no built-in media features** like jitter buffer, echo cancellation, bitrate adaptation, or codecs
- it does **not include NAT traversal machinery** like ICE/STUN/TURN
- it performs worse on **unstable networks** for live media
- you must build much more yourself

Good rule:

- **WebSocket** = general bidirectional messaging
- **WebRTC** = realtime media and interactive low-latency communication"""),

    1776906584050: ("server-sent-events",
r"""What is **Server-Sent Events (SSE)?**""",
r"""Server-Sent Events (SSE) is a server push technology that allows a web server to send real-time updates to a browser over a single, long-lived HTTP connection. Unlike traditional HTTP requests where the client must repeatedly ask for data (polling), SSE enables the server to proactively "push" data as soon as it becomes available."""),

    1776938315687: ("context-rot",
r"""What is "context rot"?""",
r"""It means LLM performance gets less reliable as input length grows. The paper's main claim is that models do **not** use long context uniformly, even on simple tasks."""),

    1776938351120: ("niah-misleading",
r"""Why does the paper say classic NIAH can be misleading?""",
r"""Because classic NIAH mostly tests **lexical retrieval**, not the harder thing real apps need: finding relevant info when the match is semantic, ambiguous, or mixed with distractors. Models can look strong on NIAH and still degrade badly on more realistic long-context tasks."""),

    1776940218404: ("quantization-impact-by-target",
r"""In quantization, what's the impact of weight/weight+activation/kv cache quant?""",
r"""- **Weight-only quant** (e.g., W4A16) buys **storage + weight-fetch bandwidth**. It does **not** buy compute; the matmul still runs in FP16/BF16 after dequant.
- **Weight + activation quant** (e.g., W8A8, W4A4) buys **compute** *if and only if* the hardware has native tensor-core support for that format.
- **KV-cache quant** buys **decode-phase bandwidth + capacity** (more concurrent sequences, longer context). It doesn't affect prefill much."""),

    1776995334849: ("dead-letter-queue",
r"""what is **Dead-letter queue (DLQ)?**""",
r"""A side channel for messages that have failed N times.

Purpose: unblock the main pipeline, preserve the failing message for investigation.

Must have: alerting on DLQ depth, a replay path, a way to inspect messages."""),

    1776995486331: ("delivery-semantics",
r"""what are the message delivery semantics?""",
r"""- **At-most-once:** fire-and-forget. Lose messages on failure. Use when loss is acceptable (telemetry, metrics samples).
- **At-least-once:** default for durable systems. Duplicates possible. **Consumers must be idempotent.**
- **Exactly-once:** a property of an end-to-end system, not a transport guarantee. Achievable when (1) the broker supports transactional writes (Kafka EOS) *and* (2) the consumer's side effect is either transactional with offset commit or idempotent. If the side effect is "send email" or "call external API," exactly-once is a lie — aim for at-least-once + idempotency."""),

    1777216725440: ("monotonic-meaning",
r"""What does *monotonic* mean?""",
r"""A value is *monotonic* if it only moves in one direction over time, either never decreasing or never increasing.

Example:

```
1, 2, 2, 5, 9
```

Monotonic increasing, because it never goes down."""),

    1777219506562: ("python-bisect",
r"""What is **bisect** library?""",
r"""`bisect` is Python's library for **binary search on a sorted list**.

- **bisect_left O(log n)**: finds the first position where x can be inserted: `bisect.bisect_left(arr, 3)`
- **bisect_right O(log n)**: finds the **last position** where `x` can be inserted: `bisect.bisect_right(arr, 3)`
- **insort O(n)**: `bisect.insort(self._sorted, (t_expire, t_grant, eid))`"""),

    1777220573763: ("atomic-save",
r"""can you write atomic save function?""",
r"""```python
def save(self, path: str) -> None:
    # Full snapshot. Atomic: tmp + fsync + rename.
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        for k, v in self._data.items():
            f.write(self._encode(_OP_SET, k, v))
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
```"""),

    1777221420263: ("python-struct",
r"""what is `struct` in python""",
r"""`struct` is Python's bridge between Python values and fixed-layout C-style binary. You give it a *format string* describing the byte layout, and it packs/unpacks accordingly.

```python
_HDR = struct.Struct(">cII")

# pack: Python values -> bytes
header = _HDR.pack(b"S", 5, 11)
# -> b'S\x00\x00\x00\x05\x00\x00\x00\x0b'  (9 bytes)

# unpack: bytes -> tuple of Python values
op, klen, vlen = _HDR.unpack(header)
# -> (b'S', 5, 11)

_HDR.size  # 9
```"""),

    1777221527730: ("read-file-struct-size",
r"""how to read a file to the size of a struct?""",
r"""```python
hdr = f.read(_HDR.size)
if not hdr:
    return None
if len(hdr) < _HDR.size:
    return None
op, klen, vlen = _HDR.unpack(hdr)
```"""),

    1777221873782: ("python-checksum",
r"""python checksum and how to use it?""",
r"""```python
import zlib
_CRC = struct.Struct(">I")
crc_bytes = f.read(_CRC.size)
if zlib.crc32(hdr + payload) != _CRC.unpack(crc_bytes)[0]:
    return False
```"""),

    1777275215437: ("chunked-prefill",
r"""what is chunked prefill?""",
r"""Use chunked prefill to let decode requests "piggyback" on prefill chunks in the same serving engine, reducing stalls and improving utilization. Its core idea is not "send KV to another decode worker," it is "mix prefill chunks and decodes in the same batch." """),

    1777275292917: ("kv-transfer-pipelining",
r"""what is the network transfer trick for kv cache?""",
r"""The trick is that the transfer can be **pipelined per layer** — as soon as layer L's KV is computed, start shipping it while layers L+1..N continue computing. With pipelining, the perceived transfer cost is the cost of the *last layer's* KV, not the whole stack. That's ~8 MiB per layer for FP8 KV at 4K tokens, or ~10μs over NVLink. Effectively free."""),

    1777305791659: ("70b-quantization-recipe",
r"""What is quantization recipe for 70B model?""",
r"""**Per-layer sensitivity** — in practice for 70B Llama-class:

- LM head: keep BF16. The output distribution is sensitive to small quantization noise; FP8 here costs measurable downstream task performance.
- First 2 attention layers: BF16. Early layers' activations have unusually wide dynamic range.
- All other linears: FP8.
- All KV projections: FP8 (matching FP8 KV cache).
- LayerNorms / RMSNorms: BF16 always (cheap, sensitive)."""),

    1777307403593: ("flashattention-quantization",
r"""what is quantization recipe on FlashAttention?""",
r"""Softmax in FP32.

The rest can be in FP8. We pass in `q_descale`, `k_descale`, `v_descale` for scaling it up."""),

    1777340530570: ("mha-gqa-mla",
r"""how do you compare MHA, GQA and MLA (deepseek)?""",
r"""MLA: 50x save in mem bandwidth, but 4x more expensive in compute.

Normal MHA KV cache per layer:

$$B \cdot L \cdot 2 \cdot H \cdot d_h \cdot s$$

GQA reduces $H$ to $H_{kv}$:

$$B \cdot L \cdot 2 \cdot H_{kv} \cdot d_h \cdot s$$

MLA cache per layer:

$$B \cdot L \cdot (d_c + d_R) \cdot s$$

DeepSeek-V3 uses `H=128`, `d_h=128`, `d_c=512`, query compression `1536`, and decoupled query/key RoPE dimension `64`. So for MHA:

```
2 * H * d_h = 2 * 128 * 128 = 32768 elements/token/layer
```

For MLA:

```
d_c + d_R = 512 + 64 = 576 elements/token/layer
```

That is about:

```
32768 / 576 ≈ 56.9x smaller cache than full MHA
```

Compared with GQA, the savings depend on $H_{kv}$. But MLA is still very attractive because the cache size no longer scales with the number of query heads.

```
B   = batch size
L   = context length
H   = attention heads
d_h = head dimension
d_c = MLA KV latent dimension
d_R = RoPE key dimension
s   = bytes per element
```"""),

    1777341985541: ("swa-sinks-math",
r"""Whats the math behind Sliding Window Attention + Attention Sinks?""",
r"""Full causal attention prefill cost is roughly:

$$O(L^2 H d_h)$$

because every token attends to all earlier tokens.

Sliding window prefill cost:

$$O(L W H d_h)$$

With sinks:

$$O(L (W + S) H d_h)$$

Since $S$ is usually tiny compared to $W$, this is basically $O(L W H d_h)$."""),

    1777342185964: ("attention-sinks",
r"""Whats the use of attention sinks?""",
r"""Sliding Window Attention (SWA) caps each query's receptive field at the last `W` tokens, turning attention's KV cost from `O(s)` to `O(W)`. On its own, SWA breaks badly in streaming generation — perplexity explodes the moment the oldest tokens get evicted.

**Attention sinks** fix this by permanently retaining the first few tokens (typically `k=4`) in the cache, restoring near-full quality at constant memory. It's as if the system uses them as some kind of anchor."""),

    1777342445943: ("swa-production-reality",
r"""What's real production use of sliding window attention?""",
r"""SWA's "long context" is mostly fake. The L · W effective span argument is real but weak — information has to survive L rounds of windowed mixing to reach the other end, and there's no direct path. That's why every serious long-context model now does hybrid SWA + full-attention layers (or SSM layers in Qwen3-Next / Jamba style). Pure SWA stacks fail badly on tasks that need precise long-range retrieval."""),

    1777342928294: ("dynamic-sparse-attention",
r"""What is dynamic sparse attention?""",
r"""16x less flops + less bandwidth. (And needle-in-haystack works — which in sliding window attention doesn't.)

Where SWA fixes the sparsity pattern (band) and MLA shrinks per-token cache, **dynamic sparse attention** lets each query choose its own keys at runtime. The pattern is data-dependent. Modern instances — DeepSeek **NSA** (2025), Kimi **MoBA**, **Quest**, **H2O** — all share the same skeleton: cheaply estimate per-block importance, top-k select, attend densely within the selection."""),

    1777346664091: ("token-zigzag",
r"""Why to use token ZigZag distribution?""",
r"""Causal mask asymmetry: with causal masking (autoregressive LMs), the work per ring step is unbalanced — early ranks (low sequence positions) do much less attention work than late ranks (because they only attend to earlier positions). Naive ring attention has the GPU at rank 0 idle for most of the prefill.

Solutions: token zigzag distribution (each rank gets two non-contiguous chunks, one early one late, so total work balances), or DistFlash-style work redistribution. This is a real production concern; assume the implementation handles it."""),

    1777347094578: ("moe-batch-sizes",
r"""Why for MoE, batch sizes need to be much larger?""",
r"""**Batch sizes need to be much larger for expert utilization.** With 256 experts and 8 active per token, a batch of 64 tokens distributes ~2 tokens per expert on average — terrible amortization. MoE wants batch sizes in the hundreds at least to amortize expert weight reads."""),

    1777478510154: ("kadanes-algorithm",
r"""What's Kadane's algorithm?""",
r"""Kadane's Algorithm is an efficient algorithm used to find the maximum sum of a contiguous subarray within a one-dimensional numeric array.

```python
def maxSubArray(nums):
    max_so_far = nums[0]
    max_ending_here = nums[0]

    for i in range(1, len(nums)):
        # Decide to start new or keep going
        max_ending_here = max(nums[i], max_ending_here + nums[i])
        # Update overall max
        max_so_far = max(max_so_far, max_ending_here)

    return max_so_far
```"""),

    1777512248625: ("continuous-batching-mechanism",
r"""can you tell exact mechanism for continuous batching?""",
r"""A new request joins when a decode slot frees or when the scheduler admits it into the next iteration. Its prompt is prefetched first, KV pages are allocated, then it joins decode iterations token by token."""),

    1777514589560: ("drr-decode-fairness",
r"""How to stop a 100k-token decode starve 5-token decode?""",
r"""DRR (deficit round robin), quantum = 512 tokens/round per tenant.

$$preemption_{overhead} / quantum_{computeTime} < 5\%$$

```
Round 1:
  Tenant A (100k req): deficit += 512 -> runs 512 decode steps -> deficit = 0
  Tenant B (5-token req): deficit += 512 -> runs 5 steps -> done -> deficit = 0

Round 2:
  Tenant A: deficit += 512 -> runs 512 more steps
  Tenant C (new 20-token req): deficit += 512 -> runs 20 steps -> done
```

Another option: since we allocated the memory when the scheduler assigned the sequence, if we go beyond that allocation we offload to queue so the scheduler can add it again."""),

    1777514809792: ("vllm-preemption",
r"""What's vLLM's approach when KV cache runs out due to one seq generating more than we thought?""",
r"""vLLM uses **FCFS with preemption** — not DRR. When KV cache runs out, it preempts the **last admitted** request (not the longest or least-fair one). This is:

- Simple to implement
- Not fair across tenants
- Explicitly documented as "not production multi-tenant"

A proper DRR layer would sit above vLLM's scheduler, controlling which requests get admitted into vLLM's running batch and when they get preempted, using vLLM's block manager for the actual KV swap mechanics."""),
}

push_cards(CARDS)
