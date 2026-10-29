// Shared React/htm setup and small helpers. Every module imports React from the
// SAME esm.sh URL so the browser loads exactly one copy.
import React from 'https://esm.sh/react@18.3.1';
import htm from 'https://esm.sh/htm@3.1.1';

export { React };
export const { useState, useEffect, useRef, useMemo, useCallback, Fragment } = React;

// htm → React, with `class` accepted as `className`.
function h(type, props, ...children) {
  if (props && 'class' in props) { props = { ...props, className: props.class }; delete props.class; }
  return React.createElement(type, props, ...children);
}
export const html = htm.bind(h);

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
export const token = () => (uid() + uid()).replace(/-/g, '');
export const cx = (...a) => a.filter(Boolean).join(' ');

export const DISCIPLINES = { design: 'Product Design', pm: 'Product Management', eng: 'Engineering' };
export const ROLES = { organizer: 'Facilitator', facilitator: 'Facilitator', researcher: 'Researcher', participant: 'Participant' };
// Facilitators run the workshop: the workshop's creator (role 'organizer', also
// the owner) and anyone else given the Facilitator role. They don't sketch or vote.
export const facilitates = (m) => !!m && (m.role === 'organizer' || m.role === 'facilitator');

// Sticky colors handed out to members in order. Purple is reserved for the Decider's votes.
export const STICKY_COLORS = ['#FFE27A', '#FFB3C7', '#A8E6A1', '#A9D8FF', '#FFC48C', '#C9F0E8',
  '#FFD1F0', '#D9F59B', '#B9C6FF', '#FFEFB3', '#9BE3DE', '#F5C2A6'];
export const DECIDER_PURPLE = '#7B2FF7';

export function nextColor(members) {
  const used = new Set(members.map((m) => m.color));
  return STICKY_COLORS.find((c) => !used.has(c)) || STICKY_COLORS[members.length % STICKY_COLORS.length];
}

export function initials(name) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('');
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function inviteUrl(tok) { return location.origin + location.pathname + '#/join/' + tok; }

export function navigate(path) { location.hash = '#' + path; }

// "How might we" + the rest, joined naturally: "Modernize workflow" → "How might we modernize workflow".
export function hmwText(t) {
  let rest = String(t).replace(/^how might we\s*/i, '').replace(/^(\.\.\.|…)\s*/, '').trim();
  if (/^[A-Z][a-z]/.test(rest)) rest = rest[0].toLowerCase() + rest.slice(1);
  return 'How might we ' + rest;
}
