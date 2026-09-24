// Keeps the app pinned like a native app. The page never scrolls; the app is sized to the part of the
// screen you can see, so when the keyboard opens everything fits above it instead of the phone
// dragging the whole page up (iPhone) or leaving a gap.
export function pinViewport() {
  const vv = window.visualViewport;
  const root = document.documentElement;
  let tallest = 0;
  const sync = () => {
    const h = Math.round(vv ? vv.height : window.innerHeight);
    tallest = Math.max(tallest, h, window.innerHeight);
    root.style.setProperty('--vvh', `${h}px`);
    root.classList.toggle('kb-open', tallest - h > 140);
    if (window.scrollY || window.scrollX || (vv && vv.offsetTop > 0)) window.scrollTo(0, 0);
  };
  // A rotation starts over: the tallest height belongs to the new orientation.
  window.addEventListener('orientationchange', () => { tallest = 0; setTimeout(sync, 350); });
  vv?.addEventListener('resize', sync);
  vv?.addEventListener('scroll', sync);
  window.addEventListener('resize', sync);
  // iPhone scrolls a moment after focusing a field; put the page back once it has.
  document.addEventListener('focusin', () => { sync(); setTimeout(sync, 60); setTimeout(sync, 320); });
  document.addEventListener('focusout', () => setTimeout(sync, 60));
  sync();
}
