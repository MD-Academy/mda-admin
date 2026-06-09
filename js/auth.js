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
                return { session, profile };
            }
        } catch (e) { /* fall through to a fresh fetch */ }
    }

    const { data: profile } = await db
        .from('profiles')
        .select('role, full_name, avatar_url, status')
        .eq('id', session.user.id)
        .single();

    if (!profile || !_isAdminRole(profile.role) || profile.status === 'suspended') {
        await db.auth.signOut();
        window.location.href = 'index.html';
        return null;
    }
    sessionStorage.setItem(cacheKey, JSON.stringify(profile));
    return { session, profile };
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
        const { data: profile } = await db
            .from('profiles')
            .select('role, full_name, avatar_url, status')
            .eq('id', userId)
            .single();
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
    Object.keys(sessionStorage)
        .filter(k => k.startsWith('mda_profile_'))
        .forEach(k => sessionStorage.removeItem(k));
    await db.auth.signOut();
    window.location.href = 'index.html';
}
