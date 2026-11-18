// Runs inside the admin page while tools/help-capture records it (added with page.addInitScript). Draws what the
// viewer of a walk-through needs and a real screen doesn't have: a caption bar, a pointer that glides to the next
// thing clicked, a ring around it and a pulse when it's clicked. Everything sits in one shadow root at the top of the
// page and never takes clicks, so it can't change what the admin does.
(() => {
  if (window.__help) return;
  let root;
  let parts;
  const css = `
    :host { all: initial; }
    .cap { position: fixed; left: 50%; bottom: 72px; transform: translate(-50%, 12px); max-width: min(900px, calc(100vw - 64px));
      padding: 14px 22px; border-radius: 12px; background: rgb(20 20 24 / .9); color: #fff; opacity: 0;
      font: 600 22px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif; text-align: center;
      box-shadow: 0 10px 30px rgb(0 0 0 / .3); transition: opacity .25s, transform .25s; }
    .cap.on { opacity: 1; transform: translate(-50%, 0); }
    .ring { position: fixed; border: 4px solid #ffb400; border-radius: 10px; box-shadow: 0 0 0 9999px rgb(0 0 0 / .18);
      opacity: 0; transition: opacity .2s, left .35s, top .35s, width .35s, height .35s; }
    .ring.on { opacity: 1; }
    .ring.shot { box-shadow: none; }
    .ptr { position: fixed; left: 0; top: 0; width: 26px; height: 26px; margin: -4px 0 0 -4px; opacity: 0;
      transition: transform .6s cubic-bezier(.3,.7,.3,1), opacity .2s; }
    .ptr.on { opacity: 1; }
    .ptr svg { display: block; filter: drop-shadow(0 2px 3px rgb(0 0 0 / .45)); }
    .pulse { position: fixed; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; background: rgb(255 180 0 / .55);
      animation: pulse .5s ease-out forwards; }
    @keyframes pulse { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }
    .hide .cap, .hide .ptr, .hide .pulse { display: none; }
    .hide .ring:not(.shot) { display: none; }`;

  function ensure() {
    if (root?.isConnected) return parts;
    root = document.createElement('div');
    root.setAttribute('data-help-overlay', '');
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
    const shadow = root.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${css}</style><div class="box"><div class="ring"></div><div class="ptr"><svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2l15 11-6.5 1.2L16 21l-3 1.3-3.4-6.9L4 20z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg></div><div class="cap" role="presentation"></div></div>`;
    document.documentElement.append(root);
    const box = shadow.querySelector('.box');
    parts = { box, cap: shadow.querySelector('.cap'), ring: shadow.querySelector('.ring'), ptr: shadow.querySelector('.ptr') };
    return parts;
  }

  window.__help = {
    say(text) {
      const { cap } = ensure();
      cap.textContent = text;
      cap.classList.toggle('on', !!text);
    },
    ring(rect, { forShot = false } = {}) {
      const { ring } = ensure();
      if (!rect) return ring.classList.remove('on');
      const pad = 6;
      Object.assign(ring.style, { left: `${rect.x - pad}px`, top: `${rect.y - pad}px`, width: `${rect.width + pad * 2}px`, height: `${rect.height + pad * 2}px` });
      ring.classList.toggle('shot', forShot);
      ring.classList.add('on');
    },
    pointer(x, y) {
      const { ptr } = ensure();
      ptr.classList.add('on');
      ptr.style.transform = `translate(${x}px, ${y}px)`;
    },
    pulse(x, y) {
      const { box } = ensure();
      const p = document.createElement('div');
      p.className = 'pulse';
      p.style.left = `${x}px`;
      p.style.top = `${y}px`;
      box.append(p);
      setTimeout(() => p.remove(), 600);
    },
    /** For screenshots: hide the caption and pointer (and the ring, unless it was drawn for the shot). */
    hide(on) {
      ensure().box.classList.toggle('hide', on);
    },
  };
})();
