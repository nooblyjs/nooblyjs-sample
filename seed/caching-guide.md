# Caching guide

Cache what is expensive to compute and cheap to recompute when it goes stale.

## Key naming

Use a prefix and an identifier separated by a colon: `doc:{id}`, `search:{hash}`, `stats:dashboard`. Prefixes make keys easy to find on the caching dashboard.

## Invalidation

- Delete a key whenever the data behind it changes (`cache.delete('doc:' + id)` after an update).
- For keys you cannot enumerate, such as search results, keep a **generation counter**. Include it in the key and increment it on every change, so old entries are never read again.

## Providers

The default `memory` provider is per-process and evicts the least recently used entries. Use the `redis` or `memcached` provider when several app instances must share a cache.

## Watch the hit rate

The caching dashboard shows the hit rate per key. A key that is written often but rarely read is not worth caching.
