-- Test-only stand-in for pgmq. Implements the subset Upvane uses.
create table if not exists @extschema@.stub_messages (
  queue text not null,
  msg_id bigserial primary key,
  read_ct integer not null default 0,
  enqueued_at timestamptz not null default now(),
  vt timestamptz not null default now(),
  message jsonb not null
);

create table if not exists @extschema@.stub_queues (
  queue text primary key
);

create type @extschema@.message_record as (
  msg_id bigint,
  read_ct integer,
  enqueued_at timestamptz,
  vt timestamptz,
  message jsonb
);

create function @extschema@.create(queue_name text) returns void
language plpgsql as $$
begin
  insert into @extschema@.stub_queues(queue) values (queue_name) on conflict do nothing;
end;
$$;

create function @extschema@.send(queue_name text, msg jsonb, delay integer default 0) returns bigint
language plpgsql as $$
declare v_id bigint;
begin
  insert into @extschema@.stub_messages(queue, message, vt)
  values (queue_name, msg, now() + make_interval(secs => greatest(delay, 0)))
  returning msg_id into v_id;
  return v_id;
end;
$$;

create function @extschema@.read(queue_name text, vt integer, qty integer)
returns setof @extschema@.message_record
language plpgsql as $$
begin
  return query
  with picked as (
    select m.msg_id from @extschema@.stub_messages m
    where m.queue = queue_name and m.vt <= now()
    order by m.msg_id
    limit qty
    for update skip locked
  )
  update @extschema@.stub_messages m
  set read_ct = m.read_ct + 1, vt = now() + make_interval(secs => read.vt)
  from picked
  where m.msg_id = picked.msg_id
  returning m.msg_id, m.read_ct, m.enqueued_at, m.vt, m.message;
end;
$$;

create function @extschema@.delete(queue_name text, msg_id bigint) returns boolean
language plpgsql as $$
declare v_count integer;
begin
  delete from @extschema@.stub_messages m where m.queue = queue_name and m.msg_id = delete.msg_id;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

create function @extschema@.set_vt(queue_name text, msg_id bigint, vt_offset integer)
returns setof @extschema@.message_record
language plpgsql as $$
begin
  return query
  update @extschema@.stub_messages m
  set vt = now() + make_interval(secs => vt_offset)
  where m.queue = queue_name and m.msg_id = set_vt.msg_id
  returning m.msg_id, m.read_ct, m.enqueued_at, m.vt, m.message;
end;
$$;

create function @extschema@.archive(queue_name text, msg_id bigint) returns boolean
language sql as $$ select @extschema@.delete(queue_name, msg_id) $$;

create function @extschema@.purge_queue(queue_name text) returns bigint
language plpgsql as $$
declare v_count bigint;
begin
  delete from @extschema@.stub_messages where queue = queue_name;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
