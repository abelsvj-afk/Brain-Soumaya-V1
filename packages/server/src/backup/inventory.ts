/**
 * G0 backup — pinned critical-table inventory (G0 spec §2, G0-03).
 *
 * v1 was pinned by increment B0 against main @ 6c115b4d (PR #133) in
 * `Soumaya-G0-B0-Table-Inventory-2026-10-29.md` (106 named tables,
 * 105 included, 29 MUST-BE-NONEMPTY) and amended to v1.1 by review
 * (bucketed sqlite_master assertion, all-MUST production preflight,
 * three reconciliation tiers).
 *
 * THIS FILE is inventory **v5**. v2 was a version bump under the spec §2
 * mechanism, made by increment B1 at its anchor main @ ea6260d
 * (PR #134). Changes from v1, all MAY-BE-EMPTY additions:
 *  - `relic_copies`, `relic_copy_events` — landed by Relics I-2 between
 *    the B0 pin and the B1 anchor.
 *  - `backup_attempts` — the lifecycle-records table this increment adds
 *    (see db/schemaSql.ts + db/client.ts migrateSchema).
 * Totals at v2: 109 named tables, 108 included, 29 MUST-BE-NONEMPTY,
 * 1 excluded (`tts_audio_cache`, spec §1 cache).
 *
 * v3 (owner-authorized 2026-10-30): 8 tables that landed on main AFTER
 * the B1 anchor — post-anchor schema drift, also present in production —
 * added, all MAY-BE-EMPTY: `society_prefs`, `story_finds`, `story_links`,
 * `story_notes`, `story_roads`, `lore_voices`, `story_prefs`, `story_flavor_day`,
 * `npc_day_script`. Totals at v3: 117 named tables, 116 included,
 * 29 MUST-BE-NONEMPTY, 1 excluded.
 *
 * v4 (owner-authorized 2026-10-30): two corrections, both verified
 * against production read-only (flyctl machine exec, /data/brain.db,
 * app v370, 2026-10-30):
 *  - REMOVED `relic_holdings`, `relic_returns`, `relic_copies`,
 *    `relic_copy_events` — deploy-line-only tables (Relics I-1/I-2)
 *    that exist neither on main nor in production (verified: no such
 *    tables in production at all). Their presence here made the
 *    manifest stage fail with "inventory table missing from database"
 *    on any main-built database — the v3 unknown-table failure had
 *    masked this opposite-direction drift. When the relics increments
 *    land on main, these return via a future inventory version.
 *  - ADDED `daily_quests` (MAY-BE-EMPTY, included) plus its DDL in both
 *    schema locations: production carries the table (3 rows) but
 *    main's schema never created it — legacy residue from the
 *    streaks-and-quests era, so a main-pinned inventory met it in
 *    production as an unrecognized table. The DDL added to
 *    db/schemaSql.ts + db/client.ts mirrors production's ACTUAL
 *    definition (extracted read-only from sqlite_master). The plan doc
 *    (plans/streaks-and-quests-spec.md) disagrees with production —
 *    FK parent (`space_meta` vs `spaces`), NOT NULL flags on the
 *    progress/completion columns, and the index name — production
 *    shape wins.
 * Totals at v4: 114 named tables, 113 included, 29 MUST-BE-NONEMPTY,
 * 1 excluded.
 *
 * v5 (owner-authorized 2026-10-30): the amendment-B preflight open item
 * is RESOLVED and MUST enforcement turns ON. A read-only investigation
 * (2026-10-30) explained all three unexpectedly-empty MUST tables, and
 * all three are reclassified MUST → MAY-BE-EMPTY, each with its cause:
 *  - `fin_expense` (PERMANENT): the brain-side expense pipeline was fed
 *    exactly once, with income only; the owner's real expense data
 *    lives in the Money Tracker artifact's separate store and is never
 *    written here. Zero rows is this table's legitimate state.
 *  - `episodes_fts` + `vec_episodes` (PROVISIONAL): production holds
 *    140 captured episodes, all enrichment_status='pending', because
 *    the enrichment worker (agent/episodic.ts enrichEpisode /
 *    claimEnrichment) has no production caller — the indexes are empty
 *    by construction, not by data loss (vec_nodes = 255 proves the
 *    vector infrastructure works). When the worker is wired and a
 *    backfill populates both indexes, a future inventory version MUST
 *    restore both to MUST-BE-NONEMPTY.
 * The remaining 26 MUST tables are all CONFIRMED NONEMPTY in
 * production, so the wiped-DB guard is now enforced by default on
 * every path (see backup/runner.ts — the pipeline default flipped to
 * enforce in this same change).
 * Totals at v5: 115 named tables, 114 included, 26 MUST-BE-NONEMPTY,
 * 88 MAY-BE-EMPTY, 1 excluded. (The v4 totals line above undercounts
 * named/included by one — `story_roads` joined with the v3 group after
 * that line was drafted; the pinned test's counts have always governed.)
 *
 * Classes (spec §2): "must-be-nonempty" — zero rows in a snapshot means a
 * wiped/corrupt snapshot, reject; "may-be-empty" — count is recorded in
 * the manifest and compared, zero is legitimate; "excluded" — not counted
 * (rebuildable cache). The snapshot is always the whole database file;
 * classes govern manifest counts and verification invariants only.
 *
 * The MUST set encodes THIS brain's functioning state (B0 §5 judgment
 * calls — e.g. the fin_* MUSTs rest on the live Finance Project). The
 * all-29 production preflight (B0 v1.1 amendment B) gates ENFORCEMENT of
 * the MUST invariant, not this list.
 *
 * PREFLIGHT RESULT (B1, 2026-10-30, read-only counts on production
 * /data/brain.db @ app v349): 26 of 29 CONFIRMED NONEMPTY; 3 UNEXPECTEDLY
 * EMPTY — `episodes_fts` (0 while episodes = 133), `vec_episodes` (0),
 * `fin_expense` (0). MUST enforcement therefore stayed OFF in
 * production until those three were resolved — and v5 (above) IS that
 * resolution: all three explained and reclassified with causes, the
 * remaining 26 confirmed nonempty, enforcement now ON by default.
 */
