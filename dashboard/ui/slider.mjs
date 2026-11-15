// Time slider under the map: prev/next, play (about 3 frames per second) and a mono readout.
import { $ } from './util.mjs';

export function createSlider({ onChange }) {
  const range = $('sl-range'), out = $('sl-label'), play = $('sl-play');
  let labels = [], timer = null;

  const set = i => {
    i = Math.max(0, Math.min(labels.length - 1, i));
    range.value = i; out.value = labels[i] ?? '';
    range.setAttribute('aria-valuetext', labels[i] ?? '');
    onChange(i);
  };
  const stop = () => { clearInterval(timer); timer = null; play.textContent = 'Play'; play.setAttribute('aria-pressed', 'false'); };

  range.addEventListener('input', () => { stop(); set(+range.value); });
  $('sl-prev').addEventListener('click', () => { stop(); set(+range.value - 1); });
  $('sl-next').addEventListener('click', () => { stop(); set(+range.value + 1); });
  play.addEventListener('click', () => {
    if (timer) return stop();
    if (+range.value >= labels.length - 1) set(0);
    play.textContent = 'Pause'; play.setAttribute('aria-pressed', 'true');
    timer = setInterval(() => { if (+range.value >= labels.length - 1) stop(); else set(+range.value + 1); }, 333);
  });

  return {
    setDomain(newLabels, index = newLabels.length - 1) {
      stop(); labels = newLabels; range.max = Math.max(0, labels.length - 1);
      const disabled = labels.length < 2;
      for (const id of ['sl-range', 'sl-prev', 'sl-next', 'sl-play']) $(id).disabled = disabled;
      set(index);
    },
    stop,
    index: () => +range.value,
  };
}
