-- Remove non-main wallets and their ledger entries
DELETE FROM public.ledger_entries WHERE wallet_id IN (SELECT id FROM public.wallets WHERE type <> 'main');
DELETE FROM public.wallets WHERE type <> 'main';

-- Restrict wallet type to 'main' only
ALTER TABLE public.wallets DROP CONSTRAINT IF EXISTS wallets_type_check;
ALTER TABLE public.wallets ADD CONSTRAINT wallets_type_check CHECK (type = 'main');

-- Deposits table tracks ClickPesa USSD push orders
CREATE TABLE public.deposits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_reference TEXT NOT NULL UNIQUE,
  payer_name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  amount_tzs NUMERIC NOT NULL CHECK (amount_tzs > 0),
  amount_usd NUMERIC NOT NULL CHECK (amount_usd > 0),
  fx_rate NUMERIC NOT NULL,
  channel TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  clickpesa_payment_id TEXT,
  raw_webhook JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  credited_at TIMESTAMP WITH TIME ZONE
);

GRANT SELECT, INSERT, UPDATE ON public.deposits TO authenticated;
GRANT ALL ON public.deposits TO service_role;

ALTER TABLE public.deposits ENABLE ROW LEVEL SECURITY;

CREATE POLICY deposits_self_select ON public.deposits FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY deposits_self_insert ON public.deposits FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE INDEX deposits_user_idx ON public.deposits(user_id, created_at DESC);
CREATE INDEX deposits_order_ref_idx ON public.deposits(order_reference);

CREATE OR REPLACE FUNCTION public.touch_deposits_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER deposits_touch BEFORE UPDATE ON public.deposits
  FOR EACH ROW EXECUTE FUNCTION public.touch_deposits_updated_at();