export type BackupTableClass = "must-be-nonempty" | "may-be-empty" | "excluded";

export const BACKUP_INVENTORY_VERSION = 5;

export const BACKUP_TABLE_INVENTORY: Readonly<Record<string, BackupTableClass>> = {
  // ── Sources & content ──────────────────────────────────────────────
  sources: "must-be-nonempty",
  source_chunks: "must-be-nonempty",
  sources_fts: "must-be-nonempty",
  knowledge_docs: "must-be-nonempty",
  knowledge_chunks: "must-be-nonempty",
  source_corrections: "may-be-empty",
  attachments: "may-be-empty",
  // ── Memory core ────────────────────────────────────────────────────
  nodes: "must-be-nonempty",
  edges: "must-be-nonempty",
  node_sources: "must-be-nonempty",
  episodes: "must-be-nonempty",
  episodes_fts: "may-be-empty", // v5 PROVISIONAL: enrichment worker unwired — 140 prod episodes pending, index empty by construction; restore MUST after the backfill
  nodes_fts: "must-be-nonempty",
  vec_nodes: "must-be-nonempty",
  vec_episodes: "may-be-empty", // v5 PROVISIONAL: same root cause as episodes_fts — enrichment unwired; restore MUST after the backfill
  vec_docs: "must-be-nonempty",
  vec_source_chunks: "must-be-nonempty",
  vec_profiles: "must-be-nonempty",
  user_model: "must-be-nonempty",
  daily_logs: "must-be-nonempty",
  vec_journeys: "may-be-empty",
  candidate_links: "may-be-empty",
  link_rejections: "may-be-empty",
  insights: "may-be-empty",
  contradictions: "may-be-empty",
  corrections: "may-be-empty",
  consolidation_episodes: "may-be-empty",
  consolidation_runs: "may-be-empty",
  episode_enrichments: "may-be-empty",
  enrichment_quota: "may-be-empty",
  access_stats: "may-be-empty",
  w3_recon_progress: "may-be-empty",
  w3_recon_semantic_queue: "may-be-empty",
  working_memory: "may-be-empty",
  forget_requests: "may-be-empty",
  forget_unresolved_flags: "may-be-empty",
  timeline_chapters: "may-be-empty",
  intelligence_clarifications: "may-be-empty",
  inquiries: "may-be-empty",
  // ── People & relationships ─────────────────────────────────────────
  user_persona: "must-be-nonempty",
  daily_contact: "may-be-empty",
  dismissed_names: "may-be-empty",
  interaction_preferences: "may-be-empty",
  instruction_profiles: "may-be-empty",
  lenses: "may-be-empty",
  telegram_note_drafts: "may-be-empty",
  // ── Travel & economy ───────────────────────────────────────────────
  space_meta: "must-be-nonempty",
  travel_journeys: "may-be-empty",
  travel_journey_events: "may-be-empty",
  journeys: "may-be-empty",
  journey_link: "may-be-empty",
  journey_mission_completions: "may-be-empty",
  daily_earn_counts: "may-be-empty",
  daily_quests: "may-be-empty", // v4: prod-carried legacy table, DDL reconciled into both schema locations
  streak_days: "may-be-empty",
  undertakings: "may-be-empty",
  // ── Game progress (all MAY-BE-EMPTY: progress state, counted always) ─
  codex_discoveries: "may-be-empty",
  codex_claims: "may-be-empty",
  // v4: relic_holdings / relic_returns / relic_copies / relic_copy_events
  // removed — deploy-line only, absent from main AND production (see header).
  npc_relic_holdings: "may-be-empty",
  npc_state: "may-be-empty",
  npc_gate: "may-be-empty",
  npc_log: "may-be-empty",
  garden_tends: "may-be-empty",
  review_grade_attempts: "may-be-empty",
  fleet_defense_defenses: "may-be-empty",
  fleet_defense_log: "may-be-empty",
  fleet_defense_releases: "may-be-empty",
  mission_missions: "may-be-empty",
  mission_log: "may-be-empty",
  mission_fleet_state: "may-be-empty",
  tours: "may-be-empty",
  tour_sessions: "may-be-empty",
  tour_log: "may-be-empty",
  world_landmarks: "may-be-empty",
  world_paths: "may-be-empty",
  world_proposals: "may-be-empty",
  world_change_log: "may-be-empty",
  lore: "may-be-empty",
  tool_approvals: "may-be-empty",
  // ── Story / lore / NPC daily state (v3: post-anchor drift on main) ──
  society_prefs: "may-be-empty", // v3
  story_finds: "may-be-empty", // v3
  story_links: "may-be-empty", // v3
  story_notes: "may-be-empty", // v3
  story_roads: "may-be-empty",
  lore_voices: "may-be-empty", // v3
  story_prefs: "may-be-empty", // v3
  story_flavor_day: "may-be-empty", // v3
  npc_day_script: "may-be-empty", // v3
  // ── Finance (the user's real financial data — critical content) ────
  fin_account: "must-be-nonempty",
  fin_source: "must-be-nonempty",
  fin_expense: "may-be-empty", // v5: real expense data lives in the Money Tracker artifact store; the brain-side pipeline was fed once (income only) — zero here is legitimate
  fin_income: "must-be-nonempty",
  fin_bill: "must-be-nonempty",
  fin_bill_occurrence: "must-be-nonempty",
  fin_paystub: "must-be-nonempty",
  fin_asset: "may-be-empty",
  fin_asset_snapshot: "may-be-empty",
  fin_allocation: "may-be-empty",
  fin_bucket: "may-be-empty",
  fin_category_override: "may-be-empty",
  fin_goal: "may-be-empty",
  fin_goal_link: "may-be-empty",
  // ── Configuration ──────────────────────────────────────────────────
  spaces: "must-be-nonempty",
  settings: "must-be-nonempty",
  telegram_links: "may-be-empty",
  push_subscriptions: "may-be-empty",
  // ── Delivery state (all IN per plan ruling — dedup safety) ─────────
  notification_outbox: "may-be-empty",
  notification_outbox_deliveries: "may-be-empty",
  notification_cap_claims: "may-be-empty",
  push_outbox: "may-be-empty",
  inbox_notifications: "may-be-empty",
  // ── Ops & cache ────────────────────────────────────────────────────
  agent_logs: "may-be-empty",
  visitor_stats: "may-be-empty",
  tts_audio_cache: "excluded",
  // ── G0 lifecycle records (v2: added by increment B1 itself) ────────
  backup_attempts: "may-be-empty",
};

export const INCLUDED_TABLES: readonly string[] = Object.entries(BACKUP_TABLE_INVENTORY)
  .filter(([, cls]) => cls !== "excluded")
  .map(([name]) => name);

export const MUST_BE_NONEMPTY_TABLES: readonly string[] = Object.entries(BACKUP_TABLE_INVENTORY)
  .filter(([, cls]) => cls === "must-be-nonempty")
  .map(([name]) => name);

export const EXCLUDED_TABLES: readonly string[] = Object.entries(BACKUP_TABLE_INVENTORY)
  .filter(([, cls]) => cls === "excluded")
  .map(([name]) => name);
