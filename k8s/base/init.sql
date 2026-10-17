create table products (
    id    bigserial primary key,
    name  text not null,
    price int  not null
);

insert into products (name, price)
select 'product-' || g, (random() * 10000)::int
from generate_series(1, 100) g;

create table orders (
    id         bigserial primary key,
    product_id bigint      not null,
    quantity   int         not null,
    status     text        not null,
    created_at timestamptz not null default now()
);
