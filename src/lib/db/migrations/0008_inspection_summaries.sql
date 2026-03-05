-- Inspection summary pages: public tokenized URLs for customer-facing inspection summaries.
-- Each summary links to an inspection and carries manually-entered recommendations.
-- Tokens are 21-char nanoid strings (URL-safe, ~124 bits of entropy).
-- Default expiration is 90 days from creation.

CREATE TABLE inspection_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  token VARCHAR(32) NOT NULL UNIQUE,
  recommendations TEXT NOT NULL,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Index for fast token lookups on the public route
CREATE INDEX idx_inspection_summaries_token ON inspection_summaries(token);
