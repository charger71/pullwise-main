// "Follow this series?" on the storefront and in the app: before a series is followed, a dialog shows the issue
// that goes on the pull list first (cover, title, order-by and FOC dates) and the other open issues that come with it.
import { esc } from './util.js';
import { seriesFollowPreview } from './customer.js';
import { seriesFollowFacts, alsoText, NEVER_ADDED } from './series-follow.js';

function issueHtml(f) {
  if (!f.loaded) return '<p class="follow-confirm__empty">New issues will be added to your pull list automatically.</p>';
  if (!f.next) return '<p class="follow-confirm__empty">No issue is open for ordering right now. The next one goes on your pull list as soon as the shop lists it.</p>';
  const n = f.next;
  const pic = n.thumbUrl
    ? `<img class="cover follow-confirm__cover" src="${esc(n.thumbUrl)}" alt="Cover of ${esc(n.title)}" width="300" height="450" decoding="async">`
    : '<span class="cover cover--placeholder follow-confirm__cover" aria-hidden="true">Image coming soon</span>';
  const also = alsoText(f);
  return `<p class="follow-confirm__lead">Goes on your pull list now</p>
    <div class="follow-confirm__issue">
      ${pic}
      <div class="follow-confirm__info">
        <p class="follow-confirm__title">${esc(n.title)}</p>
        <p class="follow-confirm__covers">${esc(n.covers)}</p>
        ${n.orderBy ? `<p class="follow-confirm__date">Order by <strong>${esc(n.orderBy)}</strong></p><p class="follow-confirm__foc">FOC ${esc(n.foc)}</p>` : '<p class="follow-confirm__foc">Order cutoff not set yet</p>'}
      </div>
    </div>
    ${also ? `<p class="follow-confirm__also"><strong>Also added:</strong> ${esc(also)}</p>` : ''}`;
}

/** Ask before following a series. Resolves true to go ahead, false if the customer cancels. */
export async function confirmSeriesFollow(key, { label, allCovers = false } = {}) {
  const opener = document.activeElement;
  const f = seriesFollowFacts(await seriesFollowPreview(key), { label, allCovers });
  const d = document.createElement('dialog');
  d.className = 'follow-confirm';
  d.setAttribute('aria-labelledby', 'fc-title');
  d.innerHTML = `
    <div class="dialog__head">
      <h2 id="fc-title">Follow ${esc(f.name)}?</h2>
      <button class="dialog__close" type="button" aria-label="Close">✕</button>
    </div>
    <div class="dialog__body">
      ${issueHtml(f)}
      <p class="follow-confirm__note">Later issues are added automatically until each order cutoff, and you can remove any you don’t want. ${NEVER_ADDED}</p>
      <div class="follow-confirm__foot">
        <button class="btn btn--ghost" type="button" data-close>Cancel</button>
        <button class="btn btn--primary" type="button" data-go>Follow${allCovers ? ' all covers' : ' series'}</button>
      </div>
    </div>`;
  document.body.append(d);
  return new Promise((resolve) => {
    let go = false;
    d.addEventListener('click', (e) => {
      if (e.target.closest('[data-go]')) (go = true), d.close();
      else if (e.target === d || e.target.closest('.dialog__close, [data-close]')) d.close();
    });
    d.addEventListener('close', () => {
      d.remove();
      if (opener?.isConnected) opener.focus();
      resolve(go);
    });
    d.showModal();
    d.querySelector('[data-go]').focus();
  });
}
