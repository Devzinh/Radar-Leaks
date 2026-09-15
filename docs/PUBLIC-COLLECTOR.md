# Public event collector

The existing Netlify minute schedule invokes `scan-background`. Before draining the scan queue, this function attempts one public collection cycle. The same cycle runs in the local server. No new secrets or database migration are required.

The database rate gate permits one collection attempt every five minutes across instances. Each cycle reads the newest 100 public GitHub events, validates public PushEvents and queues at most ten head commits. The existing repository/commit uniqueness constraint deduplicates deliveries and webhook overlap. Collection pauses at 100 pending jobs. The scanner verifies repository visibility before fetching patches with GitHub App authentication.

The collector honors ETag, GitHub poll intervals and rate-limit retry deadlines. Operational state is stored under `radar_state.id = collector`; it contains event IDs, counts, dates and sanitized errors, never source content. Dashboard access remains authenticated and excludes internal ETag/event IDs. Failed collection does not prevent existing jobs from running.

## Coverage

This is a bounded sample, not an exhaustive GitHub monitor. Events can be delayed or fall outside the latest page. Only the head commit is queued from each selected push; other commits in the push and historical files are not covered. There is no global Code Search collector. Missing patches remain marked partial. Queue counts and successful collection dates do not prove that any credential is valid.

## Operations

Deploy through the normal Netlify Git build. Confirm the public collector card reports a recent successful poll and that new repositories appear with completed scans. Local runs use the same database gate and must not be pointed at production unless sharing its collection schedule is intended.

To roll back public collection, revert the deployment containing this collector. Already queued jobs remain available; no findings or queue records are deleted. Monitor Netlify usage and GitHub rate limits before increasing sampling volume.
