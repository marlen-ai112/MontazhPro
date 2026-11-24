-- Office Duty Quest — схема базы данных (Supabase / PostgreSQL)
-- Выполните целиком в Supabase → SQL Editor.

create table if not exists employees (
  id        text primary key,
  name      text not null check (char_length(name) between 1 and 24),
  position  int  not null default 0
);

-- Версии недельного расписания: действует с даты effective_from.
-- assignments: {"0":"e-donat","1":"e-mustafa",...} (0 = понедельник)
create table if not exists schedule_versions (
  effective_from date primary key,
  assignments    jsonb not null
);

-- Разовые замены дежурного на конкретную дату
create table if not exists schedule_overrides (
  date        date primary key,
  employee_id text not null references employees(id) on update cascade on delete cascade
);

-- Отметки: строка есть = задание выполнено. Первичный ключ защищает от дублей (и от двойного XP).
create table if not exists task_marks (
  duty_date    date not null,
  task_id      text not null check (task_id in ('toilet','kitchen','dishes','workplace','self')),
  marked_at    timestamptz not null default now(),
  marked_by    text not null check (marked_by in ('employee','admin')),
  marked_by_id text,
  late         boolean not null default false,
  primary key (duty_date, task_id)
);

create table if not exists activity (
  id          text primary key,
  at          timestamptz not null default now(),
  kind        text not null,
  actor       text not null,
  duty_date   date,
  task_id     text,
  employee_id text,
  detail      text
);
create index if not exists activity_at_idx on activity (at desc);

-- Настройки: deadlineHour, pinHash, startedOn
create table if not exists settings (
  key   text primary key,
  value jsonb not null
);

-- ───────── Безопасность (RLS) ─────────
alter table employees          enable row level security;
alter table schedule_versions  enable row level security;
alter table schedule_overrides enable row level security;
alter table task_marks         enable row level security;
alter table activity           enable row level security;
alter table settings           enable row level security;

-- ВНИМАНИЕ: политики ниже разрешают чтение и запись анонимному ключу — это удобно для
-- закрытого офисного приложения, но PIN-код тогда является «мягкой» защитой интерфейса.
-- Для настоящей защиты включите Supabase Auth и ограничьте запись для роли authenticated
-- (см. README, раздел «Усиление безопасности»).
do $$
declare t text;
begin
  foreach t in array array['employees','schedule_versions','schedule_overrides','task_marks','activity','settings'] loop
    execute format('drop policy if exists "odq_all_%1$s" on %1$I', t);
    execute format('create policy "odq_all_%1$s" on %1$I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;
