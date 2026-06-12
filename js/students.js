// Students management page logic. Server-side search / course filter / pagination
// so the list stays fast at thousands of students.

let allStudents = [];          // the current page of rows
let selectedIds = new Set();
let courseMap = {};            // course_id -> name
let studentCourses = {};       // student_id -> [course names] (current page)
let currentPage = 1;
let pageSize = 25;
let totalCount = 0;
let searchQuery = '';
let courseFilter = '';
let searchTimer = null;
let EMAIL_COL = true;          // falls back to false if the profiles.email migration isn't applied yet

// Populate the course-filter dropdown once.
async function loadCourseOptions() {
    const { data, error } = await db.from('courses').select('id, name').order('name', { ascending: true });
    if (error) { console.error('[students] could not load courses:', error); return; }
    courseMap = {};
    const filterSel = document.getElementById('course-filter');
    const createSel = document.getElementById('new-course');
    const bulkSel = document.getElementById('bulk-course');
    (data || []).forEach(c => {
        courseMap[c.id] = c.name;
        if (filterSel) filterSel.appendChild(new Option(c.name, c.id));   // list filter
        if (createSel) createSel.appendChild(new Option(c.name, c.id));   // enrol-on-create
        if (bulkSel) bulkSel.appendChild(new Option(c.name, c.id));       // enrol whole import
    });
}

function onSearchInput() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        searchQuery = (document.getElementById('search-input').value || '').trim();
        currentPage = 1;
        loadStudents();
    }, 300);
}

function onFilterChange() {
    courseFilter = document.getElementById('course-filter').value || '';
    pageSize = parseInt(document.getElementById('page-size').value, 10) || 25;
    currentPage = 1;
    loadStudents();
}

