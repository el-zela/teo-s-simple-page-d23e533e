
-- Enable scheduled jobs and outbound HTTP
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Close an open trade (idempotent). Writes ledger entries for realized PnL
-- and moves funds back from trading -> main wallet.
CREATE OR REPLACE FUNCTION public.close_trade(
  p_trade_id uuid,
  p_close_price numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trade public.trades%ROWTYPE;
  v_main_id uuid;
  v_trading_id uuid;
  v_notional numeric;
  v_pnl numeric;
  v_payout numeric;
BEGIN
  SELECT * INTO v_trade FROM public.trades WHERE id = p_trade_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'trade_not_found'; END IF;
  IF v_trade.status <> 'open' THEN RETURN v_trade.id; END IF;
  IF p_close_price <= 0 THEN RAISE EXCEPTION 'invalid_close_price'; END IF;

  v_notional := v_trade.qty * v_trade.price;

  IF v_trade.side = 'buy' THEN
    v_pnl := (p_close_price - v_trade.price) * v_trade.qty;
  ELSE
    v_pnl := (v_trade.price - p_close_price) * v_trade.qty;
  END IF;
  v_payout := v_notional + v_pnl;
  IF v_payout < 0 THEN v_payout := 0; END IF;

  SELECT id INTO v_main_id FROM public.wallets
    WHERE user_id = v_trade.user_id AND type = 'main' FOR UPDATE;
  SELECT id INTO v_trading_id FROM public.wallets
    WHERE user_id = v_trade.user_id AND type = 'trading' FOR UPDATE;

  -- Debit trading wallet the original notional, credit main wallet the payout
  INSERT INTO public.ledger_entries (user_id, wallet_id, trade_id, ref_type, ref_id, direction, amount, memo)
    VALUES (v_trade.user_id, v_trading_id, v_trade.id, 'trade_close_debit', v_trade.id::text, 'debit', v_notional, v_trade.symbol || ' close');
  INSERT INTO public.ledger_entries (user_id, wallet_id, trade_id, ref_type, ref_id, direction, amount, memo)
    VALUES (v_trade.user_id, v_main_id, v_trade.id, 'trade_close_credit', v_trade.id::text, 'credit', v_payout, v_trade.symbol || ' payout');

  UPDATE public.trades
    SET status = 'closed', close_price = p_close_price, closed_at = now(), pnl_realized = v_pnl, pnl = v_pnl
    WHERE id = v_trade.id;

  RETURN v_trade.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.close_trade(uuid, numeric) FROM anon, authenticated, public;

-- Schedule signal producer every 5 minutes
SELECT cron.schedule(
  'nexus-ai-signals',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--1041bd17-b7d5-4d8f-bfe1-ecec5d1a57f8.lovable.app/api/public/cron/signals',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqbmhqc3dvcnZkdmdqd2RydGlnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxNTU3MTksImV4cCI6MjA5NDczMTcxOX0.7kq3x2COoc_LhRLuCCD1A_zvNI_TCYPONDbrURjXL60'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Schedule SL/TP worker every minute
SELECT cron.schedule(
  'nexus-sl-tp-worker',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--1041bd17-b7d5-4d8f-bfe1-ecec5d1a57f8.lovable.app/api/public/cron/sl-tp',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqbmhqc3dvcnZkdmdqd2RydGlnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxNTU3MTksImV4cCI6MjA5NDczMTcxOX0.7kq3x2COoc_LhRLuCCD1A_zvNI_TCYPONDbrURjXL60'
    ),
    body := '{}'::jsonb
  );
  $$
);
