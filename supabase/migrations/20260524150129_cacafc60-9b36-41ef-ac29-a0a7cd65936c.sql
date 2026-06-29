-- Revoke execute from PUBLIC (required since PostgreSQL grants execute to PUBLIC by default)
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_profile() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.execute_trade(uuid, text, text, numeric, numeric, text, numeric, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.close_trade(uuid, numeric) FROM PUBLIC;

-- Also ensure no direct access from anon/authenticated
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_profile() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.execute_trade(uuid, text, text, numeric, numeric, text, numeric, numeric) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.close_trade(uuid, numeric) FROM anon, authenticated;