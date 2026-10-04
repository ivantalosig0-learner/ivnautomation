/* Deck controls: arrow keys, space, Page Up/Down, Home/End, swipe, the road bar at the bottom.
 * N shows the speaker notes, F goes full screen. The slide number lives in the address (#7). */
(function () {
  'use strict';
  const slides = Array.from(document.querySelectorAll('.slide'));
  const road = document.querySelector('.road');
  const lane = road.querySelector('.lane');
  const pin = road.querySelector('.pin');
  const count = road.querySelector('.count');
  let cur = 0;

  const posts = slides.map((s, i) => {
    const b = document.createElement('button');
    b.className = 'post';
    b.type = 'button';
    b.title = (i + 1) + '. ' + (s.dataset.title || '');
    b.setAttribute('aria-label', 'Go to slide ' + (i + 1) + ': ' + (s.dataset.title || ''));
    b.style.left = (slides.length > 1 ? (i / (slides.length - 1)) * 100 : 0) + '%';
    b.addEventListener('click', () => go(i));
    lane.appendChild(b);
    return b;
  });

  function go(i, fromHash) {
    cur = Math.max(0, Math.min(slides.length - 1, i));
    slides.forEach((s, k) => {
      s.classList.toggle('is-active', k === cur);
      s.classList.toggle('is-past', k < cur);
      s.setAttribute('aria-hidden', String(k !== cur));
    });
    posts.forEach((p, k) => p.classList.toggle('done', k <= cur));
    pin.style.left = posts[cur].style.left;
    pin.querySelector('span').textContent = slides[cur].dataset.chapter || '';
    count.textContent = (cur + 1) + ' / ' + slides.length;
    if (!fromHash && location.hash !== '#' + (cur + 1)) history.replaceState(null, '', '#' + (cur + 1));
  }

  addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown' || k === ' ' || k === 'Enter') { e.preventDefault(); go(cur + 1); }
    else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace') { e.preventDefault(); go(cur - 1); }
    else if (k === 'Home') go(0);
    else if (k === 'End') go(slides.length - 1);
    else if (k === 'n' || k === 'N') document.body.classList.toggle('show-notes');
    else if (k === 'f' || k === 'F') {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else document.documentElement.requestFullscreen().catch(() => {});
    }
  });
  road.querySelector('.prev').addEventListener('click', () => go(cur - 1));
  road.querySelector('.next').addEventListener('click', () => go(cur + 1));

  let sx = null;
  addEventListener('touchstart', (e) => (sx = e.touches[0].clientX), { passive: true });
  addEventListener('touchend', (e) => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx;
    sx = null;
    if (Math.abs(dx) > 60 && matchMedia('(min-width: 900px) and (min-aspect-ratio: 4/3)').matches) go(cur + (dx < 0 ? 1 : -1));
  }, { passive: true });

  const fromHash = () => {
    const n = parseInt(location.hash.slice(1), 10);
    go(n > 0 ? n - 1 : 0, true);
  };
  addEventListener('hashchange', fromHash);
  fromHash();
})();
