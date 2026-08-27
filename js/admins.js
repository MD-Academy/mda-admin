// Admins management — superadmin only. Create/reset/delete admin & superadmin accounts.

let allAdmins = [];
let CURRENT_UID = null;

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function showModalAlert(el, msg, type) {
    el.className = `alert ${type}`;
    el.textContent = msg;
    el.style.display = 'block';
}
function formatDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function loadAdmins() {
    const tbody = document.getElementById('admins-tbody');
    tbody.innerHTML = `<tr><td colspan="5" class="loader">Loading admins…</td></tr>`;

    const { data, error } = await db
        .from('profiles')
        .select('id, full_name, email, role, job_title, status, created_at')
        .in('role', ['admin', 'superadmin'])
        .order('created_at', { ascending: true });

    if (error) {
        tbody.innerHTML = `<tr><td colspan="6" class="loader" style="color:var(--red)">Error loading admins: ${escapeHtml(error.message)}</td></tr>`;
        return;
    }
    allAdmins = data || [];
    renderAdmins();
}

function renderAdmins() {
    const tbody = document.getElementById('admins-tbody');
    if (allAdmins.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="loader">No admins yet.</td></tr>`;
        return;
    }
    tbody.innerHTML = allAdmins.map(a => {
        const isSelf = a.id === CURRENT_UID;
        const roleBadge = a.role === 'superadmin'
            ? `<span class="badge badge-amber">Superadmin</span>`
            : `<span class="badge badge-blue">Admin</span>`;
        const jobCell = a.job_title
            ? `<span style="font-size:13px;color:var(--text);">${escapeHtml(a.job_title)}</span>`
            : `<span style="font-size:13px;color:var(--text-muted);font-style:italic;">Not set</span>`;
        return `
            <tr>
                <td>
                    <strong>${escapeHtml(a.full_name || '—')}</strong>${isSelf ? ' <span class="badge badge-green" style="margin-left:6px;">You</span>' : ''}
                    <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${a.email ? '✉️ ' + escapeHtml(a.email) : '<span style="color:var(--red);">no email on file</span>'}</div>
                </td>
                <td>${roleBadge}</td>
                <td><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">${jobCell}<button class="btn btn-ghost btn-sm" onclick="openRoleModal('${a.id}')">Edit</button></div></td>
                <td>${a.status === 'suspended' ? '<span class="badge badge-red">Suspended</span>' : '<span class="badge badge-green">Active</span>'}</td>
                <td>${formatDate(a.created_at)}</td>
                <td class="row-actions">
                    <button class="btn btn-ghost btn-sm" style="color:var(--navy-800);border-color:#c7d2e4;" onclick="openEditLogin('${a.id}')">✏️ Edit login</button>
                    <button class="btn btn-ghost btn-sm" onclick="resetAdminPw('${a.id}')">Reset PW</button>
                    <button class="btn btn-ghost btn-sm" onclick="resetAdminMfa('${a.id}')">Reset 2FA</button>
                    ${isSelf
                        ? '<button class="btn btn-ghost btn-sm" disabled style="opacity:.4;cursor:default;" title="You cannot block your own account">Block</button>'
                        : `<button class="btn btn-ghost btn-sm" onclick="toggleAdminStatus('${a.id}')">${a.status === 'suspended' ? 'Activate' : 'Block'}</button>`}
                    ${isSelf
                        ? '<button class="btn btn-ghost btn-sm" disabled style="opacity:.4;cursor:default;" title="You cannot delete your own account">Delete</button>'
                        : `<button class="btn btn-danger btn-sm" onclick="deleteAdmin('${a.id}')">Delete</button>`}
                </td>
            </tr>`;
    }).join('');
}

// ── EDIT LOGIN (name + login email) — super-admin only ──
async function openEditLogin(id) {
    const a = allAdmins.find(x => x.id === id);
    if (!a) return;
    document.getElementById('login-alert').style.display = 'none';
    document.getElementById('login-user-id').value = id;
    document.getElementById('login-context').textContent = a.full_name || 'This staff member';
    document.getElementById('login-name').value = a.full_name || '';
    const emailField = document.getElementById('login-email');
    emailField.value = a.email || '';
    openModal('login-modal');
    setTimeout(() => emailField.focus(), 50);
    // Confirm the actual sign-in email from auth (source of truth), in case the
    // profile copy is missing or stale.
    try {
        const r = await apiRequest('GET', `/admin/auth-email/${id}`);
        if (r && r.email) {
            emailField.value = r.email;
            if (a.email !== r.email) { a.email = r.email; renderAdmins(); }
        }
    } catch (e) { /* fall back to the profile copy already shown */ }
}

async function saveEditLogin(e) {
    e.preventDefault();
    const btn = document.getElementById('login-save-btn');
    const alert = document.getElementById('login-alert');
    alert.style.display = 'none';
    const id = document.getElementById('login-user-id').value;
    const full_name = document.getElementById('login-name').value.trim();
    const email = document.getElementById('login-email').value.trim();
    if (!email) { showModalAlert(alert, 'Enter the login email.', 'error'); return; }
    if (!ensureSafe(alert, [['Name', full_name]])) return;

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        const r = await apiRequest('POST', `/admin/update-user-email/${id}`, { email, full_name });
        const a = allAdmins.find(x => x.id === id);
        if (a) { a.email = r.email || email; if (full_name) a.full_name = full_name; }
        renderAdmins();
        closeModal('login-modal');
        await confirmDialog({
            title: 'Login updated ✓',
            message: `Their login email is now ${r.email || email}. Tell them to sign in with this email. If they've forgotten the password, use "Reset PW" to generate a new one.`,
            confirmText: 'OK', cancelText: 'Close'
        });
    } catch (err) {
        showModalAlert(alert, err.message || 'Could not update the login.', 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Save Login';
    }
}

