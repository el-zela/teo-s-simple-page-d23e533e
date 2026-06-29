
REVOKE EXECUTE ON FUNCTION public.execute_trade(UUID,TEXT,TEXT,NUMERIC,NUMERIC,TEXT,NUMERIC,NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.close_trade(UUID,NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_ledger_to_wallet() FROM PUBLIC, anon, authenticated;
