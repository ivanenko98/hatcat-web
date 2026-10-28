// Tiny element builder: h('div', {class: 'x', onclick: fn}, 'text', child, [more]).
// Strings become text nodes, so data from the API is never parsed as HTML.
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') for (const [p, pv] of Object.entries(v)) el.style.setProperty(p.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()), pv);
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

// Inline SVG icon from public/assets/svg, recoloured with currentColor via CSS mask.
export function icon(name, cls = '') {
  return h('span', { class: 'icon ' + cls, style: { '--icon': `url(/assets/svg/${name}.svg)` }, 'aria-hidden': 'true' });
}

// root.replaceChildren(...) that skips null/false, which it would otherwise print as the text "null".
export function mount(root, ...children) {
  root.replaceChildren(...children.flat().filter((c) => c != null && c !== false));
}