// ── EDIT A STAFF MEMBER'S DESCRIPTIVE ROLE (job_title) — super-admin only ──
function openRoleModal(id) {
    const a = allAdmins.find(x => x.id === id);
    if (!a) return;
    document.getElementById('role-alert').style.display = 'none';
    document.getElementById('role-user-id').value = id;
    document.getElementById('role-context').textContent = a.full_name || 'This staff member';
    document.getElementById('role-input').value = a.job_title || '';
    openModal('role-modal');
    setTimeout(() => document.getElementById('role-input').focus(), 50);
}

async function saveRole(e) {
    e.preventDefault();
    const btn = document.getElementById('role-save-btn');
    const alert = document.getElementById('role-alert');
    alert.style.display = 'none';
    const id = document.getElementById('role-user-id').value;
    const job_title = document.getElementById('role-input').value.trim();
    if (!ensureSafe(alert, [['Role', job_title]])) return;

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        await apiRequest('POST', `/admin/set-staff-role/${id}`, { job_title });
        const a = allAdmins.find(x => x.id === id);
        if (a) a.job_title = job_title || null;
        renderAdmins();
        closeModal('role-modal');
    } catch (err) {
        showModalAlert(alert, err.message || 'Could not save the role.', 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Save Role';
    }
}

function openAdminModal() {
    document.getElementById('admin-alert').style.display = 'none';
    document.getElementById('admin-name').value = '';
    document.getElementById('admin-email').value = '';
    document.getElementById('admin-role').value = 'admin';
    openModal('admin-modal');
}

async function createAdmin(e) {
    e.preventDefault();
    const btn = document.getElementById('admin-create-btn');
    const alert = document.getElementById('admin-alert');
    alert.style.display = 'none';

    const full_name = document.getElementById('admin-name').value.trim();
    const email = document.getElementById('admin-email').value.trim();
    const role = document.getElementById('admin-role').value;

    if (!full_name || !email) { showModalAlert(alert, 'Please enter both name and email.', 'error'); return; }
    if (!ensureSafe(alert, [['Full Name', full_name], ['Email', email]])) return;

    btn.disabled = true; btn.textContent = 'Creating…';
    try {
        const res = await apiRequest('POST', '/admin/create-admin', { full_name, email, role });
        closeModal('admin-modal');
        showCredentials(res);
        loadAdmins();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Create Account';
    }
}