function changePage(delta) {
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const next = currentPage + delta;
    if (next < 1 || next > totalPages) return;
    currentPage = next;
    loadStudents();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadStudents() {
    const tbody = document.getElementById('students-tbody');
    tbody.innerHTML = `<tr><td colspan="7" class="loader">Loading students…</td></tr>`;

    // If filtering by course, get that course's enrolled student IDs first.
    let idFilter = null;
    if (courseFilter) {
        const { data: enr, error: enrErr } = await db
            .from('course_enrollments').select('student_id').eq('course_id', courseFilter);
        if (enrErr) {
            tbody.innerHTML = `<tr><td colspan="7" class="loader" style="color:var(--red)">Couldn't load that course's students: ${escapeHtml(enrErr.message)}</td></tr>`;
            return;
        }
        idFilter = [...new Set((enr || []).map(e => e.student_id))];
        if (idFilter.length === 0) {
            allStudents = []; totalCount = 0;
            renderStudents([]); renderPager();
            return;
        }
    }

    const from = (currentPage - 1) * pageSize;
    const to = from + pageSize - 1;

    const cols = EMAIL_COL
        ? 'id, full_name, email, status, expiry_date, created_at'
        : 'id, full_name, status, expiry_date, created_at';
    let q = db.from('profiles').select(cols, { count: 'exact' }).eq('role', 'student');
    if (idFilter) q = q.in('id', idFilter);
    const term = searchQuery.replace(/[%,()]/g, ' ').trim();   // keep the .or() filter syntax safe
    if (term) q = q.or(EMAIL_COL ? `full_name.ilike.%${term}%,email.ilike.%${term}%` : `full_name.ilike.%${term}%`);
    q = q.order('created_at', { ascending: false }).range(from, to);

    const { data, error, count } = await q;
    if (error) {
        // If the email column isn't there yet, retry name-only so the page still works.
        if (EMAIL_COL && /email/i.test(error.message || '')) { EMAIL_COL = false; return loadStudents(); }
        tbody.innerHTML = `<tr><td colspan="7" class="loader" style="color:var(--red)">Error loading students: ${escapeHtml(error.message)}</td></tr>`;
        return;
    }

    allStudents = data || [];
    totalCount = count || 0;

    // Fetch the enrolled course(s) for just this page of students (<=100 ids, safe).
    studentCourses = {};
    const ids = allStudents.map(s => s.id);
    if (ids.length) {
        const { data: enr, error: cErr } = await db
            .from('course_enrollments').select('student_id, course_id').in('student_id', ids);
        if (cErr) console.error('[students] could not load enrolments:', cErr);
        (enr || []).forEach(e => {
            const nm = courseMap[e.course_id] || 'Course';
            (studentCourses[e.student_id] = studentCourses[e.student_id] || []).push(nm);
        });
    }

    renderStudents(allStudents);
    renderPager();
}

function renderPager() {
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    const info = document.getElementById('pager-info');
    const label = document.getElementById('page-label');
    const prev = document.getElementById('prev-btn');
    const next = document.getElementById('next-btn');
    if (!info) return;
    if (totalCount === 0) {
        info.textContent = 'No students match.';
    } else {
        const start = (currentPage - 1) * pageSize + 1;
        const end = Math.min(currentPage * pageSize, totalCount);
        info.textContent = `Showing ${start}–${end} of ${totalCount} student${totalCount === 1 ? '' : 's'}`;
    }
    label.textContent = `Page ${currentPage} of ${totalPages}`;
    prev.disabled = currentPage <= 1;
    next.disabled = currentPage >= totalPages;
    prev.style.opacity = prev.disabled ? '.4' : '1';
    next.style.opacity = next.disabled ? '.4' : '1';
}

function renderStudents(students) {
    const tbody = document.getElementById('students-tbody');

    if (students.length === 0) {
        const msg = (searchQuery || courseFilter)
            ? 'No students match your search/filter.'
            : 'No students yet. Click "Add Student" or "Bulk Import" to create accounts.';
        tbody.innerHTML = `<tr><td colspan="7" class="loader">${msg}</td></tr>`;
        updateBulkBar();
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
        const courses = studentCourses[s.id] || [];
        const courseCell = courses.length
            ? courses.map(c => `<span class="badge badge-blue" style="margin:2px 4px 2px 0;">${escapeHtml(c)}</span>`).join('')
            : '<span style="color:var(--text-muted);">— none —</span>';

        return `
            <tr>
                <td><input type="checkbox" class="row-check" ${selectedIds.has(s.id) ? 'checked' : ''} onclick="toggleSelect('${s.id}', this)"></td>
                <td><strong>${escapeHtml(s.full_name || '—')}</strong></td>
                <td>${escapeHtml(s.email || '—')}</td>
                <td>${courseCell}</td>
                <td>${statusBadge}</td>
                <td>${expiryText}</td>
                <td class="row-actions">
                    <button class="btn btn-ghost btn-sm" onclick="openActivity('${s.id}')">Activity</button>
                    <button class="btn btn-ghost btn-sm" onclick="openEdit('${s.id}')">Edit</button>
                    <button class="btn btn-ghost btn-sm" onclick="toggleStatus('${s.id}')">${s.status === 'suspended' ? 'Activate' : 'Block'}</button>
                    <button class="btn btn-ghost btn-sm" onclick="resetPw('${s.id}')">Reset PW</button>
                    <button class="btn btn-ghost btn-sm" onclick="resetMfa('${s.id}')">Reset 2FA</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteStudent('${s.id}')">Delete</button>
                </td>
            </tr>
        `;
    }).join('');
    updateBulkBar();
}

// ── BULK SELECTION ──
function toggleSelect(id, cb) {
    if (cb.checked) selectedIds.add(id); else selectedIds.delete(id);
    updateBulkBar();
}

function toggleSelectAll(cb) {
    // Select/deselect every student on the current page.
    if (cb.checked) allStudents.forEach(s => selectedIds.add(s.id));
    else allStudents.forEach(s => selectedIds.delete(s.id));
    renderStudents(allStudents);
}

function clearSelection() {
    selectedIds.clear();
    const sa = document.getElementById('select-all');
    if (sa) sa.checked = false;
    renderStudents(allStudents);
}

