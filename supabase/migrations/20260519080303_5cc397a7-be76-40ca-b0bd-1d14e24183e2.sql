
-- profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  country text,
  language text default 'en',
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "own profile select" on public.profiles for select using (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id);
create policy "own profile insert" on public.profiles for insert with check (auth.uid() = id);

-- wallets
create type public.wallet_type as enum ('main','trading','reward','affiliate');
create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type public.wallet_type not null,
  balance numeric(20,2) not null default 0,
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  unique (user_id, type)
);
alter table public.wallets enable row level security;
create policy "own wallets select" on public.wallets for select using (auth.uid() = user_id);
create policy "own wallets update" on public.wallets for update using (auth.uid() = user_id);

-- trades
create type public.trade_side as enum ('buy','sell');
create type public.trade_status as enum ('open','closed','cancelled');
create table public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  side public.trade_side not null,
  qty numeric(20,8) not null,
  price numeric(20,8) not null,
  status public.trade_status not null default 'open',
  pnl numeric(20,2) not null default 0,
  created_at timestamptz not null default now()
);
alter table public.trades enable row level security;
create policy "own trades select" on public.trades for select using (auth.uid() = user_id);
create policy "own trades insert" on public.trades for insert with check (auth.uid() = user_id);
create policy "own trades update" on public.trades for update using (auth.uid() = user_id);

-- signals
create type public.signal_action as enum ('buy','sell','hold');
create table public.signals (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  action public.signal_action not null,
  confidence numeric(5,2) not null,
  rationale text,
  created_at timestamptz not null default now()
);
alter table public.signals enable row level security;
create policy "signals readable by authenticated" on public.signals for select to authenticated using (true);

-- seed signals
insert into public.signals (symbol, action, confidence, rationale) values
  ('BTC/USD','buy',82.40,'Momentum + bullish RSI divergence on 4H; sentiment positive.'),
  ('ETH/USD','hold',61.10,'Range-bound between key MAs; await breakout confirmation.'),
  ('EUR/USD','sell',74.20,'ECB dovish bias vs strong USD CPI print; downside extension likely.'),
  ('XAU/USD','buy',88.05,'Safe-haven flows + falling real yields; structure remains bullish.'),
  ('SOL/USD','buy',79.30,'Strong on-chain volume; breakout from accumulation base.'),
  ('GBP/JPY','sell',68.50,'BoJ intervention risk elevated near multi-year highs.');

-- handle_new_user trigger: create profile + 4 wallets
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  insert into public.wallets (user_id, type, balance) values
    (new.id, 'main', 10000),
    (new.id, 'trading', 0),
    (new.id, 'reward', 0),
    (new.id, 'affiliate', 0);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