function showCredentials(res) {
    const body = document.getElementById('creds-body');
    body.innerHTML = `
        <p class="creds-warning">⚠️ Save these credentials now — the password is shown only once. Hand them to the new ${res.role === 'superadmin' ? 'superadmin' : 'admin'}.</p>
        <div class="preview-table-wrap">
            <table class="data-table">
                <thead><tr><th>Name</th><th>Email</th><th>Password</th><th>Role</th></tr></thead>
                <tbody><tr>
                    <td>${escapeHtml(res.full_name)}</td>
                    <td>${escapeHtml(res.email)}</td>
                    <td><code>${escapeHtml(res.password)}</code></td>
                    <td>${res.role === 'superadmin' ? 'Superadmin' : 'Admin'}</td>
                </tr></tbody>
            </table>
        </div>`;
    openModal('creds-modal');
}

async function resetAdminPw(id) {
    const a = allAdmins.find(x => x.id === id);
    const name = a ? (a.full_name || 'this admin') : 'this admin';
    const ok = await confirmDialog({
        title: 'Reset password?',
        message: `A new password will be generated for ${name}. Their current password stops working immediately.`,
        confirmText: 'Generate New Password'
    });
    if (!ok) return;
    try {
        const res = await apiRequest('POST', `/admin/reset-password/${id}`);
        showCredentials({ full_name: name, email: '(unchanged)', password: res.new_password, role: 'admin' });
    } catch (err) {
        alert(`Failed to reset password: ${err.message}`);
    }
}

async function toggleAdminStatus(id) {
    if (id === CURRENT_UID) return;
    const a = allAdmins.find(x => x.id === id);
    if (!a) return;
    const suspend = a.status !== 'suspended';
    const ok = await confirmDialog({
        title: suspend ? `Block ${a.full_name || 'this admin'}?` : `Activate ${a.full_name || 'this admin'}?`,
        message: suspend
            ? 'They will be blocked from logging in immediately. Their account is kept — reactivate anytime.'
            : 'They will be able to log in again right away.',
        confirmText: suspend ? 'Block' : 'Activate',
        danger: suspend
    });
    if (!ok) return;
    try {
        await apiRequest('PATCH', `/admin/update-student/${id}`, { status: suspend ? 'suspended' : 'active' });
        loadAdmins();
    } catch (err) {
        alert(`Failed to update status: ${err.message}`);
    }
}

async function resetAdminMfa(id) {
    const a = allAdmins.find(x => x.id === id);
    const name = a ? (a.full_name || 'this admin') : 'this admin';
    const ok = await confirmDialog({
        title: `Reset 2FA for ${name}?`,
        message: 'This removes their two-factor authentication so they can log in with just their password (then set it up again). Use this if they lost their authenticator app.',
        confirmText: 'Reset 2FA'
    });
    if (!ok) return;
    try {
        const r = await apiRequest('POST', `/admin/clear-mfa/${id}`);
        alert(r.removed ? '2FA has been reset for this account.' : 'This account had no 2FA set.');
    } catch (err) { alert(`Failed to reset 2FA: ${err.message}`); }
}

async function deleteAdmin(id) {
    if (id === CURRENT_UID) return;
    const a = allAdmins.find(x => x.id === id);
    const name = a ? (a.full_name || 'this admin') : 'this admin';
    const ok = await confirmDialog({
        title: `Delete ${name}?`,
        message: 'This permanently deletes the staff account. This cannot be undone.',
        confirmText: 'Delete', danger: true
    });
    if (!ok) return;
    try {
        await apiRequest('DELETE', `/admin/delete-admin/${id}`);
        loadAdmins();
    } catch (err) {
        alert(`Failed to delete: ${err.message}`);
    }
}
