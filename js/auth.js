const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function _isAdminRole(r) { return r === 'admin' || r === 'superadmin'; }

async function requireAdmin() {
    const { data: { session } } = await db.auth.getSession();
    if (!session) { window.location.href = 'index.html'; return null; }

    const cacheKey = `mda_profile_${session.user.id}`;

    // Fast path: use the cached profile so the layout renders instantly,
    // then re-verify in the background. (Security is enforced by RLS +
    // backend regardless of what's cached here.)
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
        try {
            const profile = JSON.parse(cached);
            if (profile && _isAdminRole(profile.role) && profile.status !== 'suspended') {
                _verifyAdminInBackground(session.user.id, cacheKey);
                _startAdminTracking(session.user.id);
                return { session, profile };
            }
        } catch (e) { /* fall through to a fresh fetch */ }
    }

    const { data: profile, error: profErr } = await db
        .from('profiles')
        .select('role, full_name, avatar_url, status')
        .eq('id', session.user.id)
        .single();

    // A failed lookup is NOT proof of suspension — never sign out on a transient error.
    if (profErr) {
        console.error('[auth] could not verify account:', profErr);
        const el = document.getElementById('app-layout') || document.body;
        el.innerHTML = `<div style="max-width:440px;margin:120px auto;text-align:center;font-family:'Inter',sans-serif;color:#1e293b;padding:0 20px;">
            <h2 style="margin-bottom:10px;">Connection problem</h2>
            <p style="color:#64748b;">We couldn't verify your account right now. Please refresh — if it keeps happening, contact your administrator.</p>
            <button onclick="location.reload()" style="margin-top:18px;padding:10px 20px;border:none;border-radius:8px;background:#b91c5c;color:#fff;font-weight:600;cursor:pointer;">Refresh</button>
        </div>`;
        return null;
    }

    if (!profile || !_isAdminRole(profile.role) || profile.status === 'suspended') {
        await db.auth.signOut();
        window.location.href = 'index.html';
        return null;
    }
    // If 2FA is enrolled but not yet completed this session, send back to login to finish it.
    try {
        const { data: aal } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') { window.location.href = 'index.html'; return null; }
    } catch (e) { /* ignore */ }
    sessionStorage.setItem(cacheKey, JSON.stringify(profile));
    _startAdminTracking(session.user.id);
    return { session, profile };
}

// ── LOGIN-TIME TRACKING (mirrors the student portal's, for the Usage Analytics report) ──
let _adminHeartbeatTimer = null;
async function _startAdminTracking(adminId) {
    try {
        let sid = sessionStorage.getItem('mda_admin_login_session_id');
        if (!sid) {
            const { data, error } = await db.from('admin_sessions').insert({ admin_id: adminId }).select('id').single();
            if (error) return;
            sid = data.id;
            sessionStorage.setItem('mda_admin_login_session_id', sid);
        } else {
            db.from('admin_sessions').update({ last_seen_at: new Date().toISOString(), ended_at: null }).eq('id', sid);
        }
        if (_adminHeartbeatTimer) clearInterval(_adminHeartbeatTimer);
        _adminHeartbeatTimer = setInterval(() => {
            const id = sessionStorage.getItem('mda_admin_login_session_id');
            if (id) db.from('admin_sessions').update({ last_seen_at: new Date().toISOString(), ended_at: null }).eq('id', id);
        }, 15000);

        const _sendEndBeacon = () => {
            const id = sessionStorage.getItem('mda_admin_login_session_id');
            if (!id) return;
            const blob = new Blob([JSON.stringify({ session_id: id, table: 'admin_sessions' })], { type: 'application/json' });
            navigator.sendBeacon(`${BACKEND_URL}/track/session-end`, blob);
        };
        window.addEventListener('beforeunload', _sendEndBeacon);
        window.addEventListener('pagehide', _sendEndBeacon);
        const _touch = (keepOpen) => {
            const id = sessionStorage.getItem('mda_admin_login_session_id');
            if (!id) return;
            const patch = { last_seen_at: new Date().toISOString() };
            if (keepOpen) patch.ended_at = null;
            db.from('admin_sessions').update(patch).eq('id', id);
        };
        document.addEventListener('visibilitychange', () => _touch(document.visibilityState === 'visible'));
        window.addEventListener('focus', () => _touch(true));
    } catch (e) { /* tracking must never block the page */ }
}

async function _endAdminSession() {
    const sid = sessionStorage.getItem('mda_admin_login_session_id');
    if (sid) {
        try { await db.from('admin_sessions').update({ last_seen_at: new Date().toISOString(), ended_at: new Date().toISOString() }).eq('id', sid); } catch (e) {}
        sessionStorage.removeItem('mda_admin_login_session_id');
    }
    if (_adminHeartbeatTimer) clearInterval(_adminHeartbeatTimer);
}

// Require superadmin specifically; sends regular admins back to the dashboard.
async function requireSuperadmin() {
    const auth = await requireAdmin();
    if (!auth) return null;
    if (auth.profile.role !== 'superadmin') {
        window.location.href = 'dashboard.html';
        return null;
    }
    return auth;
}

// Quietly confirm the cached admin is still valid; refresh or kick out.
async function _verifyAdminInBackground(userId, cacheKey) {
    try {
        const { data: profile, error } = await db
            .from('profiles')
            .select('role, full_name, avatar_url, status')
            .eq('id', userId)
            .single();
        if (error) { console.error('[auth] background re-verify failed (keeping session):', error); return; }  // transient — don't kick
        if (!profile || !_isAdminRole(profile.role) || profile.status === 'suspended') {
            sessionStorage.removeItem(cacheKey);
            await db.auth.signOut();
            window.location.href = 'index.html';
            return;
        }
        sessionStorage.setItem(cacheKey, JSON.stringify(profile));
    } catch (e) { /* ignore transient network errors */ }
}

async function apiRequest(method, path, body = null) {
    const { data: { session } } = await db.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    const opts = {
        method,
        headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
        }
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${BACKEND_URL}${path}`, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Request failed');
    return data;
}

async function signOut() {
    await _endAdminSession();
    Object.keys(sessionStorage)
        .filter(k => k.startsWith('mda_profile_'))
        .forEach(k => sessionStorage.removeItem(k));
    await db.auth.signOut();
    window.location.href = 'index.html';
}
