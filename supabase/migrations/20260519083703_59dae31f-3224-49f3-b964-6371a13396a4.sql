
-- =====================================================
-- TIER 0: WALLET LOCKDOWN + DOUBLE-ENTRY LEDGER
-- =====================================================

-- 1. Trade lifecycle fields
ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS stop_loss numeric,
  ADD COLUMN IF NOT EXISTS take_profit numeric,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS close_price numeric,
  ADD COLUMN IF NOT EXISTS pnl_realized numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS trades_idempotency_key_uniq
  ON public.trades(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 2. Signal audit fields
ALTER TABLE public.signals
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS target_price numeric,
  ADD COLUMN IF NOT EXISTS stop_price numeric,
  ADD COLUMN IF NOT EXISTS horizon_minutes int,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE TABLE IF NOT EXISTS public.signal_outcomes (
  signal_id uuid PRIMARY KEY REFERENCES public.signals(id) ON DELETE CASCADE,
  hit_target boolean,
  hit_stop boolean,
  realized_pnl numeric,
  evaluated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.signal_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "signal_outcomes readable by authenticated"
  ON public.signal_outcomes FOR SELECT TO authenticated USING (true);

-- 3. Double-entry ledger
CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
  trade_id uuid REFERENCES public.trades(id) ON DELETE SET NULL,
  ref_type text NOT NULL,
  ref_id text,
  direction text NOT NULL CHECK (direction IN ('debit','credit')),
  amount numeric(20,8) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'USD',
  memo text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ledger_idempotency_uniq
  ON public.ledger_entries(ref_type, ref_id)
  WHERE ref_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ledger_user_created_idx
  ON public.ledger_entries(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ledger_wallet_idx
  ON public.ledger_entries(wallet_id);

ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own ledger select"
  ON public.ledger_entries FOR SELECT
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policies => only service_role can write.

-- 4. Ledger -> wallet balance trigger (immutability + auto-apply)
CREATE OR REPLACE FUNCTION public.apply_ledger_to_wallet()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'UPDATE' OR TG_OP = 'DELETE') THEN
    RAISE EXCEPTION 'ledger_entries are immutable';
  END IF;
  IF NEW.direction = 'credit' THEN
    UPDATE public.wallets SET balance = balance + NEW.amount WHERE id = NEW.wallet_id;
  ELSE
    UPDATE public.wallets SET balance = balance - NEW.amount WHERE id = NEW.wallet_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ledger_apply_balance ON public.ledger_entries;
CREATE TRIGGER ledger_apply_balance
  AFTER INSERT ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.apply_ledger_to_wallet();

DROP TRIGGER IF EXISTS ledger_immutable ON public.ledger_entries;
CREATE TRIGGER ledger_immutable
  BEFORE UPDATE OR DELETE ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.apply_ledger_to_wallet();

-- 5. LOCK DOWN wallet writes — remove client UPDATE policy
DROP POLICY IF EXISTS "own wallets update" ON public.wallets;

-- 6. LOCK DOWN trade writes — remove client INSERT/UPDATE policies
DROP POLICY IF EXISTS "own trades insert" ON public.trades;
DROP POLICY IF EXISTS "own trades update" ON public.trades;

-- 7. Atomic execute_trade RPC
CREATE OR REPLACE FUNCTION public.execute_trade(
  p_user_id uuid,
  p_symbol text,
  p_side trade_side,
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
  v_existing uuid;
  v_main_id uuid;
  v_trading_id uuid;
  v_main_balance numeric;
  v_cost numeric;
BEGIN
  IF p_qty <= 0 OR p_price <= 0 THEN
    RAISE EXCEPTION 'invalid_qty_or_price';
  END IF;

  -- Idempotency check
  SELECT id INTO v_existing FROM public.trades
    WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  v_cost := p_qty * p_price;

  -- Lock the two wallets
  SELECT id, balance INTO v_main_id, v_main_balance
    FROM public.wallets
    WHERE user_id = p_user_id AND type = 'main'
    FOR UPDATE;

  SELECT id INTO v_trading_id
    FROM public.wallets
    WHERE user_id = p_user_id AND type = 'trading'
    FOR UPDATE;

  IF v_main_id IS NULL OR v_trading_id IS NULL THEN
    RAISE EXCEPTION 'wallets_not_found';
  END IF;

  IF p_side = 'buy' AND v_main_balance < v_cost THEN
    RAISE EXCEPTION 'insufficient_funds';
  END IF;

  INSERT INTO public.trades (user_id, symbol, side, qty, price, status, idempotency_key, stop_loss, take_profit)
    VALUES (p_user_id, p_symbol, p_side, p_qty, p_price, 'open', p_idempotency_key, p_stop_loss, p_take_profit)
    RETURNING id INTO v_trade_id;

  IF p_side = 'buy' THEN
    -- Debit main, credit trading
    INSERT INTO public.ledger_entries (user_id, wallet_id, trade_id, ref_type, ref_id, direction, amount, memo)
      VALUES (p_user_id, v_main_id, v_trade_id, 'trade_open_debit', v_trade_id::text, 'debit', v_cost, p_symbol || ' buy');
    INSERT INTO public.ledger_entries (user_id, wallet_id, trade_id, ref_type, ref_id, direction, amount, memo)
      VALUES (p_user_id, v_trading_id, v_trade_id, 'trade_open_credit', v_trade_id::text, 'credit', v_cost, p_symbol || ' buy');
  ELSE
    -- Sell: move from trading back to main (treat as closing exposure on demo)
    INSERT INTO public.ledger_entries (user_id, wallet_id, trade_id, ref_type, ref_id, direction, amount, memo)
      VALUES (p_user_id, v_trading_id, v_trade_id, 'trade_open_debit', v_trade_id::text, 'debit', v_cost, p_symbol || ' sell');
    INSERT INTO public.ledger_entries (user_id, wallet_id, trade_id, ref_type, ref_id, direction, amount, memo)
      VALUES (p_user_id, v_main_id, v_trade_id, 'trade_open_credit', v_trade_id::text, 'credit', v_cost, p_symbol || ' sell');
  END IF;

  RETURN v_trade_id;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_trade(uuid, text, trade_side, numeric, numeric, text, numeric, numeric) FROM public;
