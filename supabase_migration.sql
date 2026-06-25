-- VSG AI Command Centre — Supabase Migration
-- Run this in your Supabase SQL editor: https://supabase.com/dashboard/project/mkqbegnqrgveiygrycyg/sql

-- Company signals (trigger events: funding, hiring, IPO, leadership change)
CREATE TABLE IF NOT EXISTS company_signals (
  id bigserial PRIMARY KEY,
  company_name text NOT NULL,
  signal_type text NOT NULL,  -- 'funding', 'hiring', 'news', 'leadership_change', 'ipo', 'expansion'
  title text NOT NULL,
  summary text,
  source_url text,
  importance text DEFAULT 'medium',  -- 'high', 'medium', 'low'
  actioned boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Agent outputs (all scheduled task results write here)
CREATE TABLE IF NOT EXISTS agent_outputs (
  id bigserial PRIMARY KEY,
  agent_type text NOT NULL,  -- 'reply_detection', 'signal_monitor', 'prospecting', 'daily_briefing'
  title text NOT NULL,
  summary text,
  data jsonb,
  action_required boolean DEFAULT false,
  actioned boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Outreach log (LinkedIn messages sent and replies)
CREATE TABLE IF NOT EXISTS outreach_log (
  id bigserial PRIMARY KEY,
  contact_name text NOT NULL,
  contact_id bigint,
  linkedin_url text,
  message_sent text,
  sent_at timestamptz,
  reply_text text,
  reply_at timestamptz,
  status text DEFAULT 'sent',  -- 'sent', 'replied_positive', 'replied_neutral', 'replied_negative', 'no_reply'
  suggested_response text,
  response_approved boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Prospects queue (auto-discovered by agent, awaiting review)
CREATE TABLE IF NOT EXISTS prospects_queue (
  id bigserial PRIMARY KEY,
  full_name text NOT NULL,
  title text,
  company text,
  linkedin_url text,
  email text,
  source text DEFAULT 'agent',
  draft_message text,
  status text DEFAULT 'pending',  -- 'pending', 'approved', 'added', 'rejected'
  score int DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Sequences (multi-touch outreach sequences)
CREATE TABLE IF NOT EXISTS sequences (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  description text,
  steps jsonb,  -- [{day: 0, type: 'linkedin', template: '...'}, ...]
  active boolean DEFAULT true,
  contact_count int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Sequence enrollments
CREATE TABLE IF NOT EXISTS sequence_enrollments (
  id bigserial PRIMARY KEY,
  sequence_id bigint REFERENCES sequences(id) ON DELETE CASCADE,
  contact_id bigint,
  contact_name text,
  current_step int DEFAULT 0,
  status text DEFAULT 'active',  -- 'active', 'completed', 'paused', 'replied'
  enrolled_at timestamptz DEFAULT now(),
  next_action_at timestamptz,
  last_actioned_at timestamptz
);

-- AI Chat history (per contact)
CREATE TABLE IF NOT EXISTS chat_history (
  id bigserial PRIMARY KEY,
  contact_id bigint NOT NULL,
  role text NOT NULL,  -- 'user', 'assistant'
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- BD scores (AI-generated opportunity scores)
CREATE TABLE IF NOT EXISTS bd_scores (
  id bigserial PRIMARY KEY,
  contact_id bigint NOT NULL,
  score int DEFAULT 0,  -- 0-100
  factors jsonb,
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS with open policies (single-user tool)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['company_signals','agent_outputs','outreach_log','prospects_queue','sequences','sequence_enrollments','chat_history','bd_scores']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Allow all" ON %I', t);
    EXECUTE format('CREATE POLICY "Allow all" ON %I FOR ALL USING (true) WITH CHECK (true)', t);
  END LOOP;
END$$;

-- Seed a welcome agent output so the feed isn't empty
INSERT INTO agent_outputs (agent_type, title, summary, action_required)
VALUES ('daily_briefing', 'AI Command Centre is live', 'Your BD intelligence platform is ready. Scheduled agents will populate this feed with signals, replies and new prospects automatically.', false)
ON CONFLICT DO NOTHING;
