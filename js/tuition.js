// Premedical Tuition (superadmin) — set tuition, record payments, track balances.

function escapeHtml(s) { return s ? String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])) : ''; }
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function showModalAlert(el, msg, type) { el.className = `alert ${type}`; el.textContent = msg; el.style.display = 'block'; }

let CURRENT_UID = null;
let TDEFAULT = 0;             // general premed tuition
let CURRENCY = 'NIS';
let ROSTER = [];             // [{id, name, courseIds:Set, courseNames:[]}]
let COURSES_LIST = [];
let TUI = {};                // student_id -> {total_amount, deadline}
let PAY = {};                // student_id -> [{id, amount, paid_on, note}]
let tCourse = '', tSearch = '', tStatus = '';

const STATUS_LABEL = { paid: 'Completed', progress: 'In progress', overdue: 'Overdue', notset: 'Not set' };
function badge(st) { return `<span class="badge ${st}">${STATUS_LABEL[st]}</span>`; }
function todayIso() { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`; }
function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function fmtMoney(n) { return `${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${CURRENCY}`; }
function fmtDate(d) { return d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''; }

async function loadTuition() {
    const box = document.getElementById('tuition-list');
    box.innerHTML = `<div class="loader">Loading…</div>`;

    const [setRes, enrRes, courseRes, tuiRes, payRes] = await Promise.all([
        db.from('app_settings').select('key, value').in('key', ['premed_tuition_default', 'tuition_currency']),
        db.from('course_enrollments').select('student_id, course_id'),
        db.from('courses').select('id, name').order('name', { ascending: true }),
        db.from('student_tuition').select('student_id, total_amount, deadline'),
        db.from('tuition_payments').select('id, student_id, amount, paid_on, note').order('paid_on', { ascending: true })
    ]);

    const settings = {}; (setRes.data || []).forEach(r => { settings[r.key] = r.value; });
    TDEFAULT = num(settings.premed_tuition_default);
    CURRENCY = (settings.tuition_currency || 'NIS').trim() || 'NIS';
    COURSES_LIST = courseRes.data || [];
    const courseName = id => (COURSES_LIST.find(c => c.id === id) || {}).name || 'Course';

    TUI = {}; (tuiRes.data || []).forEach(r => { TUI[r.student_id] = { total_amount: r.total_amount, deadline: r.deadline }; });
    PAY = {}; (payRes.data || []).forEach(p => { (PAY[p.student_id] = PAY[p.student_id] || []).push(p); });

    // Roster = enrolled students (+ anyone who already has tuition/payments).
    const enrolls = enrRes.data || [];
    const ids = [...new Set([...enrolls.map(e => e.student_id), ...Object.keys(TUI), ...Object.keys(PAY)])];
    let nameById = {};
    if (ids.length) {
        const { data: profs } = await db.from('profiles').select('id, full_name').in('id', ids);
        (profs || []).forEach(p => { nameById[p.id] = p.full_name; });
    }
    const map = {};
    const ensure = sid => (map[sid] = map[sid] || { id: sid, name: nameById[sid] || '', courseIds: new Set(), courseNames: [] });
    enrolls.forEach(e => { const s = ensure(e.student_id); if (!s.courseIds.has(e.course_id)) { s.courseIds.add(e.course_id); s.courseNames.push(courseName(e.course_id)); } });
    ids.forEach(ensure);
    ROSTER = Object.values(map);

    // Header inputs + currency labels.
    document.getElementById('gen-tuition').value = TDEFAULT || '';
    document.getElementById('gen-currency').value = CURRENCY;
    document.getElementById('mg-cur1').textContent = CURRENCY;
    document.getElementById('mg-cur2').textContent = CURRENCY;

    const sel = document.getElementById('t-course');
    const cur = tCourse;
    sel.innerHTML = `<option value="">All courses</option>` + COURSES_LIST.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    sel.value = COURSES_LIST.some(c => c.id === cur) ? cur : '';
    tCourse = sel.value;

    renderTuition();
}

function onTuitionFilter() {
    tCourse = document.getElementById('t-course').value;
    tSearch = (document.getElementById('t-search').value || '').trim().toLowerCase();
    tStatus = document.getElementById('t-status').value;
    renderTuition();
}

// Compute a student's standing.
function standing(sid) {
    const row = TUI[sid];
    const hasRow = !!row;
    const total = hasRow ? num(row.total_amount) : TDEFAULT;
    const paid = (PAY[sid] || []).reduce((s, p) => s + num(p.amount), 0);
    const left = Math.max(total - paid, 0);
    const completed = hasRow && total > 0 && paid >= total;
    const overdue = !completed && hasRow && row.deadline && row.deadline < todayIso();
    const status = !hasRow ? 'notset' : (completed ? 'paid' : (overdue ? 'overdue' : 'progress'));
    return { hasRow, total, paid, left, completed, overdue, status, deadline: hasRow ? row.deadline : null };
}

const STATUS_ORDER = { overdue: 0, progress: 1, notset: 2, paid: 3 };

function renderTuition() {
    const box = document.getElementById('tuition-list');
    let rows = ROSTER.slice();
    if (tCourse) rows = rows.filter(s => s.courseIds.has(tCourse));
    if (tSearch) rows = rows.filter(s => (s.name || '').toLowerCase().includes(tSearch));

    const withStanding = rows.map(s => ({ s, st: standing(s.id) }));

    // Summary over the course/search cohort (before status filter).
    const total = withStanding.length;
    const completed = withStanding.filter(x => x.st.status === 'paid').length;
    const overdue = withStanding.filter(x => x.st.status === 'overdue').length;
    const notset = withStanding.filter(x => x.st.status === 'notset').length;
    document.getElementById('t-summary').innerHTML = total
        ? `<strong>${total}</strong> student${total === 1 ? '' : 's'} ·
           <span style="color:#16a34a;font-weight:600;">${completed} completed</span> ·
           <span style="color:#dc2626;font-weight:600;">${overdue} overdue</span> ·
           <span style="color:#92400e;font-weight:600;">${notset} not set</span>`
        : '';

    let list = withStanding;
    if (tStatus) list = list.filter(x => x.st.status === tStatus);
    list.sort((a, b) => (STATUS_ORDER[a.st.status] - STATUS_ORDER[b.st.status]) || (a.s.name || '').localeCompare(b.s.name || ''));

    if (list.length === 0) {
        box.innerHTML = `<div class="empty-state" style="padding:36px;"><p>${total ? 'No students match these filters.' : 'No students enrolled yet.'}</p></div>`;
        return;
    }

    const head = `<tr><th>Student</th><th>Course</th><th>Total</th><th>Paid</th><th>Left</th><th>Status</th><th>Deadline</th><th></th></tr>`;
    const body = list.map(({ s, st }) => {
        const courses = s.courseNames.length ? s.courseNames.map(c => escapeHtml(c)).join(', ') : '<span class="hint">—</span>';
        const deadline = st.deadline ? `<span style="${st.overdue ? 'color:#dc2626;font-weight:600;' : ''}">${escapeHtml(fmtDate(st.deadline))}</span>` : '<span class="hint">—</span>';
        const totalCell = st.hasRow ? fmtMoney(st.total) : `<span class="hint">${fmtMoney(TDEFAULT)} (default)</span>`;
        return `<tr>
            <td><strong>${escapeHtml(s.name || '—')}</strong></td>
            <td style="font-size:13px;color:var(--text-muted);">${courses}</td>
            <td class="money">${totalCell}</td>
            <td class="money" style="color:#16a34a;">${fmtMoney(st.paid)}</td>
            <td class="money" style="color:${st.left > 0 ? '#b45309' : 'var(--text-muted)'};">${fmtMoney(st.left)}</td>
            <td>${badge(st.status)}</td>
            <td>${deadline}</td>
            <td><button class="btn btn-ghost btn-sm" onclick="openManage('${s.id}')">Manage</button></td>
        </tr>`;
    }).join('');
    box.innerHTML = `<div class="panel" style="overflow-x:auto;"><table class="data-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

// ── GENERAL SETTINGS ──
async function saveGeneral() {
    const note = document.getElementById('gen-saved');
    const amount = num(document.getElementById('gen-tuition').value);
    const currency = (document.getElementById('gen-currency').value || 'NIS').trim() || 'NIS';
    const res = await db.from('app_settings').upsert([
        { key: 'premed_tuition_default', value: String(amount), updated_at: new Date().toISOString() },
        { key: 'tuition_currency', value: currency, updated_at: new Date().toISOString() }
    ], { onConflict: 'key' });
    if (res.error) { note.textContent = "Couldn't save"; note.style.color = 'var(--red)'; return; }
    TDEFAULT = amount; CURRENCY = currency;
    document.getElementById('mg-cur1').textContent = CURRENCY;
    document.getElementById('mg-cur2').textContent = CURRENCY;
    note.textContent = 'Saved ✓'; note.style.color = 'var(--green)';
    setTimeout(() => { note.textContent = ''; }, 1800);
    renderTuition();
}

async function applyDefaultToUnset() {
    const targets = ROSTER.filter(s => !TUI[s.id]);
    if (!targets.length) { await confirmDialog({ title: 'Nothing to do', message: 'Every student already has a tuition set.', confirmText: 'OK', cancelText: 'Close' }); return; }
    const ok = await confirmDialog({
        title: 'Set tuition for unset students?',
        message: `${targets.length} student(s) have no tuition set. Give each of them the current general amount of ${fmtMoney(TDEFAULT)}? You can still adjust any of them individually afterward.`,
        confirmText: 'Set them'
    });
    if (!ok) return;
    const rows = targets.map(s => ({ student_id: s.id, total_amount: TDEFAULT, updated_at: new Date().toISOString() }));
    const res = await db.from('student_tuition').upsert(rows, { onConflict: 'student_id' });
    if (res.error) { await confirmDialog({ title: 'Could not save', message: res.error.message, confirmText: 'OK', cancelText: 'Close' }); return; }
    loadTuition();
}

// ── MANAGE A STUDENT ──
function openManage(sid) {
    const s = ROSTER.find(x => x.id === sid);
    document.getElementById('mg-alert').style.display = 'none';
    document.getElementById('mg-student').value = sid;
    document.getElementById('mg-title').textContent = `Tuition — ${s ? s.name : 'Student'}`;
    const row = TUI[sid];
    document.getElementById('mg-total').value = row ? num(row.total_amount) : (TDEFAULT || '');
    document.getElementById('mg-deadline').value = (row && row.deadline) ? row.deadline : '';
    document.getElementById('pay-amount').value = '';
    document.getElementById('pay-date').value = todayIso();
    document.getElementById('pay-note').value = '';
    renderManage(sid);
    openModal('manage-modal');
}

function renderManage(sid) {
    const st = standing(sid);
    document.getElementById('mg-sum-total').textContent = fmtMoney(st.total);
    document.getElementById('mg-sum-paid').textContent = fmtMoney(st.paid);
    document.getElementById('mg-sum-left').textContent = fmtMoney(st.left);
    document.getElementById('mg-sum-status').innerHTML = badge(st.status);

    const pays = (PAY[sid] || []).slice().sort((a, b) => (a.paid_on || '').localeCompare(b.paid_on || ''));
    const box = document.getElementById('mg-payments');
    box.innerHTML = pays.length ? pays.map(p => `
        <div class="pay-row">
            <div>
                <strong class="money">${fmtMoney(p.amount)}</strong>
                <span class="hint" style="margin-left:8px;">${escapeHtml(fmtDate(p.paid_on))}${p.note ? ' · ' + escapeHtml(p.note) : ''}</span>
            </div>
            <button class="btn btn-danger btn-sm" onclick="deletePayment('${p.id}','${sid}')">Remove</button>
        </div>`).join('') : `<p class="hint">No payments recorded yet.</p>`;
}

async function saveTuition() {
    const sid = document.getElementById('mg-student').value;
    const alert = document.getElementById('mg-alert');
    alert.style.display = 'none';
    const total = num(document.getElementById('mg-total').value);
    const deadline = document.getElementById('mg-deadline').value || null;
    if (total < 0) { showModalAlert(alert, 'Total must be 0 or more.', 'error'); return; }
    const btn = document.getElementById('mg-save-btn'); btn.disabled = true; btn.textContent = 'Saving…';
    try {
        const res = await db.from('student_tuition').upsert(
            { student_id: sid, total_amount: total, deadline, updated_at: new Date().toISOString() },
            { onConflict: 'student_id' });
        if (res.error) throw new Error(res.error.message);
        TUI[sid] = { total_amount: total, deadline };
        showModalAlert(alert, 'Saved.', 'success');
        renderManage(sid);
        renderTuition();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Save total & deadline';
    }
}

async function addPayment() {
    const sid = document.getElementById('mg-student').value;
    const alert = document.getElementById('mg-alert');
    alert.style.display = 'none';
    const amount = num(document.getElementById('pay-amount').value);
    const paid_on = document.getElementById('pay-date').value || todayIso();
    const note = document.getElementById('pay-note').value.trim() || null;
    if (amount <= 0) { showModalAlert(alert, 'Enter a payment amount greater than 0.', 'error'); return; }
    // Ensure a tuition row exists (snapshot) so the total is locked in.
    if (!TUI[sid]) {
        const total = num(document.getElementById('mg-total').value) || TDEFAULT;
        await db.from('student_tuition').upsert({ student_id: sid, total_amount: total, updated_at: new Date().toISOString() }, { onConflict: 'student_id' });
        TUI[sid] = { total_amount: total, deadline: null };
    }
    const res = await db.from('tuition_payments').insert({ student_id: sid, amount, paid_on, note, created_by: CURRENT_UID }).select('id').single();
    if (res.error) { showModalAlert(alert, res.error.message, 'error'); return; }
    (PAY[sid] = PAY[sid] || []).push({ id: res.data.id, student_id: sid, amount, paid_on, note });
    document.getElementById('pay-amount').value = '';
    document.getElementById('pay-note').value = '';
    renderManage(sid);
    renderTuition();
}

async function deletePayment(payId, sid) {
    const ok = await confirmDialog({ title: 'Remove this payment?', message: 'This deletes the recorded payment and recalculates the balance. This cannot be undone.', confirmText: 'Remove', danger: true });
    if (!ok) return;
    const res = await db.from('tuition_payments').delete().eq('id', payId);
    if (res.error) { await confirmDialog({ title: 'Could not remove', message: res.error.message, confirmText: 'OK', cancelText: 'Close' }); return; }
    PAY[sid] = (PAY[sid] || []).filter(p => p.id !== payId);
    renderManage(sid);
    renderTuition();
}
