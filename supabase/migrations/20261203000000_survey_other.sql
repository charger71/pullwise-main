-- Pick one / Pick any questions can allow an "Other" write-in (question flag other: true).
-- Stored as "Other: <text>" (or just "Other"), at most 210 characters.

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
  v_arr     jsonb;
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
          -- Write-in: "Other" or "Other: something", only on questions that allow it.
          if not (coalesce((v_q ->> 'other')::boolean, false) and (v_text = 'Other' or v_text like 'Other: %')) then
            raise exception 'Invalid answer.' using errcode = 'P0001';
          end if;
          v_text := left(v_text, 210);
        end if;
        v_clean := v_clean || jsonb_build_object(v_q ->> 'id', v_text);
      when 'multi' then
        if jsonb_typeof(v_val) <> 'array' then raise exception 'Invalid answer.' using errcode = 'P0001'; end if;
        v_arr := '[]'::jsonb;
        for v_opt in select * from jsonb_array_elements(v_val) loop
          if jsonb_typeof(v_opt) <> 'string' then raise exception 'Invalid answer.' using errcode = 'P0001'; end if;
          v_text := v_opt #>> '{}';
          if not (v_q -> 'options') @> to_jsonb(v_text) then
            if not (coalesce((v_q ->> 'other')::boolean, false) and (v_text = 'Other' or v_text like 'Other: %')) then
              raise exception 'Invalid answer.' using errcode = 'P0001';
            end if;
            v_text := left(v_text, 210);
          end if;
          v_arr := v_arr || to_jsonb(v_text);
        end loop;
        v_clean := v_clean || jsonb_build_object(v_q ->> 'id', v_arr);
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
