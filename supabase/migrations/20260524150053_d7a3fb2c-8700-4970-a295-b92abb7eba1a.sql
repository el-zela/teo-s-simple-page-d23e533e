-- ============================================================
-- Nexus AI Trading App — Initial Schema
-- ============================================================

-- 1) profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

-- 2) wallets
CREATE TABLE IF NOT EXISTS public.wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('main','trading','reward','affiliate')),
  balance numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, type)
);

-- 3) ledger_entries
CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  ref_type text NOT NULL CHECK (ref_type IN ('deposit','withdrawal','transfer_in','transfer_out','trade')),
  ref_id text,
  direction text NOT NULL CHECK (direction IN ('credit','debit')),
  amount numeric NOT NULL CHECK (amount >=  0),
  currency text NOT NULL DEFAULT 'USD',
  memo text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4) trades
CREATE TABLE IF NOT EXISTS public.trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  side text NOT NULL CHECK (side IN ('buy','sell')),
  qty numeric NOT NULL CHECK (qty > 0),
  price numeric NOT NULL CHECK (price >  1),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  stop_loss numeric,
  take_profit numeric,
  pnl_realized numeric NOT NULL DEFAULT 0,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

-- 5) signals
CREATE TABLE IF NOT EXISTS public.signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  action text NOT NULL CHECK (action IN ('buy','sell','hold')),
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  rationale text,
  target_price numeric,
  stop_price numeric,
  horizon_minutes numeric,
  model text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Triggers
-- ============================================================

-- Auto-create profile on new user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Auto-create default wallets on new profile
CREATE OR REPLACE FUNCTION public.handle_new_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.wallets (user_id, type, balance, currency)
  VALUES
    (NEW.user_id, 'main', 10000, 'USD'),
    (NEW.user_id, 'trading', 0, 'USD'),
    (NEW.user_id, 'reward', 0, 'USD'),
    (NEW.user_id, 'affiliate', 0, 'USD')
  ON CONFLICT (user_id, type) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_created ON public.profiles;
CREATE TRIGGER on_profile_created
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_profile();

-- ============================================================
-- RPC: execute_trade
-- ============================================================
CREATE OR REPLACE FUNCTION public.execute_trade(
  p_user_id uuid,
  p_symbol text,
  p_side text,
  p_qty numeric,
  p_price numeric,
  p_idempotency_key text,
  p_stop_loss numeric DEFAULT NULL,
  p_take_profit numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trade_id uuid;
  v_wallet_id uuid;
  v_cost numeric;
  v_existing uuid;
BEGIN
  -- Idempotency check
  SELECT id INTO v_existing FROM public.trades WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Calculate cost in USD (qty * price)
  v_cost := p_qty * p_price;

  -- Find trading wallet
  SELECT id INTO v_wallet_id FROM public.wallets
  WHERE user_id = p_user_id AND type = 'trading';

  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Trading wallet not found';
  END IF;

  -- Check balance
  IF (SELECT balance FROM public.wallets WHERE id = v_wallet_id) < v_cost THEN
    RAISE EXCEPTION 'insufficient_funds';
  END IF;

  -- Deduct from trading wallet
  UPDATE public.wallets SET balance = balance - v_cost WHERE id = v_wallet_id;

  -- Create trade record
  INSERT INTO public.trades (
    user_id, symbol, side, qty, price, status,
    stop_loss, take_profit, idempotency_key
  ) VALUES (
    p_user_id, p_symbol, p_side, p_qty, p_price, 'open',
    p_stop_loss, p_take_profit, p_idempotency_key
  )
  RETURNING id INTO v_trade_id;

  -- Record ledger entry
  INSERT INTO public.ledger_entries (
    user_id, wallet_id, ref_type, ref_id, direction, amount, currency, memo
  ) VALUES (
    p_user_id, v_wallet_id, 'trade', v_trade_id::text, 'debit', v_cost, 'USD',
    p_side || ' ' || p_qty || ' ' || p_symbol || ' @ $' || p_price
  );

  RETURN v_trade_id;
END;
$$;

-- ============================================================
-- RPC: close_trade
-- ============================================================
CREATE OR REPLACE FUNCTION public.close_trade(
  p_trade_id uuid,
  p_close_price numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trade public.trades%ROWTYPE;
  v_wallet_id uuid;
  v_pnl numeric;
  v_value numeric;
BEGIN
  SELECT * INTO v_trade FROM public.trades WHERE id = p_trade_id AND status = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trade not found or already closed';
  END IF;

  -- Find trading wallet
  SELECT id INTO v_wallet_id FROM public.wallets
  WHERE user_id = v_trade.user_id AND type = 'trading';

  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Trading wallet not found';
  END IF;

  -- Calculate PnL
  v_value := v_trade.qty * p_close_price;
  IF v_trade.side = 'buy' THEN
    v_pnl := v_value - (v_trade.qty * v_trade.price);
  ELSE
    v_pnl := (v_trade.qty * v_trade.price) - v_value;
  END IF;

  -- Update trade
  UPDATE public.trades SET
    status = 'closed',
    closed_at = now(),
    pnl_realized = v_pnl
  WHERE id = p_trade_id;

  -- Credit wallet with position value + any PnL (the original cost was already deducted)
  -- Actually we deducted the cost when opening, so we need to credit back the close value
  UPDATE public.wallets SET balance = balance + v_value WHERE id = v_wallet_id;

  -- Record ledger entry for the close
  INSERT INTO public.ledger_entries (
    user_id, wallet_id, ref_type, ref_id, direction, amount, currency, memo
  ) VALUES (
    v_trade.user_id, v_wallet_id, 'trade', p_trade_id::text, 'credit', v_value, 'USD',
    'Close ' || v_trade.side || ' ' || v_trade.qty || ' ' || v_trade.symbol || ' @ $' || p_close_price || ' PnL $' || round(v_pnl, 2)
  );
END;
$$;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;

-- profiles: users see own
CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- wallets: users see own
CREATE POLICY "Users can read own wallets"
  ON public.wallets FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- ledger_entries: users see own
CREATE POLICY "Users can read own ledger"
  ON public.ledger_entries FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- trades: users see own
CREATE POLICY "Users can read own trades"
  ON public.trades FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- signals: public read
CREATE POLICY "Signals are public"
  ON public.signals FOR SELECT
  TO anon, authenticated
  USING (true);

-- Allow admin/service role inserts (bypassed by service role anyway)
-- trades: no direct insert by users (via RPC only)
CREATE POLICY "Users can read all trades for leaderboard"
  ON public.trades FOR SELECT
  TO authenticated
  USING (true);

-- profiles public read for leaderboard
CREATE POLICY "Profiles public read"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

-- wallets public read for leaderboard
CREATE POLICY "Wallets public read"
  ON public.wallets FOR SELECT
  TO authenticated
  USING (true);