function updateBulkBar() {
    const bar = document.getElementById('bulk-bar');
    const countEl = document.getElementById('bulk-count');
    if (!bar) return;
    bar.style.display = selectedIds.size > 0 ? 'flex' : 'none';
    if (countEl) countEl.textContent = selectedIds.size;
}

function selectedNames() {
    return allStudents.filter(s => selectedIds.has(s.id)).map(s => s.full_name || '—');
}

// Run an async action over each selected student, then refresh.
async function runBulk(actionFn, btnLabelEl) {
    const ids = [...selectedIds];
    let failed = 0;
    const results = await Promise.allSettled(ids.map(id => actionFn(id)));
    results.forEach(r => { if (r.status === 'rejected') failed++; });
    selectedIds.clear();
    const sa = document.getElementById('select-all'); if (sa) sa.checked = false;
    await loadStudents();
    if (failed) alert(`${failed} of ${ids.length} action(s) failed. Please review and try again.`);
}

async function bulkSuspend() {
    if (selectedIds.size === 0) return;
    const ok = await confirmDialog({
        title: `Suspend ${selectedIds.size} student(s)?`,
        message: `These students will be blocked from logging in immediately:\n\n${selectedNames().slice(0, 8).join(', ')}${selectedIds.size > 8 ? '…' : ''}`,
        confirmText: 'Suspend', danger: true
    });
    if (!ok) return;
    await runBulk(id => apiRequest('PATCH', `/admin/update-student/${id}`, { status: 'suspended' }));
}

async function bulkActivate() {
    if (selectedIds.size === 0) return;
    const ok = await confirmDialog({
        title: `Activate ${selectedIds.size} student(s)?`,
        message: `These students will be able to log in again:\n\n${selectedNames().slice(0, 8).join(', ')}${selectedIds.size > 8 ? '…' : ''}`,
        confirmText: 'Activate'
    });
    if (!ok) return;
    await runBulk(id => apiRequest('PATCH', `/admin/update-student/${id}`, { status: 'active' }));
}

async function bulkDelete() {
    if (selectedIds.size === 0) return;
    const ok = await confirmDialog({
        title: `Delete ${selectedIds.size} student(s)?`,
        message: `This permanently deletes these accounts and all their data. This cannot be undone.\n\n${selectedNames().slice(0, 8).join(', ')}${selectedIds.size > 8 ? '…' : ''}`,
        confirmText: 'Delete', danger: true
    });
    if (!ok) return;
    await runBulk(id => apiRequest('DELETE', `/admin/delete-student/${id}`));
}

function openBulkExpiry() {
    if (selectedIds.size === 0) return;
    document.getElementById('bulk-expiry-alert').style.display = 'none';
    document.getElementById('bulk-expiry-date').value = '';
    openModal('bulk-expiry-modal');
}

