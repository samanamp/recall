#!/usr/bin/env python3
"""system-design import, batch 2/3 (55 cards)."""
import sys
sys.path.insert(0, "/tmp")
from sd_runner import push_cards

HASH_RING_IMG = None  # transcribed
CARDS = {
    1777516571843: ("paged-attention",
r"""What is **PagedAttention** (vLLM's solution)?""",
r"""KV cache is managed in fixed-size **blocks** (e.g., 16 tokens per block), allocated on demand, like virtual memory pages. A request's KV cache is a linked list of blocks, not a contiguous allocation. This enables:

- No fragmentation from over-allocation
- Blocks can be shared (prefix caching, beam search)
- Blocks can be swapped to CPU independently"""),

    1777516660710: ("static-vs-continuous-batching",
r"""Static batching vs continuous batching?""",
r"""On a realistic workload with high output length variance (which is almost every real workload):

- **Static batching**: GPU utilization 20-40% due to slot waste on long requests
- **Continuous batching**: GPU utilization 70-90%, throughput 3-5× higher at same latency percentiles"""),

    1777517549193: ("prefill-flops",
r"""What's prefill's total flops?""",
r"""$$\text{Total} = n_{layers} \times (24Ld^2 + 4L^2d)$$"""),

    1777517613227: ("h100-specs",
r"""H100 BF16, and FP8 flop? and HBM bandwidth?""",
r"""BF16: 2000 TFLOPS · FP8: 4000 TFLOPS · HBM BW: 3.3 TB/s"""),

    1777518074944: ("radix-tree-kv-cache",
r"""what is radix tree for KV cache?""",
r"""A radix tree (compressed prefix trie) where:

- **Each node** = a sequence of tokens + pointer to the KV cache blocks for those tokens
- **Each edge** = the token sequence that transitions between nodes
- **Each path from root to node** = a complete prefix, with its KV cache fully materialized

```
Root
├── [sys_prompt_tok_1 ... sys_prompt_tok_2048] → KV blocks {0,1,2,...,127}
│   ├── [user_A_tok_1 ... user_A_tok_50] → KV blocks {128,...,131}
│   │   └── [asst_A_tok_1 ... asst_A_tok_200] → KV blocks {132,...,144}
│   └── [user_B_tok_1 ... user_B_tok_30] → KV blocks {128,...,129}  ← shared parent
└── [other_sys_prompt_tok_1 ... ] → KV blocks {200,...}
```

Every node's KV blocks are **shared** across all requests that pass through it. The system prompt node's blocks are referenced by every request using that system prompt, regardless of what follows."""),

    1777518402711: ("tree-kv-eviction",
r"""What's a good eviction policy for tree based kv cache?""",
r"""LRU over nodes is wrong because nodes have **reference counts** — a node referenced by 10 active requests cannot be evicted.

Correct policy:

- Each node has a **ref_count** = number of active requests currently using it
- Only nodes with **ref_count == 0** are eviction candidates
- Among those, evict **leaf nodes first** (they have no dependents in the tree)
- Evicting a leaf frees its KV blocks; if it was the only child, parent may become a new leaf candidate"""),

    1777519586161: ("gateway-idempotency",
r"""How idempotency is enforced in gateway?""",
r"""`request_id` is a client-supplied ULID. Gateway maintains a 24h Redis dedup cache. If the same `request_id` arrives twice within 24h, replay the cached response (or reattach to the in-flight stream)."""),

    1777519640812: ("mid-generation-cancel",
r"""what happens when client pushes "cancel" button mid generation?""",
r"""**Cancellation**: `DELETE /v1/messages/{request_id}` returns 204 immediately and propagates to the worker via the scheduler's cancellation set. Scheduler checks the set at every iteration boundary; the request's KV blocks are freed on the next iteration. Worst case a cancelled request consumes one extra forward pass — acceptable."""),

    1777520235110: ("nixl",
r"""What is NIXL?""",
r"""NIXL (NVIDIA Inference Xfer Library) is an asynchronous point-to-point transfer library for KV cache tensors, open-sourced by NVIDIA at GTC 2025. It's the low-level transport layer that makes disaggregated prefill/decode serving practical at scale. It supports different backends like RDMA/NVLink or NVMe/S3.

```
Prefill GPU HBM
      ↓ NIXL (RDMA/NVLink)
Decode GPU HBM       ← hot path, latency-critical

Prefill GPU HBM
      ↓ NIXL (NVMe-oF / S3)
Long-term KV store   ← for prefix caching across requests, cold path
```"""),

    1777520330961: ("cross-tenant-kv-policy",
r"""What is Cross-tenant policy for KV cache?""",
r"""Cross-tenant policy: **never share KV blocks across tenants**, even for identical token sequences. This is non-negotiable for security; an attacker discovering they got a cache hit on a prefix they didn't send leaks information about other tenants. Anthropic's published policy is workspace-level isolation (moving to that February 2026)."""),

    1777520836529: ("admission-control-estimation",
r"""Admission Control: Estimation vs. max_tokens""",
r"""**Predicted output length:** KV block reservation, batch slot admission, scheduling priority.

**max_tokens:** hard termination, SLA enforcement, billing cap.

For estimation we can use regional P80 or something. Other methods like draft model are expensive.

When we reach the estimated + 5% token length in decode, we evict and ask scheduler to re-admit again. We move the KV cache to CPU."""),

    1777590047270: ("kv-blocksize-sweet-spot",
r"""What is sweet spot for KV cache blocksize?""",
r"""16 tokens is the sweet spot in production. vLLM supports max 32 tokens on CUDA devices."""),

    1777590155034: ("kv-cache-ttl",
r"""What are kv cache TTL expectations?""",
r"""5-min default with refresh-on-hit; 1-hour opt-in for agent workloads (matches Anthropic's two-tier API)."""),

    1777590230534: ("router-cache-contract",
r"""How router works with KV cache?""",
r"""**Router contract.** The cluster router supplies `(tenant_id, prefix_fingerprint, est_prefill_tokens)` and gets back a node selection. Each node exposes a *cache-state report*."""),

    1777601382765: ("cache-pollution-defense",
r"""what to do w/ Cache-pollution attack: 10K unique long prompts/sec?""",
r"""Defenses, in the order I reach for them:

1. **Tenant quota** caps how much a single tenant can keep resident, even if they generate fresh keys. Polluter can hurt themselves but not the system.
2. **Insertion admission filter.** Only insert into the persistent cache after a block has been *seen N≥2 times* (W-TinyLFU admission window). Single-use prompts churn through a small admission buffer and never displace warm blocks.
3. **Per-tenant rate limiting** on cache *writes* separately from request rate limit. A tenant emitting 10K unique long prefixes/sec gets cache-write-throttled while still being served (just from cold).
4. **Anomaly detection.** Per-tenant "single-use entry rate" metric; page on > 80%.
5. **Final fallback:** explicit cache opt-out for the offending tenant; their requests bypass the shared pool entirely."""),

    1777601521064: ("kv-offload-vs-evict",
r"""for kv cache, CPU↔GPU offload vs evict?""",
r"""```
if recompute_cost(block) > 2 × transfer_cost(block) and CPU tier has room:
    demote to CPU
else:
    evict outright
```"""),

    1777601667395: ("router-policy-example",
r"""give example of Router policy""",
r"""```
score(node, req) = α · prefix_overlap(node, req) − β · load(node)

score(node, req) =
    + α * prefix_cache_hit(node, req)
    - β * normalized_queue_delay(node)
    - γ * kv_memory_pressure(node, req)
    - δ * decode_token_pressure(node)
    - ε * prefill_pressure(node, req)
    + ζ * priority_bonus(req)
```"""),

    1777745935697: ("numpy-broadcasting",
r"""can you Explain NumPy broadcasting?""",
r"""Broadcasting rule: compare shapes from the right. Dimensions are compatible if they are equal, or one of them is `1`.

NumPy broadcasting = NumPy automatically "stretches" smaller arrays across compatible dimensions without copying data."""),

    1777746631296: ("gradient-checking",
r"""What is gradient checking and how do you use it?""",
r"""Gradient checking is a debugging technique to verify that your **manual backprop gradients** are correct.

You compute the gradient in two ways:

1. **Analytical gradient** from backprop: $\frac{\partial L}{\partial W}$
2. **Numerical gradient** using finite differences — perturb one parameter slightly and see how the loss changes.

For one parameter $\theta_i$:

$$\text{grad}_{num} = \frac{L(\theta_i + \epsilon) - L(\theta_i - \epsilon)}{2\epsilon}$$

This is called **central difference** and is usually more accurate than using only $L(\theta_i + \epsilon)$."""),

    1777746685329: ("gradient-checking-thresholds",
r"""What are the thresholds for gradient checking?""",
r"""```
1e-7 or smaller: excellent
1e-5: usually okay
1e-3 or larger: suspicious
1e-1: probably wrong
```"""),

    1777774057340: ("python-set-union",
r"""how to add one set to another set in python?""",
r"""```python
set1 = {"apple", "banana"}
set2 = {"cherry", "apple"}
set1.update(set2)  # set1 is now {"apple", "banana", "cherry"}
set3 = set1 | set2
```"""),

    1777774141090: ("python-set-difference",
r"""how to subtract one set from another?""",
r"""```python
fruits = {"apple", "banana", "cherry"}
yellow_things = {"banana", "lemon", "sun"}
# Subtract yellow_things from fruits
# This removes "banana" because it is in both sets

remaining_fruits = fruits - yellow_things
```"""),

    1777853450024: ("haystack-log-packing",
r"""What is log-structured packing (Haystack) for storages like S3?""",
r"""It's used for small-object writes. The trick: don't store one object per file. Concatenate many objects into one big append-only file (an **extent**). Facebook published this as Haystack in 2010. It's how every modern blob store handles small files.

The frontend **batches** writes from many concurrent clients into the **same extent in memory**, then does **one sequential append to disk**. Sequential writes on NVMe hit ~7 GB/s; random writes hit a small fraction of that. You've collapsed 8M random IOPS into 30k sequential appends.

Reads work because the metadata service knows the **(extent, offset, length)** for every object. A GET becomes: metadata lookup → seek to offset on extent → read length bytes. On NVMe, the seek is free."""),

    1777853659505: ("erasure-coding",
r"""What erasure coding (EC) actually does?""",
r"""A data protection method that **slices data into fragments**, expands and encodes them with redundant parity shards, and stores them across multiple locations. It enables **high fault tolerance**, allowing **data reconstruction from any subset of shards (e.g., K of K+M)**. EC offers significantly higher **storage efficiency than replication**, ideal for large-scale, high-durability storage."""),

    1777854070221: ("rs-vs-lrc",
r"""Compare Reed-Solomon (RS) vs Locally Repairable Codes (LRC) for EC""",
r"""The problem with erasure codes is that reconstruction needs all required replicas — high network traffic, especially in hot storage where disk failure is common.

**Reed-Solomon** divides the data with RS(10,4) structure (4 extra shards); we can rebuild from any 10 shards. Problem: if half the shards live in another availability zone, cross-zone traffic kills bandwidth.

**Locally Repairable Codes (LRC)**, introduced by Microsoft: local parity shards for local repair, plus global parities for catastrophic recovery. LRC(12, 2, 2) means 2 groups with 1 local parity each, and 2 globals — enables intra-AZ fixes.

- **Hot tier** (lots of churn, frequent disk replacements): LRC. Repair bandwidth is the cost driver.
- **Warm tier** (default): RS(10,4). Better tolerance, simpler, lower steady-state overhead.
- **Cold tier**: even wider EC like RS(20,4) for cheaper storage at the cost of slower repair."""),

    1777854280000: ("range-partitioned-metadata",
r"""Why we use range-partitioning for metadata storage?""",
r"""```
RANGE-PARTITIONED  (chosen)          HASH-PARTITIONED  (rejected)
═══════════════════════════         ═══════════════════════════

Range 1: aaa..foo                    Shard 7: hash(bucket||key) % 1024
Range 2: foo..mum                    Shard ...:
Range 3: mum..zzz

LIST prefix='2026/04/' →             LIST prefix='2026/04/' →
  hits 1–2 ranges ✓                    fans out to ALL 1024 shards ✗
                                       OR maintain secondary list index ✗
                                       (now you have 2 consistency
                                        problems instead of 1)

Auto-split on:                       Hot-key behavior:
  size > 100 MB                        no graceful split
  QPS > 30k sustained                  only mitigation: app-level salting
  prefix-aware boundary
```"""),

    1777854556331: ("edge-caching-workload",
r"""Should we always have edge caching for a storage system?""",
r"""NO. Edge caching is workload-dependent. For media-bucket-fronted-by-CDN: 95% hit rate, decisive. For ML training reading uniformly across an EB-scale shuffled dataset: hit rate ≈ 0, cache is pure overhead. Make it opt-in, per bucket, with explicit TTL."""),

    1777854658002: ("s3-over-rdma",
r"""what is S3-over-RDMA + GPUDirect?""",
r"""Meta: 3.8× training speedup with GDS → RDMA data plane = table stakes for AI."""),

    1777863105870: ("file-identity",
r"""what's file identity?""",
r"""Key of a file that stays through name changes.

On POSIX, identity is `(fs_id, inode)`. On Windows, `(volume_id, file_id_64)`."""),

    1777864492444: ("hash-families",
r"""what are the hash families?""",
r"""- **Cryptographic** (SHA-256, BLAKE3): collision-resistant. SHA-256 collisions require ~2^128 work. BLAKE3 is faster (~3 GB/s/core, parallelizable within a single file via tree hashing) and equally secure — for greenfield, BLAKE3.
- **Strong non-cryptographic** (xxh3 (64bit), xxh128): ~10 GB/s/core, no collision-resistance guarantee against adversaries but excellent against natural collisions.
- **Broken** (MD5): collisions are constructible. Never use for verification; OK as a cheap funnel stage if speed matters."""),

    1777865124400: ("perceptual-hash",
r"""What is Perceptual hash?""",
r"""Perceptual hashes are "fingerprints" for multimedia files (mostly images) that stay nearly the same even if the file is slightly modified. Unlike cryptographic hashes (like SHA-256), which change completely if even one bit of data is altered, perceptual hashes are designed to identify content based on how it looks to the human eye.

e.g. pHash (perceptual hash), dHash (difference hash)."""),

    1777865376823: ("video-dedup-dinov2",
r"""what to use for video data dedup for training?""",
r"""**DINOv2** is the superior choice for high-precision video training data deduplication. It was specifically built with a data processing pipeline that includes copy detection and deduplication to clean its own training set.

DINOv2 is designed to understand the **geometry and fine-grained structure** of an image. This makes it extremely sensitive to "near-duplicates" — videos that might have different compression, slight color shifts, or different resolutions but contain the exact same content.

Meta used a specialized copy detection pipeline (similar to the one in DINOv2) to filter 1.2 billion images into a high-quality dataset."""),

    1777868072754: ("binary-serialization-vs-json",
r"""can you compare custom binary serialization with json?""",
r"""KVSB is essentially a simplified, non-varint TLV format. It's appropriate when: (1) you control both ends, (2) you need checksum integrity, (3) the schema is fixed to nested string-keyed maps, and (4) field-skipping matters.

MessagePack dominates on wire efficiency for small values and has far better ecosystem support. JSON dominates on debuggability and interoperability. The main concrete thing KVSB has that neither offers is the explicit 32-bit checksum and guaranteed O(1) field skipping with a fixed-width length field."""),

    1777869051989: ("redis-vs-aerospike",
r"""Redis vs Aerospike""",
r"""**Choose Redis if:**

- **Dataset size:** your data fits in memory (<50–100 GB)
- **Data structures:** you need rich types (Lists, Sets, Sorted Sets, Streams)
- **Use case:** general-purpose caching, pub/sub, or leaderboards
- **Simplicity:** you want an easy-to-use, industry-standard tool

**Choose Aerospike if:**

- **Dataset size:** hundreds of GBs to TBs
- **Cost efficiency:** avoid high RAM costs by utilizing SSDs without losing significant performance
- **Use case:** ad-tech, fraud detection, real-time bidding, user profiles
- **Reliability:** strong ACID compliance and high uptime with less node management

**Key comparison points:**

- **Performance:** both offer sub-millisecond latency, but Aerospike outperforms at scale
- **Architecture:** Redis is primarily in-memory; Aerospike is optimized for hybrid memory (indexes in RAM, data on SSD)
- **Scaling:** Aerospike is designed for easier, more efficient scaling to large distributed clusters"""),

    1777880954485: ("yjs",
r"""What is **Yjs** and what is its primary technical mechanism?""",
r"""A high-performance **CRDT** (Conflict-free Replicated Data Type) framework used to build **real-time collaborative applications** (like shared editors) by syncing binary document updates across users without a central merge conflict."""),

    1777882158482: ("gvisor-vs-firecracker",
r"""Can you compare gVisor and Firecracker for notebook kernel execution? Which is better for agents running?""",
r"""**gVisor:** high isolation, instant boot (like a process), very low memory overhead (15MB). Also can access GPUs. Better for user space.

**Firecracker:** extreme isolation, fast boot (<200ms), low memory overhead (5MB + kernel).

Firecracker is better for agent execution for extreme isolation; but harder to set up."""),

    1777884743663: ("notebook-state-layers",
r"""What are the three layers of state in a notebook, what survives what, and what invariant governs the design?""",
r"""1. **Document state** (cell text, outputs, metadata) — Yjs CRDT ops log → S3 every 5s, Postgres snapshot every 60s. Survives everything.
2. **User-volume state** (uploaded files, written intermediates) — per-user EBS-class volume, mounted on every kernel start. Survives kernel death.
3. **Kernel in-memory state** (Python variables) — in the kernel process. Survives hibernate/restore via snapshot. Does *not* survive OOM, crash, host failure, or 7-day eviction.

Governing invariant: *the notebook document is the durable artifact; the kernel is ephemeral*. The system mitigates kernel loss but does not promise to prevent it."""),

    1777926785669: ("heapq-nlargest",
r"""heapq largest and smallest""",
r"""```python
heapq.nlargest(3, words, key=lambda w: count[w])
heapq.nsmallest(k, counter.keys(), key=lambda w: (-counter[w], w))
```"""),

    1777978786266: ("stable-sigmoid",
r"""what's stable sigmoid?""",
r"""The standard formula for a sigmoid is:

$$\sigma(z)=\frac{1}{1+e^{-z}}$$

The issue occurs when $z$ is a large negative number (e.g., $z = -800$). The term $e^{-(-800)} = e^{800}$ grows so large that it exceeds the capacity of a standard 64-bit float, causing an **overflow**.

To create a stable version, we use two mathematically equivalent forms depending on the sign of $z$:

1. **For $z \geq 0$:** use the standard form $\frac{1}{1+e^{-z}}$. Since $e^{-z}$ will be between 0 and 1, it is perfectly stable.
2. **For $z < 0$:** use the alternative form $\frac{e^{z}}{1+e^{z}}$. Here, $e^{z}$ will be between 0 and 1, avoiding the large exponential.

```python
def sigmoid(x):
    # Stable sigmoid
    return np.where(
        x >= 0,
        1 / (1 + np.exp(-x)),
        np.exp(x) / (1 + np.exp(x))
    )
```"""),

    1777979504320: ("silu-forward-backward",
r"""Silu forward & backward formula""",
r"""SiLU is:

$$\text{silu}(x) = x \cdot \sigma(x)$$

where (sigmoid):

$$x\ge0: \sigma(x) = \frac{1}{1 + e^{-x}} \qquad x<0: \sigma(x) = \frac{e^{x}}{1 + e^{x}}$$

Backward:

$$\frac{d}{dx}\text{silu}(x) = \sigma(x) + x \cdot \sigma(x)(1 - \sigma(x))$$"""),

    1778038098466: ("bloom-filter-sizing",
r"""what's bloom filter's optimal bits and k-hash based on false positive rate (FPR)?""",
r"""| p (FPR) | bits/element | optimal k (hash functions) |
|---|---|---|
| 10% | 4.8 | 3 |
| 1% | 9.6 | 7 |
| 0.1% | 14.4 | 10 |
| 0.01% | 19.2 | 13 |"""),

    1778038338199: ("replicate-operation-not-value",
r"""what is "replicate the operation, not the value"?""",
r"""Each region is the authority for its own writes. When EU-West counts an impression, it writes locally and also publishes the event to the global Kafka topic. The other regions consume that topic and apply the same `INCR` to their local counters.

Why publish *events* and not *counter values*? Because counters are commutative.

Brief vocabulary: this pattern — "replicate the operation, not the value" — is how a counting CRDT works. You don't need to call it that, but if the interviewer brings up CRDTs, you can say yes, that's exactly what this is, structurally a G-Counter per region that sums to a global total."""),

    1778038935888: ("tumble-vs-sliding-window",
r"""can you compare tumble vs sliding window?""",
r"""Over a range of 0 to 10: tumble of 5 counts items in [0,5], [5,10].

But sliding window of 5 does: [0,5], [1,6], [2,7], ..."""),

    1778102618848: ("cache-correct-framing",
r"""whats correct framing about caching?""",
r"""A cache is not a performance optimization. A cache is a consistency contract — a promise about how stale the data it returns may be relative to the source of truth — that we are willing to honor in exchange for serving reads from RAM instead of from a disk-backed system. Every other decision (eviction, replication, sharding, invalidation) is a downstream consequence."""),

    1778103241631: ("tail-latency-mitigations",
r"""what are **Tail-latency mitigations?**""",
r"""- Hedged reads to a second replica at the p95 latency mark (~400μs); take first response. Costs +5% bandwidth, cuts p99.9 by ~2x.
- Same-rack placement for clients ↔ cache via topology-aware shard map. Cross-rack adds 200μs and blows the budget at p99.
- No TLS on the cache-internal hop (the network is private); TLS adds 50–100μs handshake amortized + per-record overhead."""),

    1778103329316: ("sub-ms-cache",
r"""how can we achieve sub-ms cache?""",
r"""Cross-rack p99 ≥ 1.2ms. Cross-AZ p99 ≥ 2ms. **The sub-ms p99 promise is a same-rack promise; I will state this explicitly in the SLA.**"""),

    1778103972758: ("debezium-cdc",
r"""what is Debezium-style CDC?""",
r"""DB CDC means **Database Change Data Capture**.

A "Debezium-style CDC" system refers to streaming database changes (inserts, updates, deletes) from a database's transaction log into an event stream in near real time. The term comes from Debezium, one of the most popular open-source CDC platforms.

**Debezium architecture:**

```
Postgres/MySQL
      ↓
Transaction Log
      ↓
Debezium Connector
      ↓
Kafka
      ↓
Consumers
```"""),

    1778146783201: ("ttl-reasons",
r"""What are the main reasons to use TTL?""",
r"""- As a backstop to staleness (imagine DB CDC — change detection mechanism — fails).
- As memory clean up."""),

    1778169728769: ("hashing-scheme-comparison",
r"""Can you compare main hashing functions?""",
r"""| Scheme | Hot KEY problem | Hot RANGE problem | Rebalance I/O spread | Replica selection |
|---|---|---|---|---|
| Hash-mod-N | Yes* | No | Bad | Awkward |
| Consistent hashing | Yes* | No | Good | Awkward |
| Rendezvous (HRW) | Yes* | No | Good | Natural |
| Range-based | Yes* | YES | Concentrated | Manual |

\* All schemes have the hot-key problem; mitigated architecturally via hot-key tier, client micro-cache, and replication — not via the sharding scheme."""),

    1778170008500: ("scan-support-scheme",
r"""which hashing scheme has scan support?""",
r"""Range-based scheme supports scan queries. Other schemes need fan-out queries."""),

    1778170180933: ("rendezvous-hashing",
r"""What is Rendezvous hashing (HRW — Highest Random Weight)?""",
r"""No ring. For each key K, compute a score for every node and pick the highest. The cost is O(N) vs. ring's O(log N).

```
score(K, node_i) = hash(K + node_i)    // combine key + node identity

For key K = "user:42":
  score(K, node0) = hash("user:42" + "node0") = 0.82
  score(K, node1) = hash("user:42" + "node1") = 0.34
  score(K, node2) = hash("user:42" + "node2") = 0.91  ← winner (primary)
  score(K, node3) = hash("user:42" + "node3") = 0.67  ← 2nd (replica 1)
  score(K, node4) = hash("user:42" + "node4") = 0.45  ← 3rd (replica 2)
```"""),

    1778170499132: ("consistent-hashing-vnodes",
r"""What is consistent hashing with virtual nodes?""",
r"""Fix the instability by mapping both keys and nodes onto a ring (0 → 2³²).

The ring data structure needs to be maintained and synchronized — it's a sorted data structure with O(log N) lookup, not terrible but not trivial.

```
Ring: 0 ──────────────────────────────── 2^32

Physical nodes:
  Node A ──────────────► position 1,200,000
  Node B ──────────────► position 2,800,000
  Node C ──────────────► position 3,900,000

Key K: hash(K) = 1,500,000 → walk clockwise → lands on Node B

Adding a new node D at position 2,100,000:

Before: keys in (1,200,000 → 2,800,000] → Node B
After:  keys in (1,200,000 → 2,100,000] → Node D   ← moved
        keys in (2,100,000 → 2,800,000] → Node B   ← stayed
```"""),

    1778230827885: ("which-hash-when",
r"""When to use which hashing algorithm?""",
r"""```
Money / billing / permissions / external input:
    SHA-256 or BLAKE3
(SHA-512 is post quantum resistance)

Internal cache / routing / metrics / partitioning:
    xxHash3 / xxHash64
```"""),

    1778231237386: ("canonicalization",
r"""what is Canonicalization? give example of payment system dedup.""",
r"""Clean and standardize the request before hashing it.

You should consider these the same: `50`, `50.0`, `50.00` — because they canonicalize to the same amount: `5000 cents`.

```python
canonical = {
    "operation": "charge",
    "merchant_id": "m1",
    "customer_id": "c1",
    "currency": "USD",
    "amount_minor": 5000,   # $50.00
}

payload = json.dumps(canonical, sort_keys=True, separators=(",", ":"))
fingerprint = hashlib.sha256(payload.encode()).hexdigest()
```"""),

    1778234158974: ("kleppmann-lock-argument",
r"""What is Kleppmann's distributed-lock argument?""",
r"""A distributed lock by itself is not enough to protect correctness, because the client holding the lock can pause or get delayed after its lock expires. Use fencing tokens.

```
Efficiency only:
    Redis lock / Redlock may be acceptable
    Example: avoid duplicate background work

Correctness-critical:
    use consensus-backed lock service or transactional DB
    require fencing tokens
    resource must enforce token ordering
```"""),
}

push_cards(CARDS)
