// Tuition (superadmin) — price per program (course), balance per (student × program).

function escapeHtml(s) { return s ? String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])) : ''; }
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function showModalAlert(el, msg, type) { el.className = `alert ${type}`; el.textContent = msg; el.style.display = 'block'; }

let CURRENT_UID = null;
let COURSES = [];            // [{id, name, tuition_amount, tuition_currency}]
let ENROLL = [];             // [{student_id, course_id}]
let NAME = {};               // student_id -> full_name
let TUI = {};                // `${sid}_${cid}` -> {total_amount, deadline}
let PAY = {};                // `${sid}_${cid}` -> [{id, amount, paid_on, note}]
let tCourse = '', tSearch = '', tStatus = '';

const STATUS_LABEL = { paid: 'Completed', progress: 'In progress', overdue: 'Overdue', notset: 'Not set' };
const STATUS_ORDER = { overdue: 0, progress: 1, notset: 2, paid: 3 };
function badge(st) { return `<span class="badge ${st}">${STATUS_LABEL[st]}</span>`; }
function todayIso() { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`; }
function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function fmtMoney(n, cur) { return `${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${cur || ''}`.trim(); }
function fmtDate(d) { return d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''; }
function courseById(id) { return COURSES.find(c => c.id === id) || {}; }
function key(sid, cid) { return `${sid}_${cid}`; }

async function loadTuition() {
    const box = document.getElementById('tuition-list');
    box.innerHTML = `<div class="loader">Loading…</div>`;

    const [courseRes, enrRes, tuiRes, payRes] = await Promise.all([
        db.from('courses').select('id, name, tuition_amount, tuition_currency').order('name', { ascending: true }),
        db.from('course_enrollments').select('student_id, course_id'),
        db.from('student_tuition').select('student_id, course_id, total_amount, deadline'),
        db.from('tuition_payments').select('id, student_id, course_id, amount, paid_on, note').order('paid_on', { ascending: true })
    ]);
    COURSES = courseRes.data || [];
    ENROLL = enrRes.data || [];
    TUI = {}; (tuiRes.data || []).forEach(r => { TUI[key(r.student_id, r.course_id)] = { total_amount: r.total_amount, deadline: r.deadline }; });
    PAY = {}; (payRes.data || []).forEach(p => { (PAY[key(p.student_id, p.course_id)] = PAY[key(p.student_id, p.course_id)] || []).push(p); });

    const ids = [...new Set(ENROLL.map(e => e.student_id))];
    NAME = {};
    if (ids.length) {
        const { data: profs } = await db.from('profiles').select('id, full_name').in('id', ids);
        (profs || []).forEach(p => { NAME[p.id] = p.full_name; });
    }

    const sel = document.getElementById('t-course');
    const cur = tCourse;
    sel.innerHTML = `<option value="">All programs</option>` + COURSES.map(c => {
        const priced = c.tuition_amount != null ? ` — ${fmtMoney(c.tuition_amount, c.tuition_currency)}` : ' — no price';
        return `<option value="${c.id}">${escapeHtml(c.name)}${escapeHtml(priced)}</option>`;
    }).join('');
    sel.value = COURSES.some(c => c.id === cur) ? cur : '';
    tCourse = sel.value;

    renderPricePanel();
    renderTuition();
}

function onTuitionFilter() {
    tCourse = document.getElementById('t-course').value;
    tSearch = (document.getElementById('t-search').value || '').trim().toLowerCase();
    tStatus = document.getElementById('t-status').value;
    renderPricePanel();
    renderTuition();
}

function renderPricePanel() {
    const panel = document.getElementById('price-panel');
    const hint = document.getElementById('price-hint');
    if (!tCourse) { panel.style.display = 'none'; hint.style.display = 'block'; return; }
    const c = courseById(tCourse);
    panel.style.display = 'block'; hint.style.display = 'none';
    document.getElementById('price-course-name').textContent = c.name || 'this program';
    document.getElementById('course-price').value = (c.tuition_amount != null) ? num(c.tuition_amount) : '';
    document.getElementById('course-currency').value = c.tuition_currency || 'NIS';
    document.getElementById('price-saved').textContent = '';
}

// Standing for one (student, course).
function standing(sid, cid) {
    const c = courseById(cid);
    const row = TUI[key(sid, cid)];
    const hasRow = !!row;
    const priceSet = c.tuition_amount != null;
    const hasPrice = hasRow || priceSet;
    const total = hasRow ? num(row.total_amount) : (priceSet ? num(c.tuition_amount) : 0);
    const paid = (PAY[key(sid, cid)] || []).reduce((s, p) => s + num(p.amount), 0);
    const left = Math.max(total - paid, 0);
    const completed = hasPrice && total > 0 && paid >= total;
    const overdue = !completed && hasRow && row.deadline && row.deadline < todayIso();
    const status = !hasPrice ? 'notset' : (completed ? 'paid' : (overdue ? 'overdue' : 'progress'));
    return { hasRow, hasPrice, total, paid, left, completed, overdue, status, deadline: hasRow ? row.deadline : null, currency: c.tuition_currency || 'NIS' };
}

// Which (student, course) lines to show.
function buildLines() {
    const lines = [];
    ENROLL.forEach(e => {
        const c = courseById(e.course_id);
        if (!c.id) return;
        if (tCourse) {
            if (e.course_id !== tCourse) return;            // specific program: all its enrolments
        } else {
            // All programs: only priced ones, or where a tuition record exists.
            if (c.tuition_amount == null && !TUI[key(e.student_id, e.course_id)]) return;
        }
        lines.push({ sid: e.student_id, cid: e.course_id, name: NAME[e.student_id] || '', cname: c.name });
    });
    return lines;
}

function renderTuition() {
    const box = document.getElementById('tuition-list');
    let lines = buildLines();
    if (tSearch) lines = lines.filter(l => (l.name || '').toLowerCase().includes(tSearch));

    const withStanding = lines.map(l => ({ l, st: standing(l.sid, l.cid) }));
    const total = withStanding.length;
    const completed = withStanding.filter(x => x.st.status === 'paid').length;
    const overdue = withStanding.filter(x => x.st.status === 'overdue').length;
    const notset = withStanding.filter(x => x.st.status === 'notset').length;
    document.getElementById('t-summary').innerHTML = total
        ? `<strong>${total}</strong> ${total === 1 ? 'entry' : 'entries'} ·
           <span style="color:#16a34a;font-weight:600;">${completed} completed</span> ·
           <span style="color:#dc2626;font-weight:600;">${overdue} overdue</span> ·
           <span style="color:#92400e;font-weight:600;">${notset} not set</span>`
        : '';

    let list = withStanding;
    if (tStatus) list = list.filter(x => x.st.status === tStatus);
    list.sort((a, b) => (STATUS_ORDER[a.st.status] - STATUS_ORDER[b.st.status])
        || (a.l.name || '').localeCompare(b.l.name || '')
        || (a.l.cname || '').localeCompare(b.l.cname || ''));

    if (list.length === 0) {
        box.innerHTML = `<div class="empty-state" style="padding:36px;"><p>${total ? 'No entries match these filters.' : (tCourse ? 'No students enrolled in this program yet.' : 'No priced programs yet. Pick a program above and set its price.')}</p></div>`;
        return;
    }

    const head = `<tr><th>Student</th><th>Program</th><th>Total</th><th>Paid</th><th>Left</th><th>Status</th><th>Deadline</th><th></th></tr>`;
    const body = list.map(({ l, st }) => {
        const deadline = st.deadline ? `<span style="${st.overdue ? 'color:#dc2626;font-weight:600;' : ''}">${escapeHtml(fmtDate(st.deadline))}</span>` : '<span class="hint">—</span>';
        const totalCell = st.hasPrice ? fmtMoney(st.total, st.currency) : '<span class="hint">— (set price)</span>';
        return `<tr>
            <td><strong>${escapeHtml(l.name || '—')}</strong></td>
            <td style="font-size:13px;color:var(--text-muted);">${escapeHtml(l.cname)}</td>
            <td class="money">${totalCell}</td>
            <td class="money" style="color:#16a34a;">${fmtMoney(st.paid, st.currency)}</td>
            <td class="money" style="color:${st.left > 0 ? '#b45309' : 'var(--text-muted)'};">${fmtMoney(st.left, st.currency)}</td>
            <td>${badge(st.status)}</td>
            <td>${deadline}</td>
            <td><button class="btn btn-ghost btn-sm" onclick="openManage('${l.sid}','${l.cid}')">Manage</button></td>
        </tr>`;
    }).join('');
    box.innerHTML = `<div class="panel" style="overflow-x:auto;"><table class="data-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

// ── PROGRAM PRICE ──
async function saveCoursePrice() {
    if (!tCourse) return;
    const note = document.getElementById('price-saved');
    const amount = num(document.getElementById('course-price').value);
    const currency = (document.getElementById('course-currency').value || 'NIS').trim() || 'NIS';
    const res = await db.from('courses').update({ tuition_amount: amount, tuition_currency: currency }).eq('id', tCourse);
    if (res.error) { note.textContent = "Couldn't save"; note.style.color = 'var(--red)'; return; }
    const c = courseById(tCourse); c.tuition_amount = amount; c.tuition_currency = currency;
    note.textContent = 'Saved ✓'; note.style.color = 'var(--green)';
    setTimeout(() => { note.textContent = ''; }, 1800);
    loadTuition();
}

async function applyPriceToUnset() {
    if (!tCourse) return;
    const c = courseById(tCourse);
    if (c.tuition_amount == null) { await confirmDialog({ title: 'Set a price first', message: 'Set and save this program’s price before applying it.', confirmText: 'OK', cancelText: 'Close' }); return; }
    const targets = ENROLL.filter(e => e.course_id === tCourse && !TUI[key(e.student_id, tCourse)]);
    if (!targets.length) { await confirmDialog({ title: 'Nothing to do', message: 'Every enrolled student already has a tuition set for this program.', confirmText: 'OK', cancelText: 'Close' }); return; }
    const ok = await confirmDialog({
        title: 'Apply price to students?',
        message: `${targets.length} enrolled student(s) have no tuition set for ${c.name}. Give each of them the current price of ${fmtMoney(c.tuition_amount, c.tuition_currency)}? You can still adjust any individually.`,
        confirmText: 'Apply price'
    });
    if (!ok) return;
    const rows = targets.map(e => ({ student_id: e.student_id, course_id: tCourse, total_amount: c.tuition_amount, updated_at: new Date().toISOString() }));
    const res = await db.from('student_tuition').upsert(rows, { onConflict: 'student_id,course_id' });
    if (res.error) { await confirmDialog({ title: 'Could not save', message: res.error.message, confirmText: 'OK', cancelText: 'Close' }); return; }
    loadTuition();
}

// ── MANAGE A STUDENT × PROGRAM ──
function openManage(sid, cid) {
    const c = courseById(cid);
    document.getElementById('mg-alert').style.display = 'none';
    document.getElementById('mg-student').value = sid;
    document.getElementById('mg-course').value = cid;
    document.getElementById('mg-title').textContent = `Tuition — ${NAME[sid] || 'Student'} · ${c.name || ''}`;
    document.getElementById('mg-cur1').textContent = c.tuition_currency || 'NIS';
    document.getElementById('mg-cur2').textContent = c.tuition_currency || 'NIS';
    const row = TUI[key(sid, cid)];
    document.getElementById('mg-total').value = row ? num(row.total_amount) : (c.tuition_amount != null ? num(c.tuition_amount) : '');
    document.getElementById('mg-deadline').value = (row && row.deadline) ? row.deadline : '';
    document.getElementById('pay-amount').value = '';
    document.getElementById('pay-date').value = todayIso();
    document.getElementById('pay-note').value = '';
    renderManage(sid, cid);
    openModal('manage-modal');
}

function renderManage(sid, cid) {
    const st = standing(sid, cid);
    document.getElementById('mg-sum-total').textContent = fmtMoney(st.total, st.currency);
    document.getElementById('mg-sum-paid').textContent = fmtMoney(st.paid, st.currency);
    document.getElementById('mg-sum-left').textContent = fmtMoney(st.left, st.currency);
    document.getElementById('mg-sum-status').innerHTML = badge(st.status);

    const pays = (PAY[key(sid, cid)] || []).slice().sort((a, b) => (a.paid_on || '').localeCompare(b.paid_on || ''));
    const box = document.getElementById('mg-payments');
    box.innerHTML = pays.length ? pays.map(p => `
        <div class="pay-row">
            <div>
                <strong class="money">${fmtMoney(p.amount, st.currency)}</strong>
                <span class="hint" style="margin-left:8px;">${escapeHtml(fmtDate(p.paid_on))}${p.note ? ' · ' + escapeHtml(p.note) : ''}</span>
            </div>
            <button class="btn btn-danger btn-sm" onclick="deletePayment('${p.id}','${sid}','${cid}')">Remove</button>
        </div>`).join('') : `<p class="hint">No payments recorded yet.</p>`;
}

async function saveTuition() {
    const sid = document.getElementById('mg-student').value;
    const cid = document.getElementById('mg-course').value;
    const alert = document.getElementById('mg-alert');
    alert.style.display = 'none';
    const total = num(document.getElementById('mg-total').value);
    const deadline = document.getElementById('mg-deadline').value || null;
    if (total < 0) { showModalAlert(alert, 'Total must be 0 or more.', 'error'); return; }
    const btn = document.getElementById('mg-save-btn'); btn.disabled = true; btn.textContent = 'Saving…';
    try {
        const res = await db.from('student_tuition').upsert(
            { student_id: sid, course_id: cid, total_amount: total, deadline, updated_at: new Date().toISOString() },
            { onConflict: 'student_id,course_id' });
        if (res.error) throw new Error(res.error.message);
        TUI[key(sid, cid)] = { total_amount: total, deadline };
        showModalAlert(alert, 'Saved.', 'success');
        renderManage(sid, cid);
        renderTuition();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Save total & deadline';
    }
}

async function addPayment() {
    const sid = document.getElementById('mg-student').value;
    const cid = document.getElementById('mg-course').value;
    const alert = document.getElementById('mg-alert');
    alert.style.display = 'none';
    const amount = num(document.getElementById('pay-amount').value);
    const paid_on = document.getElementById('pay-date').value || todayIso();
    const note = document.getElementById('pay-note').value.trim() || null;
    if (amount <= 0) { showModalAlert(alert, 'Enter a payment amount greater than 0.', 'error'); return; }
    if (!TUI[key(sid, cid)]) {
        const c = courseById(cid);
        const total = num(document.getElementById('mg-total').value) || (c.tuition_amount != null ? num(c.tuition_amount) : 0);
        await db.from('student_tuition').upsert({ student_id: sid, course_id: cid, total_amount: total, updated_at: new Date().toISOString() }, { onConflict: 'student_id,course_id' });
        TUI[key(sid, cid)] = { total_amount: total, deadline: null };
    }
    const res = await db.from('tuition_payments').insert({ student_id: sid, course_id: cid, amount, paid_on, note, created_by: CURRENT_UID }).select('id').single();
    if (res.error) { showModalAlert(alert, res.error.message, 'error'); return; }
    (PAY[key(sid, cid)] = PAY[key(sid, cid)] || []).push({ id: res.data.id, amount, paid_on, note });
    document.getElementById('pay-amount').value = '';
    document.getElementById('pay-note').value = '';
    renderManage(sid, cid);
    renderTuition();
}

async function deletePayment(payId, sid, cid) {
    const ok = await confirmDialog({ title: 'Remove this payment?', message: 'This deletes the recorded payment and recalculates the balance. This cannot be undone.', confirmText: 'Remove', danger: true });
    if (!ok) return;
    const res = await db.from('tuition_payments').delete().eq('id', payId);
    if (res.error) { await confirmDialog({ title: 'Could not remove', message: res.error.message, confirmText: 'OK', cancelText: 'Close' }); return; }
    PAY[key(sid, cid)] = (PAY[key(sid, cid)] || []).filter(p => p.id !== payId);
    renderManage(sid, cid);
    renderTuition();
}
