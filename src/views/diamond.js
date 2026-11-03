// The double diamond: the full diagram for the "Our approach" intro slide, and a
// small "you are here" marker for the room header.
import { html, cx } from '../lib.js';
import { DIAMOND, STEP_DIAMOND } from '../steps.js';

// Diamond 1 spans x 170–500, diamond 2 x 500–830, both y 10–290. Each is split
// down the middle into a widening (left) and a narrowing (right) triangle.
const TRI = [
  { pts: '170,150 335,10 335,290', x: 262 },
  { pts: '335,10 500,150 335,290', x: 408 },
  { pts: '500,150 665,10 665,290', x: 592 },
  { pts: '665,10 830,150 665,290', x: 738 },
];

export function DoubleDiamond({ steps }) {
  const byStage = (key) => steps.filter((s) => STEP_DIAMOND[s.key] === key);
  return html`
    <div class="dd">
      <svg class="dd-svg" viewBox="0 0 1000 340" role="img" aria-label="Double diamond: Discover, Define, Develop, Deliver">
        ${DIAMOND.map((d, i) => html`<g key=${d.key}>
          <polygon points=${TRI[i].pts} fill=${d.color} />
          <text x=${TRI[i].x} y="158" text-anchor="middle" class="dd-tri">${d.title.toUpperCase()}</text></g>`)}
        <line x1="335" y1="10" x2="335" y2="290" stroke="#fff" stroke-width="4" />
        <line x1="665" y1="10" x2="665" y2="290" stroke="#fff" stroke-width="4" />
        <text x="85" y="158" text-anchor="middle" class="dd-end">PROBLEM</text>
        <text x="915" y="158" text-anchor="middle" class="dd-end">SOLUTION</text>
        <text x="500" y="44" text-anchor="middle" class="dd-mid">PROBLEM</text>
        <text x="500" y="70" text-anchor="middle" class="dd-mid">DEFINITION</text>
        <text x="335" y="328" text-anchor="middle" class="dd-half" fill=${DIAMOND[0].color}>RESEARCH</text>
        <text x="665" y="328" text-anchor="middle" class="dd-half" fill=${DIAMOND[2].color}>DESIGN</text>
      </svg>
      <div class="dd-cols">
        ${DIAMOND.map((d) => html`<div key=${d.key} class="dd-col">
          <span class="dd-cap">${d.caption}</span>
          ${byStage(d.key).map((s) => html`<span key=${s.key} class="dd-step" style=${{ borderColor: d.color }}>${s.title}</span>`)}
        </div>`)}
      </div>
    </div>`;
}

// Four small triangles, the current stage in its color. Nothing for steps
// outside the diamond (the cover, the introduction).
export function DiamondMarker({ stepKey }) {
  const cur = DIAMOND.find((d) => d.key === STEP_DIAMOND[stepKey]);
  if (!cur) return null;
  return html`
    <span class="dd-marker" title=${`Double diamond: ${cur.title} (${cur.half})`}>
      <svg viewBox="160 0 680 300" aria-hidden="true">
        ${DIAMOND.map((d, i) => html`<polygon key=${d.key} points=${TRI[i].pts} fill=${d === cur ? d.color : '#D5D8DE'} stroke="#fff" stroke-width="14" />`)}
      </svg>
      <span class=${cx('dd-marker-label')} style=${{ color: cur.key === 'define' ? '#B98A12' : cur.color }}>${cur.title}</span>
    </span>`;
}
