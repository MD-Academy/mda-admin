// Students management page logic.

let allStudents = [];

async function loadStudents() {
    const tbody = document.getElementById('students-tbody');
    tbody.innerHTML = `<tr><td colspan="5" class="loader">Loading students…</td></tr>`;

    const { data, error } = await db
        .from('profiles')
        .select('id, full_name, status, expiry_date, created_at')
        .eq('role', 'student')
        .order('created_at', { ascending: false });

    if (error) {
        tbody.innerHTML = `<tr><td colspan="5" class="loader" style="color:var(--red)">Error loading students: ${error.message}</td></tr>`;
        return;
    }

    allStudents = data || [];
    renderStudents(allStudents);
}

function renderStudents(students) {
    const tbody = document.getElementById('students-tbody');

    if (students.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="loader">No students yet. Click "Add Student" or "Bulk Import" to create accounts.</td></tr>`;
        return;
    }

    const today = new Date(); today.setHours(0,0,0,0);

    tbody.innerHTML = students.map(s => {
        let statusBadge;
        const expired = s.expiry_date && new Date(s.expiry_date) < today;
        if (s.status === 'suspended') {
            statusBadge = `<span class="badge badge-red">Suspended</span>`;
        } else if (expired) {
            statusBadge = `<span class="badge badge-amber">Expired</span>`;
        } else {
            statusBadge = `<span class="badge badge-green">Active</span>`;
        }

        const expiryText = s.expiry_date ? formatDate(s.expiry_date) : 'No expiry';

        return `
            <tr>
                <td><strong>${escapeHtml(s.full_name || '—')}</strong></td>
                <td>${statusBadge}</td>
                <td>${expiryText}</td>
                <td>${formatDate(s.created_at)}</td>
                <td class="row-actions">
                    <button class="btn btn-ghost btn-sm" onclick="openEdit('${s.id}')">Edit</button>
                    <button class="btn btn-ghost btn-sm" onclick="resetPw('${s.id}', '${escapeHtml(s.full_name)}')">Reset PW</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteStudent('${s.id}', '${escapeHtml(s.full_name)}')">Delete</button>
                </td>
            </tr>
        `;
    }).join('');
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function formatDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── SEARCH ──
function filterStudents() {
    const q = document.getElementById('search-input').value.toLowerCase();
    renderStudents(allStudents.filter(s => (s.full_name || '').toLowerCase().includes(q)));
}

// ── MODALS ──
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

// ── CREATE SINGLE ──
async function createSingleStudent(e) {
    e.preventDefault();
    const btn = document.getElementById('create-btn');
    const alert = document.getElementById('create-alert');
    alert.style.display = 'none';

    const full_name = document.getElementById('new-name').value.trim();
    const email = document.getElementById('new-email').value.trim();
    const expiry_date = document.getElementById('new-expiry').value || null;

    if (!full_name || !email) {
        showModalAlert(alert, 'Please enter both name and email.', 'error');
        return;
    }
    if (!ensureSafe(alert, [['Full Name', full_name], ['Email', email]])) return;

    btn.disabled = true; btn.textContent = 'Creating…';

    try {
        const res = await apiRequest('POST', '/admin/create-student', { full_name, email, expiry_date });
        closeModal('create-modal');
        document.getElementById('single-form').reset();
        showCredentials([{ full_name: res.full_name, email: res.email, password: res.password }]);
        loadStudents();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Create Account';
    }
}

// ── BULK IMPORT ──
let bulkParsed = [];

function handleCsvUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
        const text = evt.target.result;
        bulkParsed = parseCsv(text);
        renderBulkPreview();
    };
    reader.readAsText(file);
}

function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    const result = [];
    let start = 0;
    if (lines[0] && /name|email/i.test(lines[0])) start = 1;
    for (let i = start; i < lines.length; i++) {
        const parts = lines[i].split(',').map(p => p.trim());
        if (parts.length >= 2 && parts[0] && parts[1]) {
            result.push({ full_name: parts[0], email: parts[1] });
        }
    }
    return result;
}

function renderBulkPreview() {
    const preview = document.getElementById('bulk-preview');
    if (bulkParsed.length === 0) {
        preview.innerHTML = `<div class="loader" style="color:var(--red)">No valid rows found. CSV format: Full Name, Email (one per line).</div>`;
        document.getElementById('bulk-create-btn').disabled = true;
        return;
    }
    preview.innerHTML = `
        <p style="margin-bottom:12px; font-weight:600;">${bulkParsed.length} student(s) ready to import:</p>
        <div class="preview-table-wrap">
            <table class="data-table">
                <thead><tr><th>Full Name</th><th>Email</th></tr></thead>
                <tbody>${bulkParsed.map(s => `<tr><td>${escapeHtml(s.full_name)}</td><td>${escapeHtml(s.email)}</td></tr>`).join('')}</tbody>
            </table>
        </div>
    `;
    document.getElementById('bulk-create-btn').disabled = false;
}

async function runBulkCreate() {
    const btn = document.getElementById('bulk-create-btn');
    const alert = document.getElementById('bulk-alert');
    alert.style.display = 'none';

    if (bulkParsed.length === 0) return;

    const badRow = bulkParsed.find(s => isUnsafeText(s.full_name) || isUnsafeText(s.email));
    if (badRow) {
        showModalAlert(alert, `Invalid format in row "${badRow.full_name || badRow.email}". Scripts or code are not allowed.`, 'error');
        return;
    }

    const expiry_date = document.getElementById('bulk-expiry').value || null;

    btn.disabled = true; btn.textContent = `Creating ${bulkParsed.length} accounts…`;

    try {
        const res = await apiRequest('POST', '/admin/bulk-create-students', {
            students: bulkParsed,
            expiry_date
        });

        closeModal('bulk-modal');
        bulkParsed = [];
        document.getElementById('bulk-preview').innerHTML = '';
        document.getElementById('csv-file').value = '';

        if (res.created.length > 0) {
            showCredentials(res.created);
        }
        if (res.failed_count > 0) {
            alert(`${res.failed_count} account(s) failed. Check for duplicate emails.`);
        }
        loadStudents();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Create All Accounts';
    }
}

// ── CREDENTIALS DISPLAY ──
function showCredentials(list) {
    const body = document.getElementById('creds-body');
    body.innerHTML = `
        <p class="creds-warning">⚠️ Save these credentials now — passwords are shown only once. Hand them to the students.</p>
        <div class="preview-table-wrap">
            <table class="data-table">
                <thead><tr><th>Name</th><th>Email</th><th>Password</th></tr></thead>
                <tbody>${list.map(c => `
                    <tr><td>${escapeHtml(c.full_name)}</td><td>${escapeHtml(c.email)}</td><td><code>${escapeHtml(c.password)}</code></td></tr>
                `).join('')}</tbody>
            </table>
        </div>
    `;
    window._lastCreds = list;
    openModal('creds-modal');
}

function downloadCredsCsv() {
    const list = window._lastCreds || [];
    let csv = 'Full Name,Email,Password\n';
    list.forEach(c => { csv += `"${c.full_name}","${c.email}","${c.password}"\n`; });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mda-credentials-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// ── EDIT ──
function openEdit(id) {
    const s = allStudents.find(x => x.id === id);
    if (!s) return;
    document.getElementById('edit-id').value = s.id;
    document.getElementById('edit-name').value = s.full_name || '';
    document.getElementById('edit-status').value = s.status;
    document.getElementById('edit-expiry').value = s.expiry_date || '';
    document.getElementById('edit-alert').style.display = 'none';
    openModal('edit-modal');
}

async function saveEdit(e) {
    e.preventDefault();
    const btn = document.getElementById('edit-save-btn');
    const alert = document.getElementById('edit-alert');
    alert.style.display = 'none';

    const id = document.getElementById('edit-id').value;
    const full_name = document.getElementById('edit-name').value.trim();
    const status = document.getElementById('edit-status').value;
    const expiry_date = document.getElementById('edit-expiry').value || '';

    if (!ensureSafe(alert, [['Full Name', full_name]])) return;

    btn.disabled = true; btn.textContent = 'Saving…';

    try {
        await apiRequest('PATCH', `/admin/update-student/${id}`, { full_name, status, expiry_date });
        closeModal('edit-modal');
        loadStudents();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Save Changes';
    }
}

// ── RESET PASSWORD ──
async function resetPw(id, name) {
    const ok = await confirmDialog({
        title: 'Reset password?',
        message: `A new password will be generated for ${name}. Their current password will stop working immediately.`,
        confirmText: 'Generate New Password'
    });
    if (!ok) return;
    try {
        const res = await apiRequest('POST', `/admin/reset-password/${id}`);
        showCredentials([{ full_name: name, email: '(unchanged)', password: res.new_password }]);
    } catch (err) {
        alert(`Failed to reset password: ${err.message}`);
    }
}

// ── DELETE ──
async function deleteStudent(id, name) {
    const ok = await confirmDialog({
        title: `Delete ${name}?`,
        message: 'This permanently deletes the student account and all their data. This cannot be undone.',
        confirmText: 'Delete Student',
        danger: true
    });
    if (!ok) return;
    try {
        await apiRequest('DELETE', `/admin/delete-student/${id}`);
        loadStudents();
    } catch (err) {
        alert(`Failed to delete: ${err.message}`);
    }
}

function showModalAlert(el, msg, type) {
    el.className = `alert ${type}`;
    el.textContent = msg;
    el.style.display = 'block';
}
