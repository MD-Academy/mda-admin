// Shared UI helpers — branded confirm dialog + input safety guard.

// ── INPUT SAFETY GUARD ──
// NOTE: the real XSS protection is output escaping (escapeHtml on every render).
// This is a friendly extra layer that rejects obviously malicious input with a
// clear "invalid format" message. Patterns are narrow to avoid false positives
// on legitimate medical text (e.g. "a < b" is fine; "<script>" is not).
const _UNSAFE_PATTERNS = [
    /<\s*script/i,
    /<\s*\/\s*script/i,
    /<\s*iframe/i,
    /<\s*object/i,
    /<\s*embed/i,
    /javascript\s*:/i,
    /\bon(?:error|load|click|mouseover|mouseenter|focus|submit|change|input|keydown|keyup)\s*=/i
];

function isUnsafeText(value) {
    if (value == null) return false;
    return _UNSAFE_PATTERNS.some(re => re.test(String(value)));
}

// Checks each [label, value] pair. If any contains unsafe content, shows the
// error in alertEl and returns false; otherwise returns true.
function ensureSafe(alertEl, fields) {
    for (const [label, value] of fields) {
        if (isUnsafeText(value)) {
            if (alertEl) {
                alertEl.className = 'alert error';
                alertEl.textContent = `Invalid format in "${label}". Scripts or code are not allowed.`;
                alertEl.style.display = 'block';
            }
            return false;
        }
    }
    return true;
}


// Shared UI helpers — branded confirm dialog (replaces the native confirm()).

function _ensureConfirmModal() {
    if (document.getElementById('ui-confirm-overlay')) return;
    const el = document.createElement('div');
    el.id = 'ui-confirm-overlay';
    el.className = 'modal-overlay ui-confirm-overlay';
    el.innerHTML = `
        <div class="ui-confirm">
            <div class="ui-confirm-icon" id="ui-confirm-icon"></div>
            <h3 id="ui-confirm-title"></h3>
            <p id="ui-confirm-message"></p>
            <div class="ui-confirm-actions">
                <button class="btn btn-ghost" id="ui-confirm-cancel">Cancel</button>
                <button class="btn btn-primary" id="ui-confirm-ok">Confirm</button>
            </div>
        </div>`;
    document.body.appendChild(el);
}

const _ICON_DANGER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
const _ICON_INFO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';

/**
 * Branded replacement for window.confirm().
 * Returns a Promise<boolean> — true if confirmed, false if cancelled.
 */
function confirmDialog(opts = {}) {
    _ensureConfirmModal();
    const {
        title = 'Are you sure?',
        message = '',
        confirmText = 'Confirm',
        cancelText = 'Cancel',
        danger = false
    } = opts;

    const overlay = document.getElementById('ui-confirm-overlay');
    const iconEl = document.getElementById('ui-confirm-icon');
    const okBtn = document.getElementById('ui-confirm-ok');
    const cancelBtn = document.getElementById('ui-confirm-cancel');

    document.getElementById('ui-confirm-title').textContent = title;
    document.getElementById('ui-confirm-message').textContent = message;
    okBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;
    okBtn.className = 'btn ' + (danger ? 'btn-danger-solid' : 'btn-primary');
    iconEl.className = 'ui-confirm-icon ' + (danger ? 'danger' : 'info');
    iconEl.innerHTML = danger ? _ICON_DANGER : _ICON_INFO;

    overlay.style.display = 'flex';

    return new Promise(resolve => {
        function cleanup(result) {
            overlay.style.display = 'none';
            okBtn.onclick = null;
            cancelBtn.onclick = null;
            overlay.onclick = null;
            document.removeEventListener('keydown', onKey);
            resolve(result);
        }
        function onKey(e) {
            if (e.key === 'Escape') cleanup(false);
            else if (e.key === 'Enter') cleanup(true);
        }
        okBtn.onclick = () => cleanup(true);
        cancelBtn.onclick = () => cleanup(false);
        overlay.onclick = (e) => { if (e.target === overlay) cleanup(false); };
        document.addEventListener('keydown', onKey);
        okBtn.focus();
    });
}