async function applyBulkExpiry() {
    const btn = document.getElementById('bulk-expiry-btn');
    const expiry_date = document.getElementById('bulk-expiry-date').value || '';
    const count = selectedIds.size;
    const ok = await confirmDialog({
        title: `Set expiry for ${count} student(s)?`,
        message: expiry_date
            ? `All ${count} selected students will expire on ${formatDate(expiry_date)}.`
            : `Expiry will be REMOVED for all ${count} selected students (no expiry).`,
        confirmText: 'Apply'
    });
    if (!ok) return;
    btn.disabled = true; btn.textContent = 'Applying…';
    await runBulk(id => apiRequest('PATCH', `/admin/update-student/${id}`, { expiry_date }));
    btn.disabled = false; btn.textContent = 'Apply to Selected';
    closeModal('bulk-expiry-modal');
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function formatDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
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
    const course_id = document.getElementById('new-course').value || null;

    if (!full_name || !email) {
        showModalAlert(alert, 'Please enter both name and email.', 'error');
        return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        showModalAlert(alert, 'Please enter a valid email address — the student will receive their login details here.', 'error');
        return;
    }
    if (!ensureSafe(alert, [['Full Name', full_name], ['Email', email]])) return;

    btn.disabled = true; btn.textContent = 'Creating…';

    try {
        const res = await apiRequest('POST', '/admin/create-student', { full_name, email, expiry_date, course_id });
        closeModal('create-modal');
        document.getElementById('single-form').reset();
        showCredentials([{ full_name: res.full_name, email: res.email, password: res.password, email_sent: res.email_sent }]);
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
    const course_id = document.getElementById('bulk-course').value || null;

    btn.disabled = true; btn.textContent = `Creating ${bulkParsed.length} accounts…`;

    try {
        const res = await apiRequest('POST', '/admin/bulk-create-students', {
            students: bulkParsed,
            expiry_date,
            course_id
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
    const showMail = list.some(c => c.email_sent !== undefined);
    const anyUnsent = list.some(c => c.email_sent === false);
    const mailCell = (c) => c.email_sent === undefined ? ''
        : (c.email_sent
            ? '<td><span class="badge badge-green">✅ Sent</span></td>'
            : '<td><span class="badge badge-red">⚠️ Not sent</span></td>');
    body.innerHTML = `
        <p class="creds-warning">⚠️ Save these credentials now — passwords are shown only once.${showMail ? ' A welcome email was sent automatically where shown below; hand over manually for any marked "Not sent."' : ' Hand them to the students.'}</p>
        ${anyUnsent ? '<div class="alert error" style="display:block;margin-bottom:12px;">Some welcome emails could not be sent (check the email address or Resend setup). Those students must be given their details manually.</div>' : ''}
        <div class="preview-table-wrap">
            <table class="data-table">
                <thead><tr><th>Name</th><th>Email</th><th>Password</th>${showMail ? '<th>Welcome email</th>' : ''}</tr></thead>
                <tbody>${list.map(c => `
                    <tr><td>${escapeHtml(c.full_name)}</td><td>${escapeHtml(c.email)}</td><td><code>${escapeHtml(c.password)}</code></td>${showMail ? mailCell(c) : ''}</tr>
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

// ── LOGIN ACTIVITY REPORT ──
function openActivity(id) {
    window.location.href = `activity.html?id=${encodeURIComponent(id)}`;
}

// ── RESET 2FA (lockout recovery) ──
async function resetMfa(id) {
    const s = allStudents.find(x => x.id === id);
    const name = s ? (s.full_name || 'this student') : 'this student';
    const ok = await confirmDialog({
        title: `Reset 2FA for ${name}?`,
        message: 'This removes their two-factor authentication so they can log in with just their password (then set 2FA up again). Use this if they lost their authenticator app.',
        confirmText: 'Reset 2FA'
    });
    if (!ok) return;
    try {
        const r = await apiRequest('POST', `/admin/clear-mfa/${id}`);
        alert(r.removed ? '2FA has been reset for this student.' : 'This student had no 2FA set.');
    } catch (err) { alert(`Failed to reset 2FA: ${err.message}`); }
}

// ── BLOCK / ACTIVATE (suspend without deleting) ──
async function toggleStatus(id) {
    const s = allStudents.find(x => x.id === id);
    if (!s) return;
    const suspend = s.status !== 'suspended';
    const ok = await confirmDialog({
        title: suspend ? `Block ${s.full_name || 'this student'}?` : `Activate ${s.full_name || 'this student'}?`,
        message: suspend
            ? 'They will be blocked from logging in immediately. Their account and all data are kept — reactivate anytime (e.g. when payment resumes).'
            : 'They will be able to log in again right away.',
        confirmText: suspend ? 'Block' : 'Activate',
        danger: suspend
    });
    if (!ok) return;
    try {
        await apiRequest('PATCH', `/admin/update-student/${id}`, { status: suspend ? 'suspended' : 'active' });
        loadStudents();
    } catch (err) {
        alert(`Failed to update status: ${err.message}`);
    }
}

// ── RESET PASSWORD ──
async function resetPw(id) {
    const s = allStudents.find(x => x.id === id);
    const name = s ? (s.full_name || 'this student') : 'this student';
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
async function deleteStudent(id) {
    const s = allStudents.find(x => x.id === id);
    const name = s ? (s.full_name || 'this student') : 'this student';
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
