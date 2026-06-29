
-- PROFILES
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_self_select" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_self_modify" ON public.profiles FOR ALL TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- WALLETS
CREATE TABLE public.wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('main','trading','reward','affiliate')),
  balance NUMERIC(20,4) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, type)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wallets TO authenticated;
GRANT ALL ON public.wallets TO service_role;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wallets_self" ON public.wallets FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- LEDGER
CREATE TABLE public.ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  ref_type TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('credit','debit')),
  amount NUMERIC(20,4) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, ref_type, ref_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ledger_entries TO authenticated;
GRANT ALL ON public.ledger_entries TO service_role;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ledger_self" ON public.ledger_entries FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.apply_ledger_to_wallet()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.direction = 'credit' THEN
    UPDATE public.wallets SET balance = balance + NEW.amount WHERE id = NEW.wallet_id;
  ELSE
    UPDATE public.wallets SET balance = balance - NEW.amount WHERE id = NEW.wallet_id;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER ledger_apply AFTER INSERT ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.apply_ledger_to_wallet();

-- TRADES
CREATE TABLE public.trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy','sell')),
  qty NUMERIC(20,4) NOT NULL,
  price NUMERIC(20,8) NOT NULL,
  stop_loss NUMERIC(20,8),
  take_profit NUMERIC(20,8),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  close_price NUMERIC(20,8),
  pnl_realized NUMERIC(20,4) NOT NULL DEFAULT 0,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  UNIQUE(user_id, idempotency_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trades TO authenticated;
GRANT ALL ON public.trades TO service_role;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trades_self" ON public.trades FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- SIGNALS
CREATE TABLE public.signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('buy','sell','hold')),
  confidence NUMERIC(5,2) NOT NULL,
  rationale TEXT NOT NULL,
  target_price NUMERIC(20,8) NOT NULL,
  stop_price NUMERIC(20,8) NOT NULL,
  horizon_minutes INT NOT NULL,
  model TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.signals TO anon, authenticated;
GRANT ALL ON public.signals TO service_role;
ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "signals_read_all" ON public.signals FOR SELECT TO anon, authenticated USING (true);

-- REDEMPTIONS
CREATE TABLE public.signal_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signal_id UUID NOT NULL REFERENCES public.signals(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, signal_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signal_redemptions TO authenticated;
GRANT ALL ON public.signal_redemptions TO service_role;
ALTER TABLE public.signal_redemptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "redemptions_self" ON public.signal_redemptions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- RPC: execute_trade
CREATE OR REPLACE FUNCTION public.execute_trade(
  p_user_id UUID,
  p_symbol TEXT,
  p_side TEXT,
  p_qty NUMERIC,
  p_price NUMERIC,
  p_idempotency_key TEXT,
  p_stop_loss NUMERIC DEFAULT NULL,
  p_take_profit NUMERIC DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing UUID;
  v_id UUID;
BEGIN
  SELECT id INTO v_existing FROM public.trades
    WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  INSERT INTO public.trades (user_id, symbol, side, qty, price, stop_loss, take_profit, idempotency_key)
    VALUES (p_user_id, p_symbol, p_side, p_qty, p_price, p_stop_loss, p_take_profit, p_idempotency_key)
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.execute_trade(UUID,TEXT,TEXT,NUMERIC,NUMERIC,TEXT,NUMERIC,NUMERIC) TO authenticated, service_role;

-- RPC: close_trade
CREATE OR REPLACE FUNCTION public.close_trade(
  p_trade_id UUID,
  p_close_price NUMERIC
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.trades%ROWTYPE;
  v_pnl NUMERIC;
BEGIN
  SELECT * INTO t FROM public.trades WHERE id = p_trade_id AND status = 'open';
  IF NOT FOUND THEN RETURN; END IF;
  IF t.side = 'buy' THEN
    v_pnl := (p_close_price - t.price) * t.qty;
  ELSE
    v_pnl := (t.price - p_close_price) * t.qty;
  END IF;
  UPDATE public.trades
    SET status = 'closed', close_price = p_close_price, pnl_realized = v_pnl, closed_at = now()
    WHERE id = p_trade_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.close_trade(UUID,NUMERIC) TO authenticated, service_role;
