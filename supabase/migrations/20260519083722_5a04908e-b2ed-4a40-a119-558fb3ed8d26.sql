
REVOKE ALL ON FUNCTION public.execute_trade(uuid, text, trade_side, numeric, numeric, text, numeric, numeric) FROM anon, authenticated, public;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE ALL ON FUNCTION public.apply_ledger_to_wallet() FROM anon, authenticated, public;
