#!/usr/bin/env python3
"""system-design import, batch 3/3 (56 cards)."""
import sys
sys.path.insert(0, "/tmp")
from sd_runner import push_cards

VIT_SVG = "../../media/7be9960cd1469dae2bdc.svg"
CONST_CLASSIFIER = "../../media/47ea772ee621f76dac83.webp"

CARDS = {
    1778321847058: ("backprop-math-foundation",
r"""Explain the mathematical foundation of backpropagation""",
r"""Backpropagation is just an efficient application of the chain rule on a computational graph.

A neural network is a composition of functions:

$$X \rightarrow Z_1 \rightarrow A_1 \rightarrow Z_2 \rightarrow \hat{y} \rightarrow L$$

Instead of recomputing derivatives from scratch for every parameter, backprop computes local derivatives at each node and reuses upstream gradients as it moves backward."""),

    1778324207730: ("cross-entropy-bounds",
r"""If a classifier achieves 100% accuracy on its training set, what are the minimum and maximum possible values of the cross-entropy loss on a single example?""",
r"""For one example, cross-entropy is:

$$L = -\log p_y$$

where $p_y$ is the model probability assigned to the true class.

**Minimum possible loss:** if the model assigns probability 1 to the true class, $p_y = 1$, then:

$$L = -\log(1) = 0$$

**Maximum possible loss:** if prediction is based on **argmax of the softmax probabilities**, then the true class must have the highest probability. For $C$ classes, the smallest possible winning probability is about $p_y \approx \frac{1}{C}$:

$$L = -\log \frac{1}{C} = \log C$$

Example for binary classification: $p_y = 0.5001 \Rightarrow L = 0.693$."""),

    1778324568115: ("pandas-missing-data",
r"""How do you handle missing data in Pandas?""",
r"""I first inspect missingness with `isna().sum()` and understand whether it is random or meaningful. Then I choose a strategy: drop rows if missingness is small, drop columns if missingness is too high, impute numeric values with median or mean, impute categorical values with mode or `"Unknown"`, and for time series use forward/backward fill when appropriate. For ML, I also avoid data leakage by fitting imputation values only on the training set."""),

    1778364880984: ("nats-vs-kafka",
r"""compared NATS and Kafka""",
r"""NATS and Kafka are both messaging systems but built for very different problems. The TL;DR: **NATS is a low-latency message router; Kafka is a durable distributed log.** They overlap in features but optimize for opposite ends of the latency-vs-durability spectrum.

NATS is an open-source messaging system originally written for Cloud Foundry's internal control plane (Apcera, ~2011). The core design goal was "make the message bus invisible" — sub-millisecond fan-out for service-to-service communication.

There are two products under the NATS umbrella:

- **Core NATS** — pure pub/sub, in-memory, fire-and-forget. No persistence. If a subscriber is offline, it misses the message. Sub-millisecond latency, millions of messages/sec on commodity hardware.
- **NATS JetStream** — durability layer added in 2020. Persistent streams, configurable replication, consumer offsets, exactly-once semantics, message replay. Closer to Kafka in features, but with the NATS routing model on top.

In our design, presence uses Core NATS (lossy is fine), edits use JetStream (must be durable)."""),

    1778365526631: ("causal-ordering",
r"""What is causal ordering?""",
r"""A delivery guarantee where if event A *causally precedes* event B (B was produced with knowledge of A), then every observer sees A before B. Events with no causal relationship (concurrent) may be seen in any order.

```
Alice posts:   "I lost my dog"      ─┐
                                     │ causal: Bob saw Alice's post
Bob replies:   "So sorry to hear" ←─┘ before writing his
                    │
                    │ Carol receives Bob's reply via a faster path
                    ▼
Carol sees:    "So sorry to hear"  ←  WTF moment — reply with no context
               "I lost my dog"     ←  arrives later
```

FIFO is satisfied (Bob's messages arrive in Bob's order; Alice's in Alice's). Causal is violated (B causally depended on A, but Carol saw B first). Total order would also fix this but requires global coordination."""),

    1778457993890: ("timeseries-cardinality-check",
r"""What's the best way to do cardinality check for a timeseries db?""",
r"""```
Distributor:
  - Local HLL for burst detection only
    ("this tenant created 50K series in 60s on MY traffic")
  - Forwards write to ingester

Ingester:
  - Maintains exact set of series_ids it has seen per tenant
  - Maintains per-tenant series count (its local slice)
  - Periodically reports counts to a lightweight aggregator
  - Enforces: local_count + aggregated_peer_count > limit → reject
  - Rejection propagates back to distributor → back to client
```

The write path is now:

```
scraper ──→ Distributor ──→ Ingester ──→ (cardinality check here)
                                     ──→ WAL append
                                     ──→ ACK / 429
```"""),

    1778464481351: ("partial-results-cache",
r"""What is partial results cache?""",
r"""It's different from query caching. For example we do a query of "give me 500 errors on gateway service of us-east for the past 5 mins". Now, 1 minute later — in reality we have just 1 minute of new data and we shouldn't recompute all 5 mins again. Saves a lot in our query SLO."""),

    1778512956786: ("crdt",
r"""What is CRDT?""",
r"""CRDT stands for Conflict-free Replicated Data Type. CRDTs are specialized data structures used in distributed systems that allow multiple users to edit data simultaneously on different computers (replicas) without needing a central server to coordinate changes.

Key features & purpose:

- **No conflicts:** designed so that when changes made on different devices are merged, they always produce the same result, ensuring consistency without needing to resolve conflicts.
- **Real-time collaboration:** they power collaborative applications like Figma, Notion, and collaborative text editors.
- **Offline-first support:** users can work offline and automatically sync and merge changes once they reconnect.
- **Types:** two main approaches — state-based (sharing the full state) and operation-based (broadcasting only the changes).

Note: while some editors use CRDTs, others use a similar approach called Operational Transformation (OT)."""),

    1778599435122: ("fp32-master-weights",
r"""Why FP32 master weights exist""",
r"""```
BF16 weights
    ↓ forward/backward
gradients
    ↓
optimizer updates FP32 master weights
    ↓ cast back
BF16 training weights
```

Training uses BF16/FP16 for speed. But updating weights directly in BF16 is numerically unstable because:

- gradients are tiny
- updates accumulate over billions of steps
- BF16 has limited mantissa precision

So training systems maintain:

- BF16 copy → used for forward/backward
- FP32 master copy → used for optimizer update"""),

    1778599656300: ("adam-m-v",
r"""What is Adam/AdamW's (m,v)?""",
r"""AdamW is a variant of the Adam optimizer. Adam keeps track of two running statistics for every parameter:

$$m_t = \beta_1 m_{t-1} + (1-\beta_1) g_t$$

$$v_t = \beta_2 v_{t-1} + (1-\beta_2) g_t^2$$

where:

- $g_t$ = gradient
- $m_t$ = momentum / first moment estimate
- $v_t$ = variance / second moment estimate

Then the parameter update is approximately:

$$\theta_{t+1} = \theta_t - \eta \frac{m_t}{\sqrt{v_t} + \epsilon}$$

AdamW adds **decoupled weight decay**, which fixes a subtle issue in regular Adam."""),

    1778599777758: ("h100-mixed-precision",
r"""What is current mixed precision practice in H100 training?""",
r"""| Tensor | Precision |
|---|---|
| forward activations | BF16 |
| gradients | BF16 |
| GEMMs | FP8/BF16 |
| optimizer states | FP32 |
| reductions | FP32 accumulate |"""),

    1778600283287: ("zero-1-2-3",
r"""can you tell me difference between ZeRO-1 -> ZeRO-3?""",
r"""The short version:

- **ZeRO-1** → shard optimizer states only
- **ZeRO-2** → shard optimizer states + gradients
- **ZeRO-3 / full FSDP** → shard optimizer states + gradients + parameters

The tradeoff is:

- More sharding → less memory
- More sharding → much more communication

At 4,000 H100 scale, communication dominates, so people often stop at **ZeRO-1 (or ZeRO-2)** instead of full ZeRO-3."""),

    1778600627984: ("training-recovery-time",
r"""Why recovery time is so important in training?""",
r"""By keeping 1 rack-level GPU spare (4 nodes = 32 GPUs) on hot standby (cost 0.8% of infra) we save 4%. Here is the explanation:

Llama 3 paper: 419 unexpected interruptions in 54 days on 16,384 H100s = ~7.8 events/day for a 16K cluster ≈ 4.8 × 10⁻⁴ events/GPU/day. At 4,000 GPUs × 72 days: **~138 expected interruptions**. 78% confirmed hardware (58.7% GPU-related).

Recovery-time math:

- Mean recovery 10 min (with hot spares) → 138 × 10 min = **23 hours = 1.3% of run**
- Mean recovery 30 min (no hot spares, scheduler reissue) → **69 hours = 4.0% of run**

**[STAFF SIGNAL: failure-budget reframing]** This is the entire reason hot spares exist. The architecture's job is to keep recovery time below 10 minutes per event. 1.3% loss is acceptable; 4.0% is an extra 3 days of compute on a 72-day run, which at internal cost ($2/H100-hour, 4,000 GPUs, 3 days) is ~$575K of waste *per run*. That's the budget for engineering this right."""),

    1778601479461: ("500b-training-state-size",
r"""Can you calculate training data on 500B model scale?""",
r"""| Item | Approx Size |
|---|---|
| BF16 weights | ~1 TB |
| FP32 master weights | ~2 TB |
| Adam m,v | ~4 TB |
| misc metadata | smaller |"""),

    1778601604084: ("3-tier-checkpointing",
r"""What is 3-tier checkpointing strategy?""",
r"""The entire strategy is about minimizing training interruption while still being able to recover from failures.

| Tier | Speed | Capacity | Purpose |
|---|---|---|---|
| DRAM | fastest | tiny | immediate crash recovery |
| NVMe | fast | medium | node-local durable staging |
| Object store | slowest | massive | long-term persistence |"""),

    1778601663352: ("buddy-checkpointing",
r"""What's buddy checkpointing in training production?""",
r"""Instead of immediately writing checkpoints to disk/network storage, GPUs copy checkpoint shards into RAM on peer nodes.

Example:

- Node A sends its shard to Node B RAM
- Node B sends to Node C
- etc.

This is extremely fast because InfiniBand/NVLink bandwidth is high and DRAM write latency is tiny.

Now if a node crashes, another node already has its latest state in memory. Recovery can begin almost immediately."""),

    1778602670476: ("shadow-world-spares",
r"""For training hot spares, we keep pre-warmed, NCCL-init in shadow world nodes ready in <60s. What shadow world means?""",
r"""A true NCCL communicator is tied to:

- specific ranks
- specific nodes
- specific topology
- specific network endpoints

So at first glance, it seems impossible to "hot swap" a node without rebuilding communicators. And historically, that *was* true.

The reason "shadow world" works is that modern large-scale training systems increasingly treat spare nodes as:

> already-participating members of a larger prebuilt communication universe

not as completely disconnected replacements."""),

    1778839999887: ("graph-vs-swarm-agents",
r"""In an agentic workflow, can you compare graph vs. swarm execution model?""",
r"""**Swarm execution:** everyone can talk to everyone. It sounds flexible, but it becomes messy.

```
Agent A <-> Agent B <-> Agent C <-> Agent D
```

Who made this decision? Which agent used the expensive tool? Why did the system loop? Which subtask failed? Who owns the final answer?

**Graph execution:** parent-child workflows, you get cleaner boundaries.

```
            [Supervisor]
            /    |    \
           v     v     v
    [Research] [Code] [Reviewer]
           \     |     /
            v    v    v
        [Supervisor combines]
```"""),

    1778840098108: ("react-loop",
r"""What is ReAct loop in agentic workflows?""",
r"""```
Think -> Act -> Observe -> Think -> Act -> Observe -> ...
```

A **ReAct agent** (short for **Reasoning and Acting**) is an AI system that combines step-by-step logic with the ability to use external tools. Unlike a basic chatbot that answers based only on its pre-trained knowledge, a ReAct agent "thinks" about a problem, decides what action to take (like searching the web or using a calculator), and then updates its plan based on what it discovers."""),

    1778841251515: ("agent-tooling-access",
r"""How should an agentic system provide tooling access?""",
r"""In interview language:

> "First-party tools cover the common 80%. MCP handles the enterprise-specific long tail. It gives us a standard integration boundary, while preserving observability, permissions, approvals, and cost attribution." """),

    1778841924275: ("authoring-vs-execution",
r"""why to separate graph authoring and execution in an agentic platform?""",
r"""LangGraph is a good way for developers to describe agent workflows. But a serious hosted agent platform should not outsource durability, billing, cancellation, observability, and isolation to a user-level framework. The platform should accept LangGraph-style graphs, then execute them in its own controlled runtime."""),

    1778842227039: ("agent-durability",
r"""can you explain durability structure for agentic workflow?""",
r"""Use an event log as the source of truth because it preserves history, enables replay, debugging, auditing, cost attribution, and workflow forking. Add periodic snapshots so resuming does not require replaying the whole workflow from the beginning.

**Example:**

```
events 1-50
snapshot at 50

events 51-100
snapshot at 100

events 101-137
```"""),

    1778862400081: ("deterministic-execution-vs-memoization",
r"""*deterministic execution* vs. *deterministic memoization*""",
r"""**Deterministic execution:** replay the program. The program must choose the same commands. The event history supplies old results.

**Deterministic memoization:**

1. Load latest snapshot.
2. Replay events from snapshot forward.
3. When the agent's graph code says "make LLM call X with these params," check the event log: did we already log a `LLM_CALL_COMPLETED` for this `(node, attempt, params_hash)`? If yes, return the logged response without calling the LLM. If no, make the call and append events.
4. Same for tool calls, keyed by idempotency key."""),

    1778969379832: ("e4m3-no-infinity",
r"""While E5M2 follows IEEE 754 conventions for representation of special values, E4M3's dynamic range is extended by not representing infinities. Meaning?""",
r"""**E5M2:** like FP16/FP32, it reserves the largest exponent pattern for special values. Exponent = all 1s, then:

```
mantissa = 00  -> infinity
mantissa != 00 -> NaN
```

So E5M2 supports: +inf, -inf, NaN.

**E4M3:** no +inf, no -inf, only one NaN pattern. That means values that might become infinity in IEEE-style formats instead usually saturate or become the largest finite FP8 value, depending on hardware/software behavior."""),

    1779018374731: ("episodic-memory-agents",
r"""what is episodic memory in agentic workflows?""",
r"""For very long workflows, summaries of messages are not enough. The platform should extract durable facts, decisions, constraints, and discoveries.

Without provenance, memory becomes dangerous because the agent may treat stale or inferred facts as truth.

**Example:**

```
User constraint: final report must compare vendors A, B, and C.
Decision: use PostgreSQL for metadata, S3 for blobs.
Finding: vendor B does not support SOC2 export API.
Open issue: pricing for vendor C still unknown.
```

**Memory item:**

```
value: "Vendor B does not support SOC2 export API"
source: tool_result#def456
created_at_step: 17
confidence: high
expires: never / after workflow / after 7 days
```"""),

    1779027543670: ("hierarchical-summarization",
r"""what is Hierarchical summarization for sub-workflows?""",
r"""Parent workflows should not inherit every token from child workflows.

If a parent spawns a child task like:

```
Analyze this 80K-token webpage and extract pricing risks.
```

The child workflow can use its own large context, retrieval, and intermediate reasoning. The parent only receives the child's final structured result:

```
{
  "task": "pricing risk analysis",
  "result": "...",
  "key_findings": [...],
  "sources": ["tool_result#xyz"],
  "confidence": "medium",
  "open_questions": [...]
}
```

This keeps context bounded per graph level."""),

    1779027929498: ("tool-result-spillover",
r"""what is Tool result spillover to memory store?""",
r"""Large tool outputs should not enter the prompt directly.

If a PDF is 50K tokens, the platform stores it outside the active context and inserts a compact stub:

```
[tool_result#abc123]
Type: PDF
Size: 50K tokens
Summary: Q3 financial report covering revenue, margin, guidance, and risk factors.
Available actions:
- recall("abc123", query)
- fetch_chunk("abc123", chunk_id)
```

The document is chunked, embedded, and stored in a memory/index layer. The agent can retrieve relevant parts later. This gives you bounded active context while preserving access to the full artifact."""),

    1779027965064: ("sliding-window-summarization",
r"""what is Sliding window with summarization for agentic systems?""",
r"""Keep the most recent turns verbatim, because recent state usually matters most. Older turns are compressed into a running summary.

Example active context:

```
System/developer instructions
Current workflow goal
Running summary of prior steps
Last 8 turns verbatim
Current tool result
Current user/task instruction
```

This is cheap and effective for many workflows.

Tradeoff: summaries lose fidelity. They are good for "what happened," but bad for exact numbers, legal wording, code snippets, citations, or fine-grained constraints. So the platform should mark summaries as compressed state, not ground truth."""),

    1779028152029: ("default-context-policy",
r"""what's a good default policy for agentic context window management?""",
r"""A reasonable default:

```
Default: sliding window + tool spillover
```

That means:

1. Keep recent turns verbatim.
2. Summarize older turns.
3. Spill large tool results into memory.
4. Insert stubs into active context.
5. Use retrieval when exact details are needed."""),

    1779054596784: ("time-monotonic",
r"""time.time vs time.monotonic()""",
r"""`time.monotonic()` is a Python function used to get the value of a **monotonic clock**, which is a clock that is guaranteed to never go backward. It is the preferred tool for measuring durations and elapsed time because it is unaffected by system clock updates, such as manual changes, NTP adjustments, or daylight saving time."""),

    1779088975470: ("mm-encoder-tp-mode",
r"""what is correct input to this flag? --mm-encoder-tp-mode""",
r"""Set to `"data"`, so as to deploy the multimodal encoder in DP fashion for better performance. This is because the multimodal encoder is very small compared to the language decoder (ViT 675M vs. LM 72B in Qwen2.5-VL-72B), thus TP on ViT provides little gain but incurs significant communication overhead."""),

    1779089507989: ("dp-in-serving",
r"""when to use DP in serving?""",
r"""For medium-size models like Qwen2.5-VL-7B, data parallelism usually provides better performance since it boosts throughput without the heavy communication costs seen in tensor parallelism."""),

    1779090664798: ("vit",
r"""what is ViT?""",
r"""**ViT = Vision Transformer.** It applies the transformer idea to images.

Instead of processing words as tokens, it splits an image into patches:

```
image 224x224
→ split into 16x16 patches
→ each patch becomes a token
→ transformer processes patch tokens
```

So for a 224x224 image with 16x16 patches:

```
224 / 16 = 14
14 * 14 = 196 image tokens
```

Then the transformer learns relationships between patches, similar to how an LLM learns relationships between words.

**Concrete mental model** — an LLM sees:

```
"What is in this image?"
```

A multimodal LLM sees something closer to:

```
[image_token_1, image_token_2, ..., image_token_196]
"What is in this image?"
```

The image tokens come from ViT or another vision encoder."""),

    1779091987755: ("async-prefetching",
r"""what is async prefetching?""",
r"""**Async prefetching = start moving data before it is needed, without blocking the current compute.**

Example: vision encoder produces image features; decoder/LLM later needs those features.

Naive version:

```
encode all 500 tiles
then transfer 32 GB features
then decoder starts
```

That is bad because transfer becomes visible latency: `encode_time + transfer_time + decode_time`.

Async prefetching version:

```
encode tile 1
start transferring tile 1 features in background
while transferring tile 1, encode tile 2
while transferring tile 2, encode tile 3
...
decoder consumes features as they arrive
```

The pipeline becomes:

```
Encoder GPU:  [encode tile 1][encode tile 2][encode tile 3]...
Network:          [send tile 1][send tile 2][send tile 3]...
Decoder GPU:                    [use tile 1][use tile 2]...
```

The goal is to make latency closer to `max(encoding time, transfer time)` instead of `encoding time + transfer time`."""),

    1779094397043: ("vlm-caching",
r"""what type of caching we have in VLMs?""",
r"""- **Tier 1: image-feature cache.** Keyed by `(sha256(image_bytes), encoder_version, tile_policy_version)`. Value: the encoded features (64MB per high-res tile-batch). Cheap to store (~$0.001/GB-month on S3 Glacier for cold tier; in-memory Redis for hot tier with ~1-hour TTL). Hit-rate in production is very high for document workloads (same forms, same templates) and modest for chat (people upload unique photos).
- **Tier 2: KV-prefix cache.** Keyed by the full token prefix hash, which now includes image-content hashes interspersed with text tokens. Value: the KV-cache pages produced by prefilling that prefix through the LLM. Stored on Mooncake-style distributed memory pool (CPU DRAM + NVMe)."""),

    1779121736007: ("tile-resolution-strategy",
r"""What is tile/resolution strategy for multimodal inference""",
r"""**Auto-tile policy.** Cheap end: chat images at 448×448 → 1 tile → 256 tokens, 8–15 ms encode. Expensive end: document pages at 1792×1792 → 16 tiles → 4096 tokens, 130–250 ms encode.

The system inspects image dimensions and content hints (mime type, EXIF, request endpoint) and picks tile count automatically. User can override with a `detail: "low" | "auto" | "high"` parameter (OpenAI-style API)."""),

    1779123513961: ("multimodal-quotas",
r"""Whats a good way to apply quota and fair share?""",
r"""Per-modality rate limits, not a single TPM. A tenant's quota is a tuple:

```
{
  "text_tokens_per_minute":      <int>,
  "image_tiles_per_minute":      <int>,
  "audio_seconds_per_minute":    <int>,
  "document_pages_per_minute":   <int>,
  "encoder_flops_per_minute":    <int>  (derived budget)
}
```

`encoder_flops_per_minute` is the catch-all; a tenant with high-res-only traffic may saturate it before tile-count quotas, and a tenant uploading thumbnails won't.

**Per-pool fair share.** Encoder pool, prefill pool, decode pool, audio pool all have separate fair-share schedulers. A tenant exhausting encoder budget can still issue text-only chat against the prefill+decode pools."""),

    1779148554462: ("gcra",
r"""can you write GCRA""",
r"""Generic cell rate algorithm. Just stores TAT (theoretical arrival time).

```python
def allow(now, tat, interval, tolerance):
    if tat is None:
        tat = now

    allowed_at = tat - tolerance

    if now < allowed_at:
        retry_after = allowed_at - now
        return False, tat, retry_after

    new_tat = max(now, tat) + interval
    return True, new_tat, 0
```"""),

    1779149154470: ("ratelimiter-local-fastpath",
r"""how we can have a Local Fast-Path for a ratelimiter?""",
r"""```
Local fast-path decision tree
─────────────────────────────────────────────────────
                ┌─ local_count < limit × 0.2 ──→ ALLOW (local only)
request — rule ─┤
                ├─ local_count < limit × 0.8 ──→ ALLOW + async push
                ├─ local_count near limit    ──→ REMOTE check (auth)
                └─ remote DENY               ──→ REJECT (cache 100ms)
─────────────────────────────────────────────────────
```

But a user's traffic doesn't fan out uniformly — it lands on one or two instances behind a load balancer with sticky-ish hashing. Real over-allowance is well under 2× even at peak."""),

    1779328544549: ("constitutional-classifier",
r"""what is constitutional classifier?""",
r"""![](""" + CONST_CLASSIFIER + ")"),

    1779383902306: ("python-queue",
r"""what are the main queue functions?""",
r"""```python
import queue
self._q = queue.Queue()
p = self._q.get(timeout=1)
self._q.put(p)
self._q.task_done()
self._q.join()  # blocking until all merges
```"""),

    1779384043638: ("threading-event",
r"""What is threading.**Event?**""",
r"""Class implementing event objects. An event manages a flag that can be set to true with the `set()` method and reset to false with the `clear()` method. The `wait()` method blocks until the flag is true. The flag is initially false.

`is_set()` — return `True` if and only if the internal flag is true."""),

    1779530445364: ("wfq-vs-drf",
r"""Can you compare WFQ (weighted fair queuing) and DRF (Dominant Resource Fairness)?""",
r"""WFQ = fair over time
→ each tenant gets credits based on weight and a ticker

DRF = fair over resources
→ it treats with a resource-based approach."""),

    1779530709604: ("zset",
r"""What is ZSET?""",
r"""It's a Redis sorted set. Can be used to take jobs from a scheduled store and put them into an active queue.

```
Scheduled store (logical, per region)

shard_0: ZSET keyed by (tenant_id_hash % N == 0)
  score=1715300000000  member=job_id_aaa  ┐
  score=1715300100000  member=job_id_bbb  │  sorted by execute_at
  score=1715303600000  member=job_id_ccc  │
  score=1715900000000  member=job_id_ddd  ┘

Promoter loop (per shard, 1Hz):
  due = ZRANGEBYSCORE(shard, -inf, now())
  for job in due:
    move to active queue (with jitter)
    ZREM from shard
    state_store.update(status=queued)
```"""),

    1779585633975: ("python-list-insert",
r"""python put node into an index in list""",
r"""```python
list.insert(idx, ...)
```"""),

    1779655400243: ("sse-content-type",
r"""what's content type for SSE?""",
r"""The main request is POST, response content-type is `"text/event-stream"`."""),

    1779674426045: ("drr-vs-wfq",
r"""can you compare DRR (deficit round robin) and WFQ (Weighted Fair Queue)?""",
r"""**DRR:** on each round we calculate:

$$deficit[tenant] \mathrel{+}= base_{quantum} \cdot weight$$

base_quantum can be any number like 2. Then after each run, we reduce the deficit.

**WFQ:**

$$finish_{time} = \max(tenant_{last\text{-}finish}, global_{virtual\text{-}time}) + cost / weight$$

Then we sort based on finish time.

```
A1: max(0, 0) + 3/1 = 3
last_finish[A] = 3

A2: max(3, 0) + 2/1 = 5
last_finish[A] = 5

A3: max(5, 0) + 1/1 = 6
last_finish[A] = 6
```"""),

    1779713783676: ("threading-condition",
r"""can you write example of threading condition?""",
r"""```python
class BoundedQueue:
    def __init__(self, capacity):
        self.q = collections.deque()
        self.cap = capacity
        self.lock = threading.Lock()
        self.not_full = threading.Condition(self.lock)
        self.not_empty = threading.Condition(self.lock)

    def put(self, item):
        with self.not_full:
            while len(self.q) == self.cap:   # while, not if
                self.not_full.wait()
            self.q.append(item)
            self.not_empty.notify()          # not notify_all

    def get(self):
        with self.not_empty:
            while not self.q:
                self.not_empty.wait()
            item = self.q.popleft()
            self.not_full.notify()
            return item
```"""),

    1780304739483: ("image-encoder-steps",
r"""what are the main steps of transformer-based image encoder""",
r"""**Patchify:** divide the image into fixed-size patches, flatten each patch, linearly project each patch.

**Positional encoding:** can be 1D/2D; fixed or learnable. ViT uses 1D, learnable.

![](""" + VIT_SVG + ")"),

    1780305145999: ("decoder-training-loss",
r"""what type of loss is used to train decoder models?""",
r"""Cross entropy loss."""),

    1780305486982: ("sampling-types",
r"""What type of samplings are there?""",
r"""There are many, but some famous ones:

- Greedy decoding: fast, deterministic
- Beam search: best scoring candidate
- Top-k sampling: avoid very bad tokens
- Top-p/nucleus sampling: better adaptive creativity
- Speculative decoding: used for speed

Defaults by use case:

- For LLM chat, the usual default is: `temperature + top-p`
- For translation/code where correctness matters: `greedy or beam search`
- For creative writing: `temperature + top-p/top-k/min-p`"""),

    1780448581919: ("rag-document-parsing",
r"""what are the main ways to do document parsing for RAG?""",
r"""- Rule-based: it's rigid
- AI-based: like Google's Document AI. Can adapt to the documents, added form support."""),

    1780449313753: ("rag-chunking",
r"""what are the documents chunking strategies for rag?""",
r"""Chunk by semantic/layout boundaries:

- section heading + paragraphs
- table as its own chunk
- diagram caption + nearby explanation
- keep page number and coordinates

Typical chunk size:

```
500-1,000 tokens per chunk
overlap: 50-150 tokens
```

Old approaches:

- length based
- regular expression (around question marks, ...)
- HTML, markdown, code splitters"""),

    1780450289788: ("rag-setup-process",
r"""What are the main process for setting up RAG?""",
r"""Ingestion:

```
→ Document AI parse
→ chunk text/table/section
→ embedding_model(chunk_text)
→ vector
→ store in vector DB with metadata
```

At query time:

```
User query: "How much can I reimburse for dinner in the US?"
→ embed query
→ vector search
→ retrieve nearest chunks
→ rerank
→ send top chunks to LLM
→ answer with citations
```"""),

    1780451587702: ("cross-encoder",
r"""What is a cross encoder?""",
r"""A **cross-encoder is usually a Transformer/BERT-style model used as a scorer**.

```python
from sentence_transformers import CrossEncoder

model = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")

query = "How do I submit an expense report?"
chunks = [
    "Employees submit expense reports through the finance portal.",
    "The vacation policy allows 15 days per year.",
]

pairs = [[query, chunk] for chunk in chunks]
scores = model.predict(pairs)

print(scores)
```"""),

    1780522473691: ("mfu",
r"""What is MFU?""",
r"""$$MFU = \frac{\text{Model FLOPs per token} \times \text{Observed tokens per second}}{\text{Theoretical peak FLOPs of the hardware}}$$"""),
}

push_cards(CARDS)
