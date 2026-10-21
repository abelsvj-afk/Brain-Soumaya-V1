/**
 * Bootstrap schema (CREATE TABLE IF NOT EXISTS …) for a fresh DB. Extracted from
 * client.ts (Post-MVP D4) so the ~270-line SQL string doesn't dwarf the DB logic.
 * Additive/idempotent migrations for existing volumes stay in client.ts (migrateSchema).
 *
 * Timestamp defaults are the canonical ISO-Z form —
 * DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) — never CURRENT_TIMESTAMP
 * (whose space-separated shape mixed formats within single columns; date/time
 * accuracy audit gap #7). New tables must follow the same form.
 */
export const BOOTSTRAP_SQL = `
    CREATE TABLE IF NOT EXISTS nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      label TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      emotional_weight REAL,
      importance REAL,
      occurred_at TEXT,
      remind_at TEXT,
      tags TEXT,
      research_questions TEXT,
      research_answers TEXT,
      progress REAL,
      aliases TEXT,
      idempotency_key TEXT,
      fired_by_approval INTEGER,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      -- W1 temporal truth (wisdom layer): bitemporal columns.
      -- valid_from/valid_to: when the fact was true in the real world (NULL = unknown).
      -- recorded_at: when the system recorded the row (immutable; backstop default).
      -- superseded_at/superseded_by/supersede_reason: transaction-time supersession pointer.
      valid_from TEXT,
      valid_to TEXT,
      recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      superseded_at TEXT,
      superseded_by INTEGER,
      supersede_reason TEXT
    );
    -- W1: append-only correction events. Corrections are events, not row mutations —
    -- a mutable flag on the row would corrupt historical as-of queries. The "never
    -- true" status is DERIVED from this table, never stored on the node row.
    CREATE TABLE IF NOT EXISTS corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      node_id INTEGER NOT NULL,
      correction_type TEXT NOT NULL,
      corrected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      corrected_by TEXT NOT NULL,
      reason TEXT,
      superseding_node_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_corrections_node ON corrections(node_id);
    CREATE INDEX IF NOT EXISTS idx_corrections_space_time ON corrections(space_id, corrected_at);
    CREATE TABLE IF NOT EXISTS edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      source INTEGER NOT NULL REFERENCES nodes(id),
      target INTEGER NOT NULL REFERENCES nodes(id),
      relationship TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS edges_source_idx ON edges(source);
    CREATE INDEX IF NOT EXISTS edges_target_idx ON edges(target);
    CREATE TABLE IF NOT EXISTS insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      node_a INTEGER NOT NULL REFERENCES nodes(id),
      node_b INTEGER NOT NULL REFERENCES nodes(id),
      text TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      kind TEXT NOT NULL DEFAULT 'synthesis',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS agent_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      agent TEXT NOT NULL DEFAULT 'soumaya',
      action TEXT NOT NULL,
      description TEXT NOT NULL,
      targets TEXT NOT NULL,
      result TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    -- Phase 1 agent loop: operational approval state machine. Mutable by
    -- design; every transition appends an immutable row to agent_logs.
    CREATE TABLE IF NOT EXISTS tool_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL,
      principal TEXT NOT NULL,
      tool TEXT NOT NULL,
      args_json TEXT NOT NULL,
      args_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      expires_at TEXT NOT NULL,
      decided_at TEXT,
      execution_attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      execution_log_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS tool_approvals_space_idx ON tool_approvals(space_id, status);
    CREATE INDEX IF NOT EXISTS tool_approvals_principal_idx ON tool_approvals(principal, status);
    -- NOTE: nodes_idem_idx is created in migrateSchema (db/client.ts), NOT here.
    -- The idempotency_key column is added via ALTER on existing databases, and
    -- BOOTSTRAP_SQL runs before migrateSchema — creating the index here crashes
    -- on databases that predate the column (SqliteError: no such column).
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS daily_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      content TEXT NOT NULL,
      date TEXT NOT NULL DEFAULT CURRENT_DATE,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS spaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      gamer_tag TEXT NOT NULL UNIQUE,
      passcode_hash TEXT NOT NULL,
      passcode_salt TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS space_meta (
      space_id TEXT PRIMARY KEY,
      fuel REAL NOT NULL DEFAULT 25,
      streak INTEGER NOT NULL DEFAULT 0,
      streak_best INTEGER NOT NULL DEFAULT 0,
      last_active_date TEXT,
      last_seen_at TEXT,
      research_enabled TEXT,
      last_dream_date TEXT,
      timeline_backfilled INTEGER NOT NULL DEFAULT 0,
      streak_shields INTEGER NOT NULL DEFAULT 2,
      soul TEXT,
      grounded_insight INTEGER NOT NULL DEFAULT 1,
      timezone TEXT NOT NULL DEFAULT 'America/New_York',
      quiet_start TEXT NOT NULL DEFAULT '21:00',
      quiet_end TEXT NOT NULL DEFAULT '04:30',
      digest_time TEXT NOT NULL DEFAULT '06:00',
      daily_proactive_cap INTEGER NOT NULL DEFAULT 5,
      w1_cascade_enabled INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    -- Telegram: bind a chat to a brain so messages route to the right space and
    -- proactive digests know where to push. One chat → one brain (re-/link swaps).
    CREATE TABLE IF NOT EXISTS telegram_links (
      chat_id INTEGER PRIMARY KEY,
      space_id TEXT NOT NULL,
      space_name TEXT NOT NULL,
      last_digest_date TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    -- Append-only, versioned lore per object (memory/ship/station/beacon).
    CREATE TABLE IF NOT EXISTS lore (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      text TEXT NOT NULL,
      trigger TEXT NOT NULL DEFAULT 'genesis',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS lore_subject_idx
      ON lore(space_id, subject_type, subject_id, version);
    -- AI Companion: Layer-2 instruction profiles, knowledge docs + chunks, About-Me.
    CREATE TABLE IF NOT EXISTS instruction_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      name TEXT NOT NULL,
      body TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      mode TEXT NOT NULL DEFAULT 'always',
      priority INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS instruction_profiles_space_idx ON instruction_profiles(space_id);
    CREATE TABLE IF NOT EXISTS knowledge_docs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      name TEXT NOT NULL,
      mime TEXT NOT NULL DEFAULT 'text/plain',
      char_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS knowledge_docs_space_idx ON knowledge_docs(space_id);
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      doc_id INTEGER NOT NULL REFERENCES knowledge_docs(id),
      ordinal INTEGER NOT NULL,
      content TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS knowledge_chunks_doc_idx ON knowledge_chunks(doc_id);
    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      node_id INTEGER NOT NULL REFERENCES nodes(id),
      filename TEXT NOT NULL,
      mime TEXT NOT NULL DEFAULT 'application/octet-stream',
      size INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS attachments_node_idx ON attachments(node_id);
    CREATE TABLE IF NOT EXISTS codex_claims (
      space_id TEXT NOT NULL DEFAULT 'legacy',
      reward_key TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (space_id, reward_key)
    );
    -- Undertakings (Level 2): a multi-day arc Soumaya commits to, so her autonomy
    -- has narrative ("Day 3 of 5 — Warming the cold belt") instead of 5-min ticks.
    CREATE TABLE IF NOT EXISTS undertakings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      total INTEGER NOT NULL DEFAULT 1,
      done INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      ends_at TEXT
    );
    CREATE INDEX IF NOT EXISTS undertakings_space_idx ON undertakings(space_id, status);
    -- The Daily Contact: her one question/discovery per brain per day, persisted
    -- so it stays stable across reloads; answered flips when the user replies.
    CREATE TABLE IF NOT EXISTS daily_contact (
      space_id TEXT NOT NULL DEFAULT 'legacy',
      date TEXT NOT NULL,
      payload TEXT NOT NULL,
      answered INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (space_id, date)
    );
    CREATE TABLE IF NOT EXISTS user_persona (
      space_id TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    -- Visitor activity: aggregated visits per memory + craft type.
    CREATE TABLE IF NOT EXISTS visitor_stats (
      space_id TEXT NOT NULL DEFAULT 'legacy',
      node_id INTEGER NOT NULL,
      visitor_type TEXT NOT NULL,
      visits INTEGER NOT NULL DEFAULT 0,
      last_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (space_id, node_id, visitor_type)
    );
    CREATE INDEX IF NOT EXISTS visitor_stats_space_idx ON visitor_stats(space_id);
    -- Working Memory (Cognitive Layer Phase 2): the ephemeral "mind space" — what
    -- you're thinking NOW. Thought-motes decay unless reinforced; survivors are
    -- consolidated into the permanent galaxy (a real node) and the mote is removed.
    -- Deliberately SEPARATE from the nodes table so working memory never pollutes
    -- the galaxy until promoted (short-term to long-term consolidation).
    CREATE TABLE IF NOT EXISTS working_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      text TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      strength REAL NOT NULL DEFAULT 0.6,
      reinforce_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      reinforced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS working_memory_space_idx ON working_memory(space_id);
    -- Inquiries (the proactive-intelligence layer): connections Soumaya NOTICES on
    -- her own — a new memory that bridges two people/goals, sits near an existing
    -- anchor, or joins an emerging theme — surfaced as a question for you to answer.
    -- Answering ingests + links, so her noticing literally grows the graph.
    CREATE TABLE IF NOT EXISTS inquiries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      question TEXT NOT NULL,
      kind TEXT NOT NULL,
      node_ids TEXT NOT NULL DEFAULT '[]',
      signature TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS inquiries_space_idx ON inquiries(space_id, status);
    CREATE UNIQUE INDEX IF NOT EXISTS inquiries_sig_idx ON inquiries(space_id, signature);
    -- User-rejected connections: when you tell Soumaya two things DON'T relate, the
    -- pair is recorded here (canonical a<b) so she never re-links or re-asks about it.
    CREATE TABLE IF NOT EXISTS link_rejections (
      space_id TEXT NOT NULL DEFAULT 'legacy',
      a INTEGER NOT NULL,
      b INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (space_id, a, b)
    );
    -- Candidate connections: links Soumaya WITHHELD (below the auto-link confidence bar)
    -- or PRUNED (weak existing links removed to declutter) go here instead of vanishing,
    -- so YOU review each one and choose to connect it yourself or dismiss it. Canonical
    -- a<b; unique per pair so a suggestion never duplicates.
    CREATE TABLE IF NOT EXISTS candidate_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      a INTEGER NOT NULL,
      b INTEGER NOT NULL,
      reason TEXT,
      score REAL NOT NULL DEFAULT 0,
      origin TEXT NOT NULL DEFAULT 'withheld',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS candidate_links_pair_idx ON candidate_links(space_id, a, b);
    CREATE INDEX IF NOT EXISTS candidate_links_status_idx ON candidate_links(space_id, status);
    -- Names you told Soumaya are NOT a person ("not a person" dismiss on a people
    -- suggestion). Keyed by the normalised (lowercased) name so it never resurfaces
    -- as a suggestion again, no matter how often you mention it.
    CREATE TABLE IF NOT EXISTS dismissed_names (
      space_id TEXT NOT NULL DEFAULT 'legacy',
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (space_id, name)
    );
    -- The Chronicle: chapters of your life on the 3D flowing-river timeline. Soumaya
    -- writes one when there's REAL change (~1-3x/month); you can add your own. Each
    -- carries the memories that drove it (photo-bearing preferred) so they can glow as
    -- bubbles on the ribbon. See docs/TIMELINE_DESIGN.md.
    CREATE TABLE IF NOT EXISTS timeline_chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      theme TEXT NOT NULL DEFAULT '',
      trend TEXT NOT NULL DEFAULT 'neutral',
      score REAL NOT NULL DEFAULT 0,
      period_start TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      period_end TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      memory_ids TEXT NOT NULL DEFAULT '[]',
      photo_ids TEXT NOT NULL DEFAULT '[]',
      threads TEXT NOT NULL DEFAULT '[]',
      origin TEXT NOT NULL DEFAULT 'auto',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS timeline_chapters_space_idx ON timeline_chapters(space_id, period_end);

    CREATE TABLE IF NOT EXISTS lenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      name TEXT NOT NULL,
      query TEXT NOT NULL DEFAULT '{}',
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS lenses_space_idx ON lenses(space_id, pinned DESC, id DESC);

    CREATE TABLE IF NOT EXISTS codex_discoveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      key TEXT NOT NULL,
      title TEXT NOT NULL,
      lore TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '✦',
      focus_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS codex_disc_key ON codex_discoveries(space_id, key);

    -- Financial OS (Stage 1a). Money is INTEGER cents. Every table space-scoped.
    CREATE TABLE IF NOT EXISTS fin_account (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      name TEXT NOT NULL DEFAULT 'Cash',
      currency TEXT NOT NULL DEFAULT 'USD',
      balance_cents INTEGER NOT NULL DEFAULT 0,
      buffer_cents INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS fin_account_space_idx ON fin_account(space_id);

    CREATE TABLE IF NOT EXISTS fin_source (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      kind TEXT NOT NULL DEFAULT 'manual',
      blob_ref TEXT,
      mime TEXT,
      extraction_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS fin_source_space_idx ON fin_source(space_id, id DESC);

    CREATE TABLE IF NOT EXISTS fin_income (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      source_id INTEGER,
      date TEXT NOT NULL,
      gross_cents INTEGER,
      net_cents INTEGER NOT NULL DEFAULT 0,
      tax_cents INTEGER,
      hours REAL,
      platform TEXT,
      confidence REAL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS fin_income_space_idx ON fin_income(space_id, date DESC);

    CREATE TABLE IF NOT EXISTS fin_expense (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      source_id INTEGER,
      date TEXT NOT NULL,
      amount_cents INTEGER NOT NULL DEFAULT 0,
      merchant TEXT,
      category TEXT NOT NULL DEFAULT 'misc',
      direction TEXT NOT NULL DEFAULT 'out',
      confidence REAL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS fin_expense_space_idx ON fin_expense(space_id, date DESC);

    CREATE TABLE IF NOT EXISTS fin_bill (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      name TEXT NOT NULL,
      amount_cents INTEGER NOT NULL DEFAULT 0,
      frequency TEXT NOT NULL DEFAULT 'monthly',
      anchor_date TEXT NOT NULL,
      every_days INTEGER,
      autopay INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'bills',
      grace_days INTEGER,
      late_fee_cents INTEGER,
      payee TEXT,
      account_last4 TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS fin_bill_space_idx ON fin_bill(space_id, active);

    CREATE TABLE IF NOT EXISTS fin_bill_occurrence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      bill_id INTEGER NOT NULL,
      due_date TEXT NOT NULL,
      amount_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'upcoming',
      paid_expense_id INTEGER,
      paid_at TEXT
    );
    CREATE INDEX IF NOT EXISTS fin_occ_space_idx ON fin_bill_occurrence(space_id, due_date);
    CREATE UNIQUE INDEX IF NOT EXISTS fin_occ_unique ON fin_bill_occurrence(space_id, bill_id, due_date);

    CREATE TABLE IF NOT EXISTS fin_category_override (
      space_id TEXT NOT NULL DEFAULT 'legacy',
      payee TEXT NOT NULL,
      category TEXT NOT NULL,
      PRIMARY KEY (space_id, payee)
    );

    CREATE TABLE IF NOT EXISTS fin_goal_link (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      node_id INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'savings',
      target_cents INTEGER,
      target_date TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS fin_goal_link_space_idx ON fin_goal_link(space_id);

    -- Wealth (docs/specs/wealth-goals-allocation.md): intention layered on top of Money's
    -- reality. A Bucket owns no money — it's a grouping. A Goal's current amount is always
    -- SUM(fin_allocation.amount_cents) computed on read, never stored here or anywhere else,
    -- so the ledger can never drift from the number it backs. fin_goal_link (above) is
    -- deliberately NOT reused for this — its node_id NOT NULL shape doesn't fit "optional."
    CREATE TABLE IF NOT EXISTS fin_bucket (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'other',
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS fin_bucket_space_idx ON fin_bucket(space_id, archived);

    CREATE TABLE IF NOT EXISTS fin_goal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      bucket_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      target_cents INTEGER,
      target_date TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      -- Life Vision (docs/specs/life-vision.md): optional one-to-many link to the
      -- life_vision node this Goal helps fund. Nullable, no SQL FK (matches bucket_id's
      -- own style here) — validated at the application layer only. Never cascades:
      -- archiving the Vision node does not touch this Goal, and vice versa.
      vision_node_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS fin_goal_space_idx ON fin_goal(space_id, archived);
    CREATE INDEX IF NOT EXISTS fin_goal_bucket_idx ON fin_goal(bucket_id);
    -- fin_goal_vision_idx is created in migrateSchema (db/client.ts), not here: on a
    -- pre-existing volume this CREATE TABLE is a no-op, so an index on vision_node_id
    -- created unconditionally at this point would fail before the column is added.

    CREATE TABLE IF NOT EXISTS fin_allocation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      goal_id INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS fin_allocation_space_idx ON fin_allocation(space_id);
    CREATE INDEX IF NOT EXISTS fin_allocation_goal_idx ON fin_allocation(goal_id);

    -- Pay stubs (docs/specs/paystub-ingestion.md): a richer record than a plain fin_income
    -- row — the itemized extraction + the original document, viewable again later. Always
    -- produces exactly one fin_income row (income_id); no SQL FK (matches this table
    -- family's bucket_id/goal_id convention — application-layer validation only).
    CREATE TABLE IF NOT EXISTS fin_paystub (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      income_id INTEGER,
      employer TEXT,
      pay_date TEXT,
      period_start TEXT,
      period_end TEXT,
      gross_cents INTEGER,
      net_cents INTEGER NOT NULL,
      hours REAL,
      hourly_rate_cents INTEGER,
      earnings_json TEXT,
      deductions_json TEXT,
      ytd_gross_cents INTEGER,
      ytd_net_cents INTEGER,
      source_filename TEXT,
      source_mime TEXT,
      source_data TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS fin_paystub_space_idx ON fin_paystub(space_id, created_at DESC);

    -- Income & Net Worth Growth Trend (docs/specs/income-net-worth-trend.md): a manually
    -- tracked savings/investment/retirement "asset", deliberately separate from fin_account
    -- (the single spendable cash balance, untouched by this feature) and from Wealth's
    -- Buckets/Goals (which never represent a real balance). Archiving preserves history —
    -- a snapshot's contribution to past Net Worth points stays intact after archive.
    CREATE TABLE IF NOT EXISTS fin_asset (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      kind TEXT NOT NULL DEFAULT 'other',
      label TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS fin_asset_space_idx ON fin_asset(space_id, archived);

    CREATE TABLE IF NOT EXISTS fin_asset_snapshot (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      asset_id INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      as_of TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS fin_asset_snapshot_space_idx ON fin_asset_snapshot(space_id, as_of DESC);
    CREATE INDEX IF NOT EXISTS fin_asset_snapshot_asset_idx ON fin_asset_snapshot(asset_id, as_of DESC);

    -- Journeys (Vision 2.0): a life chapter everything can belong to. We LINK, never copy.
    CREATE TABLE IF NOT EXISTS journeys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      color TEXT,
      icon TEXT,
      progress REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS journeys_space_idx ON journeys(space_id, status);

    CREATE TABLE IF NOT EXISTS journey_link (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      journey_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      ref_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS journey_link_space_idx ON journey_link(space_id, journey_id);
    CREATE UNIQUE INDEX IF NOT EXISTS journey_link_unique ON journey_link(space_id, journey_id, kind, ref_id);

    -- Maya Intelligence — clarification lifecycle (docs/specs/maya-intelligence-architecture.md,
    -- Part I2). The ONE piece of intelligence-originated persistence this feature introduces —
    -- explicitly justified: without durable state, "Maya remembers she asked and remembers the
    -- answer" is impossible. Tracks the QUESTION lifecycle only; the actual confirmed knowledge,
    -- once resolved, is a real nodes row (origin='user') linked back via a 'resolves' edge —
    -- never duplicated here. evidence_json is the originating claim's ProvenanceRef[] so a later
    -- answer can be matched back to what was actually asked about.
    CREATE TABLE IF NOT EXISTS intelligence_clarifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      claim_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      question TEXT NOT NULL,
      evidence_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      answer_text TEXT,
      confirmed_statement TEXT,
      confirmed_node_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS intelligence_clarifications_space_idx ON intelligence_clarifications(space_id, status, created_at DESC);

    -- Maya Longitudinal Intelligence, Phase H (docs/specs/maya-longitudinal-intelligence.md,
    -- Section 14) — LEARNED (observed) interaction/communication preferences, deliberately kept
    -- separate from BOTH nodes (a preference is never a fact about the user's life) and
    -- instruction_profiles (which are user-AUTHORED and explicit; these are OBSERVED from
    -- repeated evidence). One row per (space_id, signal): value is the current best-evidenced
    -- reading, confidence/evidence_count grow with repeated CONSISTENT evidence and reset
    -- toward a fresh, weak baseline the moment new evidence conflicts with the stored value —
    -- never an instant flip, never treated as more certain than the evidence supports.
    CREATE TABLE IF NOT EXISTS interaction_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      signal TEXT NOT NULL,
      value TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      evidence_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS interaction_preferences_unique ON interaction_preferences(space_id, signal);
-- INSERT INTO packages/server/src/db/schemaSql.ts BOOTSTRAP_SQL
-- AFTER line 633 (the interaction_preferences_unique index), BEFORE line 634 (the closing `;`).
--
-- W2 episodic memory + user model (wisdom layer). Design doc §3.2, §3.3, §3.7, §3.5, §4.2.
-- Columns, CHECK constraints, defaults, and indexes copied from the design DDL;
-- IF NOT EXISTS added per repo convention (design §8.1 uses it for the migration path).

    -- W2 episodic memory (wisdom layer): immutable episode captures (Tulving-style).
    -- Capture columns are immutable — no UPDATE path exists in code except
    -- applyForgetRequest() (§3.7), which may only write the fixed tombstone
    -- constant under an approved user forget request.
    CREATE TABLE IF NOT EXISTS episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',

      -- What happened (template-generated at capture, NEVER modified after)
      kind TEXT NOT NULL CHECK (kind IN (
        'conversation','agent_action','job_run','digest_sent',
        'proactive_msg','correction','milestone','session'
      )),
      summary TEXT NOT NULL,           -- 1-2 sentence template narrative, first-person as the user

      -- Time (W1 temporal conventions: canonical ISO 8601 UTC)
      occurred_at TEXT NOT NULL,       -- when it happened in the world
      recorded_at TEXT NOT NULL,       -- when the system recorded it (immutable, cf. W1)

      -- Correction linkage (append-only pattern, cf. W1 corrections table)
      corrects_episode_id INTEGER,     -- NULL normally; set when this episode corrects a misrecorded one

      -- Enrichment lifecycle pointer (B6, B2 Rev 3)
      enrichment_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (enrichment_status IN ('pending','processing','completed','failed_retryable','failed_permanent')),
      enrichment_attempts INTEGER NOT NULL DEFAULT 0,
      enrichment_lease TEXT,           -- ISO timestamp: worker claim expiry (NULL = unclaimed)
      enrichment_fence TEXT,           -- fencing token (random hex per claim); stale workers
                                       -- cannot commit after reclaim (B2, Rev 3)
      enriched_at TEXT,                -- when enrichment completed (NULL until completed)

      -- Forget handling (B2, §3.7)
      forgotten_at TEXT,               -- NULL normally; set when a user forget request redacts this episode

      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_episodes_space_time ON episodes(space_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_episodes_kind ON episodes(space_id, kind);
    CREATE INDEX IF NOT EXISTS idx_episodes_corrects ON episodes(corrects_episode_id);
    CREATE INDEX IF NOT EXISTS idx_episodes_enrichment ON episodes(enrichment_status, enrichment_lease)
      WHERE enrichment_status IN ('pending','failed_retryable');

    -- W2: versioned interpretation of an episode. Re-enrichment creates a new
    -- version and supersedes the old — never mutates in place (B1, Rev 3).
    -- References are application-enforced, not SQL FKs (§8.5).
    CREATE TABLE IF NOT EXISTS episode_enrichments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER NOT NULL,     -- application-enforced reference → episodes.id (§8.5)
      space_id TEXT NOT NULL DEFAULT 'legacy',
      version INTEGER NOT NULL,        -- 1, 2, 3... (re-enrichment creates a new version)

      -- Interpretive content (ALL of this is interpretation, not capture)
      detail TEXT,                     -- 2-4 sentences of texture; NULL = not_reported
      emotion TEXT CHECK (emotion IN (
        'anxious','relieved','proud','frustrated','hopeful','overwhelmed',
        'grateful','lonely','determined','ashamed','content','angry',
        'sad','excited','neutral'
      )),                              -- NULL = not_reported (valid, never forced)
      emotional_weight REAL CHECK (emotional_weight IS NULL OR (emotional_weight >= -1 AND emotional_weight <= 1)),
      importance REAL NOT NULL DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),

      -- Structured extraction
      participants TEXT NOT NULL DEFAULT '[]',  -- JSON array, validated shape (§3.8)
      place TEXT,                      -- free text; NULL = not_reported

      -- Provenance: which source records this interpretation was distilled from
      source_node_ids TEXT NOT NULL DEFAULT '[]',  -- JSON array of node ids, validated (§3.8)
      source_transcript_ref TEXT,      -- opaque pointer; NULL if unavailable

      -- Field-level provenance labels (B5, B7 Rev 3) — JSON object mapping field → label.
      -- Labels: 'direct_quote' | 'explicit' | 'inferred' | 'generated' | 'not_reported'.
      field_provenance TEXT NOT NULL DEFAULT '{}',

      -- Retrieval
      embedding BLOB,                  -- sqlite-vec embedding of summary + detail (NULL until computed)

      -- Version lifecycle
      superseded_by INTEGER,           -- application-enforced reference → episode_enrichments.id (newer version); NULL = current (§8.5)
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),

      UNIQUE (episode_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_enrichments_episode ON episode_enrichments(episode_id, version);
    CREATE INDEX IF NOT EXISTS idx_enrichments_current ON episode_enrichments(episode_id) WHERE superseded_by IS NULL;

    -- W2 user model: first-order theory of mind — what the system believes about
    -- the user, with evidence and confidence. Entries supersede (invalid_at +
    -- replaced_by); they are never deleted except under the forget contract (§3.7).
    -- confidence = P(user currently holds this mental state | evidence) — NOT
    -- P(content is objectively true). Truth-tracking is explicitly out of scope.
    CREATE TABLE IF NOT EXISTS user_model (
      id INTEGER PRIMARY KEY AUTOINCREMENT,  -- stable identity (B4)
      space_id TEXT NOT NULL DEFAULT 'legacy',
      slot TEXT NOT NULL CHECK (slot IN (
        'belief','desire','intention','emotion_state','knowledge','constraint'
      )),
      -- One proposition per row (B4, gap 12). Content is a single atomic claim.
      content TEXT NOT NULL,

      -- Confidence semantics (B8): P(user currently holds this mental state | evidence).
      confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),

      -- Evidence quality (B8): computed 0..1 from evidence count, independence, recency.
      evidence_strength REAL NOT NULL DEFAULT 0 CHECK (evidence_strength >= 0 AND evidence_strength <= 1),

      -- JSON array of {type: 'episode'|'node'|'correction'|'enrichment', id: N}.
      -- Validated by validateEvidenceRefs() (§3.8). Non-empty required (INV-EV-1).
      evidence_ids TEXT NOT NULL DEFAULT '[]',

      -- Topic labels (B2, Rev 4): JSON array of controlled topic labels from the
      -- §6.2 vocabulary. '[]' = topic uncertain (read widens rather than narrows).
      topic_labels TEXT NOT NULL DEFAULT '[]',

      valid_at TEXT NOT NULL,          -- when this entry became the model's belief (canonical ISO UTC)
      invalid_at TEXT,                 -- when superseded (NULL = current). Cf. W1 bi-temporal pattern.
      invalid_reason TEXT CHECK (invalid_reason IN (
        'superseded','corrected_false_belief','evidence_withdrawn','expired','user_override',
        'stated_conflict','evidence_forgotten'
      )),
      replaced_by INTEGER,             -- application-enforced reference → user_model.id (the superseding entry); NULL if none (B4, B6 Rev 3; §8.5)

      origin TEXT NOT NULL CHECK (origin IN ('stated','inferred','consolidated')),

      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),

      UNIQUE (space_id, slot, content, valid_at)  -- same belief held at different times = distinct rows
    );
    CREATE INDEX IF NOT EXISTS idx_user_model_current ON user_model(space_id, slot) WHERE invalid_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_user_model_origin ON user_model(space_id, origin);
    CREATE INDEX IF NOT EXISTS idx_user_model_replaced ON user_model(replaced_by);

    -- W2 forget / deletion contract (B2): user-authorized forget requests. An
    -- explicit user request overrides the append-only default; no model-driven
    -- deletion exists anywhere else (INV-DEL-1).
    CREATE TABLE IF NOT EXISTS forget_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL,
      requested_by TEXT NOT NULL DEFAULT 'user' CHECK (requested_by = 'user'),
      -- What to forget: one of these selectors must be set at creation
      target_episode_id INTEGER,       -- specific episode
      target_node_id INTEGER,          -- specific node (propagates to derived records)
      target_query TEXT,               -- free-text description; B4 Rev 4: set to NULL
                                       -- at approval time. Never retained after scope
                                       -- confirmation (content-free audit).
      -- Durable scope representation (B5 Rev 3, B4 Rev 4): resolved at approval time.
      -- Capture-time matching uses these, never re-interprets target_query.
      scope_episode_ids TEXT NOT NULL DEFAULT '[]',  -- JSON array of episode ids in scope
      scope_node_ids TEXT NOT NULL DEFAULT '[]',     -- JSON array of node ids in scope
      -- B4 Rev 4: scope_topics replaces scope_keywords. Controlled topic labels
      -- (same vocabulary as §6.2) — coarse enough to be content-free, specific
      -- enough for capture-time matching.
      scope_topics TEXT NOT NULL DEFAULT '[]',       -- JSON array of controlled topic labels
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','approved','applied','rejected')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      applied_at TEXT
    );

    -- W2 enrichment quota ledger (B4, Rev 3): atomic check-and-increment
    -- reservation for the daily enrichment cap. quota_date is YYYY-MM-DD in the
    -- SPACE's local timezone, computed by spaceLocalDate() — never SQLite
    -- date('now') (B7 Rev 4). space_meta.episode_enrich_daily_cap (default 20)
    -- is the tunable; this ledger is the enforcement mechanism and source of truth.
    CREATE TABLE IF NOT EXISTS enrichment_quota (
      space_id TEXT NOT NULL,
      quota_date TEXT NOT NULL,       -- YYYY-MM-DD in the SPACE's local timezone (B7 Rev 4)
      claimed INTEGER NOT NULL DEFAULT 0 CHECK (claimed >= 0),
      PRIMARY KEY (space_id, quota_date)
    );

    -- W2 episode keyword search: separate FTS5 table over the capture summary +
    -- the current enrichment's detail (same pattern as node FTS). rowid = episode id.
    -- Sync is EXPLICIT (manual upsert/delete from the episode write path —
    -- helpers belong in db/fts.ts mirroring ftsUpsert/ftsDelete; NO triggers,
    -- keeps WAL behavior simple). Redacted (forgotten) episodes are removed
    -- from FTS (§3.7).
    CREATE VIRTUAL TABLE IF NOT EXISTS episodes_fts USING fts5(summary, detail);

    -- W3 consolidation (wisdom layer): nightly sleep/consolidation job state.
    -- Design: docs/wisdom/w3-design.md (Revision 11, §§5.1, 7.2, 8.2–8.6).
    -- Identical DDL runs in db/client.ts migrateSchema() (the W2 pattern:
    -- T-C55 pins bootstrap-vs-migration equivalence). New COLUMNS on existing
    -- tables (space_meta W3 knobs, episodes.lineage_key, user_model.review_flag,
    -- inquiries.contradiction_id) are migrateSchema-only — never added here.
    CREATE TABLE IF NOT EXISTS consolidation_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL,
      window_date TEXT NOT NULL,
      fence TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running','completed','failed','aborted_budget')),
      lease_expires_at TEXT NOT NULL,
      items_processed INTEGER NOT NULL DEFAULT 0,
      llm_calls INTEGER NOT NULL DEFAULT 0,
      contradictions_resolved INTEGER NOT NULL DEFAULT 0,
      consolidations_written INTEGER NOT NULL DEFAULT 0,
      stated_integrity_hash TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE (space_id, window_date)
    );
    CREATE INDEX IF NOT EXISTS idx_consolidation_runs_space
      ON consolidation_runs(space_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS consolidation_episodes (
      space_id TEXT NOT NULL,
      episode_id INTEGER NOT NULL,
      outcome TEXT NOT NULL
        CHECK (outcome IN ('consolidated','strengthened','skipped_covered','skipped_low_importance','abstained',
                           'failed_terminal','failed_retryable')),
      resulting_entry_id INTEGER,
      evidence_group_set TEXT NOT NULL,
      evidence_fingerprint TEXT NOT NULL,
      last_run_id INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (space_id, episode_id)
    );

    CREATE TABLE IF NOT EXISTS contradictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL,
      domain TEXT NOT NULL CHECK (domain IN ('nodes','user_model')),
      old_kind TEXT NOT NULL CHECK (old_kind IN ('node','user_model_entry')),
      old_id INTEGER NOT NULL,
      new_kind TEXT NOT NULL CHECK (new_kind IN ('node','user_model_entry','episode')),
      new_id INTEGER NOT NULL,
      category TEXT NOT NULL
        CHECK (category IN ('factual_update','false_belief','preference_change','state_transition','duplicate_claim')),
      reported_by TEXT NOT NULL CHECK (reported_by IN ('temporal_propose','knowledge_check','consolidation','sweep','user','reconciliation')),
      report_ref TEXT,
      reopens_id INTEGER,
      state TEXT NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending','claimed','resolved','unresolved','moot','stated_conflict')),
      attempts INTEGER NOT NULL DEFAULT 0,
      claimed_by_run INTEGER,
      claim_fence TEXT,
      lease_expires_at TEXT,
      resolution TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      resolved_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contradictions_pair
      ON contradictions(space_id, domain, old_kind, old_id, new_kind, new_id)
      WHERE state IN ('pending','claimed');
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contradictions_pair_ref
      ON contradictions(space_id, domain, old_kind, old_id, new_kind, new_id, report_ref);

    CREATE TABLE IF NOT EXISTS access_stats (
      entity_type TEXT NOT NULL CHECK (entity_type IN ('episode','user_model_entry','node')),
      entity_id INTEGER NOT NULL,
      last_accessed_at TEXT NOT NULL,
      access_count INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (entity_type, entity_id)
    );

    CREATE TABLE IF NOT EXISTS w3_recon_progress (
      space_id TEXT PRIMARY KEY,
      cursor_valid_at TEXT,
      cursor_id INTEGER,
      partial_valid_at TEXT,
      partial_id INTEGER,
      partial_stated_overlap REAL,
      partial_stated_id INTEGER,
      partial_stated_version INTEGER,
      last_pass_completed_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS w3_recon_semantic_queue (
      space_id TEXT NOT NULL,
      consolidated_id INTEGER NOT NULL,
      stated_id INTEGER NOT NULL,
      similarity REAL NOT NULL,
      queued_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (space_id, consolidated_id, stated_id)
    );
`;
