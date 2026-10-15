-- Surveys: staff build them in the admin (Surveys), customers answer at survey.html?s=<slug> with no login.
-- questions is a jsonb array: { id, type: text | long | choice | multi | rating | yesno, label, options?, required }.
-- Answers are saved only through submit_survey_response(), which checks the survey is open and the answers are sane.

create table public.surveys (
  id         bigint generated always as identity primary key,
  slug       text not null unique,
  title      text not null,
  intro      text,
  thank_you  text,
  questions  jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array'),
  is_open    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger surveys_touch before update on public.surveys for each row execute function public.touch_updated_at();

create table public.survey_responses (
  id         bigint generated always as identity primary key,
  survey_id  bigint not null references public.surveys(id) on delete cascade,
  answers    jsonb not null check (jsonb_typeof(answers) = 'object'),
  client_ip  inet,
  created_at timestamptz not null default now()
);
create index survey_responses_survey_idx on public.survey_responses (survey_id, created_at desc);

alter table public.surveys enable row level security;
alter table public.survey_responses enable row level security;

-- Visitors see only open surveys; staff see and change everything.
create policy "public read open surveys" on public.surveys for select using (is_open or public.is_staff());
create policy "staff write surveys" on public.surveys for all using (public.is_staff()) with check (public.is_staff());
-- Responses are private: staff read and delete; nobody inserts directly (see the function below).
create policy "staff read responses" on public.survey_responses for select using (public.is_staff());
create policy "staff delete responses" on public.survey_responses for delete using (public.is_staff());

create or replace function public.submit_survey_response(
  p_survey_id bigint,
  p_answers   jsonb,
  p_website   text default null  -- honeypot: real users never fill this in
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_survey  public.surveys;
  v_q       jsonb;
  v_clean   jsonb := '{}'::jsonb;
  v_val     jsonb;
  v_text    text;
  v_opt     jsonb;
  v_n       int;
  v_ip      inet;
begin
  if coalesce(p_website, '') <> '' then
    return; -- bots get a silent success
  end if;
  if jsonb_typeof(p_answers) is distinct from 'object' then
    raise exception 'Something went wrong — please reload and try again.' using errcode = 'P0001';
  end if;

  select * into v_survey from public.surveys where id = p_survey_id and is_open;
  if v_survey.id is null then
    raise exception 'This survey is closed. Thanks for stopping by!' using errcode = 'P0001';
  end if;

  begin
    v_ip := split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1)::inet;
  exception when others then
    v_ip := null;
  end;
  if v_ip is not null and (
    select count(*) from public.survey_responses
    where client_ip = v_ip and created_at > now() - interval '10 minutes'
  ) >= 5 then
    raise exception 'Too many submissions in a short time — please try again later.' using errcode = 'P0001';
  end if;

  -- Keep only answers to real questions, in the right shape.
  for v_q in select * from jsonb_array_elements(v_survey.questions) loop
    v_val := p_answers -> (v_q ->> 'id');
    if v_val is null or v_val = 'null'::jsonb or v_val = '""'::jsonb or v_val = '[]'::jsonb then
      if coalesce((v_q ->> 'required')::boolean, false) then
        raise exception 'Please answer: %', left(v_q ->> 'label', 120) using errcode = 'P0001';
      end if;
      continue;
    end if;

    case v_q ->> 'type'
      when 'text', 'long' then
        if jsonb_typeof(v_val) <> 'string' then raise exception 'Invalid answer.' using errcode = 'P0001'; end if;
        v_text := left(trim(v_val #>> '{}'), case when v_q ->> 'type' = 'text' then 300 else 3000 end);
        if v_text <> '' then v_clean := v_clean || jsonb_build_object(v_q ->> 'id', v_text); end if;
      when 'choice', 'yesno' then
        if jsonb_typeof(v_val) <> 'string' then raise exception 'Invalid answer.' using errcode = 'P0001'; end if;
        v_text := v_val #>> '{}';
        if v_q ->> 'type' = 'yesno' then
          if v_text not in ('Yes', 'No') then raise exception 'Invalid answer.' using errcode = 'P0001'; end if;
        elsif not (v_q -> 'options') @> to_jsonb(v_text) then
          raise exception 'Invalid answer.' using errcode = 'P0001';
        end if;
        v_clean := v_clean || jsonb_build_object(v_q ->> 'id', v_text);
      when 'multi' then
        if jsonb_typeof(v_val) <> 'array' then raise exception 'Invalid answer.' using errcode = 'P0001'; end if;
        for v_opt in select * from jsonb_array_elements(v_val) loop
          if not (v_q -> 'options') @> jsonb_build_array(v_opt) then raise exception 'Invalid answer.' using errcode = 'P0001'; end if;
        end loop;
        v_clean := v_clean || jsonb_build_object(v_q ->> 'id', v_val);
      when 'rating' then
        if jsonb_typeof(v_val) <> 'number' then raise exception 'Invalid answer.' using errcode = 'P0001'; end if;
        v_n := (v_val #>> '{}')::numeric::int;
        if v_n < 1 or v_n > 5 then raise exception 'Invalid answer.' using errcode = 'P0001'; end if;
        v_clean := v_clean || jsonb_build_object(v_q ->> 'id', v_n);
      else
        null;
    end case;
  end loop;

  if v_clean = '{}'::jsonb then
    raise exception 'Please answer at least one question.' using errcode = 'P0001';
  end if;

  insert into public.survey_responses (survey_id, answers, client_ip) values (v_survey.id, v_clean, v_ip);
end;
$$;
grant execute on function public.submit_survey_response(bigint, jsonb, text) to anon, authenticated;

-- A survey with no questions can't be opened to the public.
create or replace function public.surveys_check_open() returns trigger language plpgsql as $$
begin
  if new.is_open and jsonb_array_length(new.questions) = 0 then
    raise exception 'Add at least one question before opening the survey.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger surveys_check_open before insert or update on public.surveys for each row execute function public.surveys_check_open();
