# A6-OPS-LOCAL-01 — One-time local safety cleanup

**Status:** Ready; execution not started  
**Opened:** 7 October 2026  
**Type:** Independent one-time operational package  
**EO effect:** Does not add, split, close, reorder or block an A6-EO package  
**Deletion authority:** None at package opening

## Purpose

Close historical local-only risk created before the mandatory package-end gate became binding. The package inventories repository-affiliated local state, proves which content is durable on GitHub or otherwise intentionally preserved, then performs only recoverable and explicitly authorized cleanup.

This is a one-time remediation package. Recurrence is prevented by the already-binding end-of-package gate in `contracts/repository-delivery-workflow-v1.json`.

## Scope

- The read-only legacy anchor at `C:\Users\dev\Documents\Codex\ads-table-dev`.
- Codex-managed or Git-registered linked worktrees associated with AdsTable repositories.
- Staged, tracked-modified, untracked and ignored project-affiliated files.
- Stashes, detached or upstream-less/ahead local branch tips and stale worktree metadata.
- Reproducible caches, dependencies and build outputs.
- Conscious local exceptions such as secrets and machine-only backups, without exposing their values.

The package does not clean arbitrary user folders, unrelated repositories, provider systems, databases, Vercel, Supabase or GitHub remote history.

## Work steps

### A6-OPS-LOCAL-01-A — Read-only inventory and freeze

Record repository roots, `HEAD`, branch/upstream state, `git-common-dir`, status including untracked/ignored classification, stashes, local branch reachability and all linked worktrees. No mutation is allowed.

### A6-OPS-LOCAL-01-B — Classification and remote-equivalence proof

Classify every finding as meaningful project work, secret, intentional backup, reproducible cache/dependency/build output, active worktree, archived/recoverable worktree or stale metadata. Meaningful project work must have an exact GitHub branch/PR/commit/content equivalent before cleanup.

### A6-OPS-LOCAL-01-C — Recoverable cleanup execution

After a fresh manifest and separate explicit user approval, archive eligible Codex-managed worktrees through the Codex recoverable archive mechanism. Remove only proven disposable files inside exact validated roots. Stale worktree metadata may be pruned only after dry-run evidence. No force removal, broad recursive target, local Git repair, ACL/GCM change, process termination or server/VM restart is authorized.

### A6-OPS-LOCAL-01-D — Closure evidence

Re-run the full inventory and prove: zero meaningful local-only project work, no active worktree damage, the anchor/common Git metadata remains intact, remote equivalents are readable, secrets were not uploaded, and every conscious local exception is recorded.

## Safety invariants

- Inventory precedes classification; classification precedes mutation.
- No local file, stash, branch or worktree is removed before remote equivalence or an intentional preservation decision is proven.
- The legacy anchor and shared `.git` are never deleted while linked worktrees exist.
- An unclean or locked worktree is not force-removed.
- Secret values are neither printed nor committed.
- Cache, dependency and build outputs are not treated as source delivery.
- Unknown ownership or ambiguous content fails closed.
- Package opening does not authorize cleanup execution.

## Acceptance

The package closes only when all four steps pass, GitHub evidence is attached, zero meaningful local-only work is proven, repository-delivery governance still passes, and the user explicitly accepts the cleanup result.

## Official sources checked 7 October 2026

- OpenAI Codex workflow guidance: https://developers.openai.com/blog/mastering-codex-remote-for-engineering
- Git worktree documentation: https://git-scm.com/docs/git-worktree
- Git status documentation: https://git-scm.com/docs/git-status
