
CREATE TABLE public.signal_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  signal_id uuid NOT NULL REFERENCES public.signals(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, signal_id)
);

CREATE INDEX idx_signal_redemptions_user_time ON public.signal_redemptions(user_id, created_at DESC);

ALTER TABLE public.signal_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own redemptions"
  ON public.signal_redemptions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users create own redemptions"
  ON public.signal_redemptions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());
