// Shared 2FA (TOTP) helper using Supabase Auth MFA. Used on profile + login pages.
// Relies on a global `db` (the Supabase client) being defined by auth.js / login.js.

async function renderMfaSection(containerId) {
    const el = document.getElementById(containerId);
    el.innerHTML = '<div class="hint">Loading 2FA status…</div>';
    const { data: factors, error } = await db.auth.mfa.listFactors();
    if (error) { el.innerHTML = `<div class="hint" style="color:var(--red)">Could not load 2FA: ${error.message}</div>`; return; }
    const verified = (factors.totp || []).find(f => f.status === 'verified');

    if (verified) {
        el.innerHTML = `
            <p class="hint" style="margin-bottom:12px;">🔒 Two-factor authentication is <strong style="color:var(--green)">ON</strong>. You'll enter a code from your authenticator app each time you log in.</p>
            <button class="btn btn-ghost" id="mfa-disable">Disable 2FA</button>
            <div class="alert" id="mfa-msg" style="display:none;margin-top:12px;"></div>`;
        document.getElementById('mfa-disable').onclick = () => _disableMfa(verified.id, containerId);
    } else {
        el.innerHTML = `
            <p class="hint" style="margin-bottom:12px;">Add a second step at login using an authenticator app (Google Authenticator, Authy, 1Password, LastPass…). Optional, but recommended.</p>
            <button class="btn btn-primary" id="mfa-enable">Enable 2FA</button>
            <div id="mfa-enroll" style="margin-top:16px;"></div>`;
        document.getElementById('mfa-enable').onclick = () => _startEnroll(containerId);
    }
}

async function _startEnroll(containerId) {
    const box = document.getElementById('mfa-enroll');
    box.innerHTML = '<div class="hint">Generating QR code…</div>';
    // Remove any leftover unverified factors first.
    try {
        const { data: f } = await db.auth.mfa.listFactors();
        for (const fac of (f.totp || [])) { if (fac.status !== 'verified') await db.auth.mfa.unenroll({ factorId: fac.id }); }
    } catch (e) { /* ignore */ }

    const { data, error } = await db.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator ' + Date.now() });
    if (error) { box.innerHTML = `<div class="alert error">${error.message}</div>`; return; }
    const factorId = data.id;
    const qr = data.totp.qr_code;        // SVG string
    const secret = data.totp.secret;

    box.innerHTML = `
        <div style="background:#fff;padding:12px;border:1px solid var(--border);border-radius:12px;display:inline-block;max-width:220px;">${qr}</div>
        <p class="hint" style="margin:10px 0;">Scan this in your authenticator app, or enter the key manually:<br><code style="user-select:all;">${secret}</code></p>
        <div class="form-field" style="max-width:220px;"><label>6-digit code from the app</label><input type="text" id="mfa-code" inputmode="numeric" maxlength="6" placeholder="123456"></div>
        <button class="btn btn-primary" id="mfa-confirm">Confirm &amp; Activate</button>
        <div class="alert error" id="mfa-enroll-msg" style="display:none;margin-top:10px;"></div>`;

    document.getElementById('mfa-confirm').onclick = async () => {
        const m = document.getElementById('mfa-enroll-msg');
        const code = document.getElementById('mfa-code').value.trim();
        if (!/^\d{6}$/.test(code)) { m.textContent = 'Enter the 6-digit code from your app.'; m.style.display = 'block'; return; }
        const ch = await db.auth.mfa.challenge({ factorId });
        if (ch.error) { m.textContent = ch.error.message; m.style.display = 'block'; return; }
        const v = await db.auth.mfa.verify({ factorId, challengeId: ch.data.id, code });
        if (v.error) { m.textContent = 'Incorrect code — try again.'; m.style.display = 'block'; return; }
        renderMfaSection(containerId);
    };
}

async function _disableMfa(factorId, containerId) {
    if (!confirm('Disable two-factor authentication? Your account will be less protected.')) return;
    const { error } = await db.auth.mfa.unenroll({ factorId });
    if (error) {
        const msg = document.getElementById('mfa-msg');
        if (msg) { msg.className = 'alert error'; msg.textContent = error.message; msg.style.display = 'block'; }
        return;
    }
    renderMfaSection(containerId);
}

// ── LOGIN HELPERS ──
async function mfaNeeded() {
    const { data } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
    return !!(data && data.nextLevel === 'aal2' && data.currentLevel !== 'aal2');
}
async function mfaVerifyCode(code) {
    const { data: factors } = await db.auth.mfa.listFactors();
    const totp = (factors.totp || []).find(f => f.status === 'verified');
    if (!totp) throw new Error('No 2FA method found on this account.');
    const ch = await db.auth.mfa.challenge({ factorId: totp.id });
    if (ch.error) throw new Error(ch.error.message);
    const v = await db.auth.mfa.verify({ factorId: totp.id, challengeId: ch.data.id, code });
    if (v.error) throw new Error('Incorrect code. Please try again.');
    return true;
}
