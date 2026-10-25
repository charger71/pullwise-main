// A fake Supabase client for the screenshot checks (tools/visual): every query method returns the same chainable,
// awaitable object, which resolves to the fixture data for its table. Nothing leaves the machine.
export function fakeSb(fixtures = {}, extra = {}) {
  const resolveQuery = (state) => {
    let data = fixtures[state.table] ?? [];
    if (typeof data === 'function') data = data(state);
    const arr = Array.isArray(data) ? data : [data];
    const out = state.single ? (arr[0] ?? null) : data;
    return { data: out, error: null, count: Array.isArray(data) ? data.length : null };
  };
  const make = (table) => {
    const state = { table, single: false, calls: [] };
    const q = new Proxy(function () {}, {
      get(_, prop) {
        if (prop === 'then') return (res, rej) => Promise.resolve(resolveQuery(state)).then(res, rej);
        if (prop === 'single' || prop === 'maybeSingle') return () => ((state.single = true), q);
        return (...args) => (state.calls.push([prop, args]), q);
      },
    });
    return q;
  };
  return {
    from: (t) => make(t),
    rpc: (name) => { const p = Promise.resolve({ data: (extra.rpc ?? {})[name] ?? [], error: null }); p.range = () => p; return p; },
    functions: { invoke: async () => ({ data: {}, error: null }) },
    storage: {
      from: () => ({
        list: async () => ({ data: extra.files ?? [], error: null }),
        // a local grey square: a picture service would make the shots depend on the network
        getPublicUrl: () => ({ data: { publicUrl: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22400%22%3E%3Crect width=%22400%22 height=%22400%22 fill=%22%23c8ced6%22/%3E%3C/svg%3E' } }),
        remove: async () => ({ error: null }),
        upload: async () => ({ error: null }),
      }),
    },
    auth: { getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: { id: 'u1', email: 'dana@example.com' } } }), updateUser: async () => ({ error: null }) },
  };
}
