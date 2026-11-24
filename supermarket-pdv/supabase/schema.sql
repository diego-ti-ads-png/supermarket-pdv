-- Execute no SQL Editor do projeto Supabase.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role text not null default 'Vendedor'
    check (role in ('Diretor','Gerente','Estoquista','Vendedor','Administrativo')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text unique,
  name text not null,
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  cost_price numeric(12,2) not null check (cost_price > 0),
  sale_price numeric(12,2) not null check (sale_price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  customer_name text,
  payment_method text not null check (payment_method in ('dinheiro','pix','credito','debito','prazo')),
  total numeric(12,2) not null check (total >= 0),
  created_at timestamptz not null default now()
);
create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid not null references public.products(id),
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null,
  subtotal numeric(12,2) not null
);
create table if not exists public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('entrada','saida')),
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  due_date date,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

-- A venda e a baixa de estoque são atômicas: ou tudo é gravado, ou nada.
create or replace function public.create_sale(
  p_items jsonb, p_payment_method text, p_customer_name text, p_user_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_sale_id uuid := gen_random_uuid();
  v_total numeric(12,2) := 0;
  v_item jsonb;
  v_product products%rowtype;
  v_qty integer;
  v_subtotal numeric(12,2);
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ITENS_INVALIDOS';
  end if;
  insert into sales(id,user_id,customer_name,payment_method,total)
  values(v_sale_id,p_user_id,p_customer_name,p_payment_method,0);

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::integer;
    if v_qty <= 0 then raise exception 'QUANTIDADE_INVALIDA'; end if;
    select * into v_product from products
      where id = (v_item->>'product_id')::uuid for update;
    if not found then raise exception 'PRODUTO_NAO_ENCONTRADO'; end if;
    if v_product.stock_quantity < v_qty then raise exception 'ESTOQUE_INSUFICIENTE'; end if;
    v_subtotal := v_product.sale_price * v_qty;
    update products set stock_quantity = stock_quantity - v_qty, updated_at = now()
      where id = v_product.id;
    insert into sale_items(sale_id,product_id,product_name,quantity,unit_price,subtotal)
      values(v_sale_id,v_product.id,v_product.name,v_qty,v_product.sale_price,v_subtotal);
    v_total := v_total + v_subtotal;
  end loop;
  update sales set total = v_total where id = v_sale_id;
  return jsonb_build_object('sale_id',v_sale_id,'total',v_total,'created_at',now());
end; $$;

-- O backend usa a service_role; bloqueie acesso direto do navegador às tabelas.
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.finance_entries enable row level security;

-- Sem policies para anon/authenticated: acesso apenas pelo backend com service_role.
revoke all on public.profiles, public.products, public.sales, public.sale_items, public.finance_entries from anon, authenticated;
grant execute on function public.create_sale(jsonb,text,text,uuid) to service_role;

-- Criação automática do perfil básico após cadastro via Supabase Auth.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id,email,full_name,role)
  values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name','Novo usuário'),'Vendedor')
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();
