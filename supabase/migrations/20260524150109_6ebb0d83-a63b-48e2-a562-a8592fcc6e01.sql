-- Revoke execute on trigger/helper functions from public roles
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_profile() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.execute_trade(uuid, text, text, numeric, numeric, text, numeric, numeric) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.close_trade(uuid, numeric) FROM anon, authenticated;