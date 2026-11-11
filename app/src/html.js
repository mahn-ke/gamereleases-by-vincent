const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ESCAPES[char]);
}

// Tagged template that escapes interpolations unless they are `raw()`
const RAW = Symbol('raw');
export const raw = value => ({ [RAW]: String(value) });

function render(value) {
    if (value == null || value === false) return '';
    if (Array.isArray(value)) return value.map(render).join('');
    if (typeof value === 'object' && RAW in value) return value[RAW];
    return escapeHtml(value);
}

export function html(strings, ...values) {
    return raw(strings.reduce((out, string, i) => out + string + (i < values.length ? render(values[i]) : ''), ''));
}

export function toString(fragment) {
    return render(fragment);
}
