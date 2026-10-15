// "Publish now" for page titles and descriptions. The admin's Pages screen calls this
// after saving; it asks GitHub to run the "Apply page titles & descriptions" workflow
// (.github/workflows/apply-seo.yml) right away instead of waiting for its 30-minute schedule.
//
// POST (no body). Staff only (checked with public.is_staff() as the caller).
//
// Setup, once:
//   1. Create a fine-grained GitHub token for the site repo with "Actions: Read and write"
//      (all the workflow-dispatch API needs; it can't change the site's code).
//   2. supabase secrets set GITHUB_TOKEN=<token> GITHUB_REPO=<owner/name of the site repo>
//      (optional: GITHUB_REF — the branch to run the workflow on, defaults to main)
//   3. supabase functions deploy publish-seo

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: isStaff } = await supabase.rpc('is_staff');
  if (isStaff !== true) return json(403, { error: 'Staff only' });

  const token = Deno.env.get('GITHUB_TOKEN');
  if (!token) return json(500, { error: 'Publishing isn’t set up yet: the GITHUB_TOKEN secret is missing.' });
  const repo = Deno.env.get('GITHUB_REPO');
  if (!repo) return json(500, { error: 'Publishing isn’t set up yet: the GITHUB_REPO secret is missing.' });

  const ref = Deno.env.get('GITHUB_REF') ?? 'main';

  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/apply-seo.yml/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'pullwise-publish-seo',
    },
    body: JSON.stringify({ ref }),
  });
  if (res.status !== 204) return json(502, { error: `GitHub refused the request (${res.status}: ${(await res.text()).slice(0, 200)}). Check the GITHUB_TOKEN secret.` });
  return json(200, { ok: true });
});
