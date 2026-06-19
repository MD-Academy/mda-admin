// Attendance — per-course class sessions (rows = students, cols = class dates) + % attended.
// Everyone starts present when a class is opened; the teacher flips absentees. Date is server-locked.

let CURRENT_UID = null;
let ADMIN_NAME = '';
let atCourses = [];
let atCourseId = '';
let atStudents = [];        // current page of {id, full_name}
let atSessions = [];        // [{id, session_date, opened_by_name}] for the course (date asc)
let atMarks = {};           // `${studentId}_${sessionId}` -> present(bool)
let atStudentIds = [];      // ALL enrolled student ids for the course
let atPage = 1, atPageSize = 50, atTotal = 0, atSearch = '', atSearchTimer = null;

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function showModalAlert(el, msg, type) { el.className = `alert ${type}`; el.textContent = msg; el.style.display = 'block'; }
function fmtSession(d) { return d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''; }
function pctColor(p) { return p >= 100 ? 'att-green' : (p >= 75 ? 'att-amber' : 'att-red'); }

async function loadCourses(preselect) {
    const { data, error } = await db.from('courses').select('id, name').order('created_at', { ascending: false });
    if (error) return;
    atCourses = data || [];
    const sel = document.getElementById('course-select');
    atCourses.forEach(c => {
        const o = document.createElement('option');
        o.value = c.id; o.textContent = c.name;
        sel.appendChild(o);
    });
    if (preselect && atCourses.some(c => c.id === preselect)) {
        // Arrived straight from a course — no need to choose it again. Hide the picker, show its name.
        const c = atCourses.find(x => x.id === preselect);
        sel.value = preselect;
        sel.style.display = 'none';
        const lbl = document.getElementById('course-name-label');
        if (lbl) { lbl.textContent = c.name; lbl.style.display = 'block'; }
        const back = document.getElementById('back-link'), backTxt = document.getElementById('back-link-text');
        if (back) back.href = `course.html?id=${encodeURIComponent(preselect)}`;
        if (backTxt) backTxt.textContent = 'Back to course';
        onCourseChange();
    }
}

async function onCourseChange() {
    atCourseId = document.getElementById('course-select').value;
    const container = document.getElementById('attendance-container');
    document.getElementById('pager').style.display = 'none';
    document.getElementById('open-class-btn').style.display = atCourseId ? 'inline-flex' : 'none';
    if (!atCourseId) { container.innerHTML = `<div class="loader">Choose a course to see its attendance sheet.</div>`; return; }
    container.innerHTML = `<div class="loader">Loading attendance…</div>`;
    atPage = 1; atSearch = '';
    const sb = document.getElementById('at-search'); if (sb) sb.value = '';

    const [enrRes, sesRes] = await Promise.all([
        db.from('course_enrollments').select('student_id').eq('course_id', atCourseId),
        db.from('class_sessions').select('id, session_date, opened_by_name').eq('course_id', atCourseId)
            .order('session_date', { ascending: true }).order('created_at', { ascending: true })
    ]);
    atStudentIds = [...new Set((enrRes.data || []).map(r => r.student_id))];
    atSessions = sesRes.data || [];
    loadAtPage();
}

function onAtSearch() {
    clearTimeout(atSearchTimer);
    atSearchTimer = setTimeout(() => { atSearch = (document.getElementById('at-search').value || '').trim(); atPage = 1; loadAtPage(); }, 300);
}
function onAtPageSize() { atPageSize = parseInt(document.getElementById('page-size').value, 10) || 50; atPage = 1; loadAtPage(); }
function changeAtPage(delta) {
    const tp = Math.max(1, Math.ceil(atTotal / atPageSize));
    const n = atPage + delta;
    if (n < 1 || n > tp) return;
    atPage = n; loadAtPage(); window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadAtPage() {
    const container = document.getElementById('attendance-container');
    if (atStudentIds.length === 0) { atStudents = []; atTotal = 0; renderAttendance(); document.getElementById('pager').style.display = 'none'; return; }
    container.innerHTML = `<div class="loader">Loading attendance…</div>`;

    const from = (atPage - 1) * atPageSize, to = from + atPageSize - 1;
    let q = db.from('profiles').select('id, full_name', { count: 'exact' }).in('id', atStudentIds);
    const term = atSearch.replace(/[%,()]/g, ' ').trim();
    if (term) q = q.ilike('full_name', `%${term}%`);
    q = q.order('full_name', { ascending: true }).range(from, to);

    const { data, count, error } = await q;
    if (error) { container.innerHTML = `<div class="empty-state"><h3 style="color:var(--red)">Couldn't load attendance</h3><p>${escapeHtml(error.message)}</p></div>`; return; }
    atStudents = data || [];
    atTotal = count || 0;

    atMarks = {};
    const pageIds = atStudents.map(s => s.id);
    if (pageIds.length && atSessions.length) {
        const sesIds = atSessions.map(s => s.id);
        const mRes = await db.from('attendance').select('session_id, student_id, present').in('session_id', sesIds).in('student_id', pageIds);
        (mRes.data || []).forEach(m => { atMarks[`${m.student_id}_${m.session_id}`] = m.present; });
    }
    renderAttendance();
    renderAtPager();
}

function renderAtPager() {
    const pager = document.getElementById('pager');
    if (atStudents.length === 0 && !atSearch) { pager.style.display = 'none'; return; }
    pager.style.display = 'flex';
    const totalPages = Math.max(1, Math.ceil(atTotal / atPageSize));
    if (atPage > totalPages) atPage = totalPages;
    const info = document.getElementById('pager-info');
    if (atTotal === 0) info.textContent = 'No students match.';
    else {
        const start = (atPage - 1) * atPageSize + 1, end = Math.min(atPage * atPageSize, atTotal);
        info.textContent = `Showing ${start}–${end} of ${atTotal} student${atTotal === 1 ? '' : 's'}`;
    }
    document.getElementById('page-label').textContent = `Page ${atPage} of ${totalPages}`;
    const prev = document.getElementById('prev-btn'), next = document.getElementById('next-btn');
    prev.disabled = atPage <= 1; next.disabled = atPage >= totalPages;
    prev.style.opacity = prev.disabled ? '.4' : '1'; next.style.opacity = next.disabled ? '.4' : '1';
}

function renderAttendance() {
    const container = document.getElementById('attendance-container');
    if (atStudentIds.length === 0) {
        container.innerHTML = `<div class="empty-state"><h3>No students enrolled</h3><p>Enrol students in this course (Courses → open the course) to mark attendance.</p></div>`;
        return;
    }
    if (atSessions.length === 0) {
        container.innerHTML = `<div class="empty-state"><h3>No classes yet</h3><p>Click <strong>Open attendance for today</strong> to start the first class.</p></div>`;
        return;
    }
    if (atStudents.length === 0) {
        container.innerHTML = `<div class="empty-state"><h3>No students match</h3><p>No enrolled student matches "${escapeHtml(atSearch)}".</p></div>`;
        return;
    }

    const head = `<tr><th class="att-sticky">Student</th>${atSessions.map(s => `
        <th class="att-col">${fmtSession(s.session_date)}
            <span class="att-col-sub" title="Opened by ${escapeHtml(s.opened_by_name || '')}">${escapeHtml(s.opened_by_name || '')}</span>
            <button class="att-del" title="Delete this class (removes everyone's marks for that day)" onclick="deleteSession('${s.id}')">✕</button>
        </th>`).join('')}<th>Attendance</th></tr>`;

    const rows = atStudents.map(s => {
        let attended = 0;
        const cells = atSessions.map(se => {
            const isPresent = atMarks[`${s.id}_${se.id}`] === true;
            if (isPresent) attended++;
            return `<td><button class="att-mark ${isPresent ? 'att-present' : 'att-absent'}" onclick="toggleMark('${s.id}','${se.id}')" title="Click to toggle present/absent">${isPresent ? '✓' : '✗'}</button></td>`;
        }).join('');
        const pct = Math.round((attended / atSessions.length) * 100);
        return `<tr><td class="att-sticky"><strong>${escapeHtml(s.full_name || '—')}</strong></td>${cells}<td><span class="att-pct ${pctColor(pct)}">${pct}%</span></td></tr>`;
    }).join('');

    container.innerHTML = `
        <p class="hint" style="margin-bottom:12px;">Everyone starts <strong>present (✓)</strong> when you open a class — click any mark to flip it to absent (✗) or back. Percentage = classes attended ÷ classes held. The student name stays pinned as you scroll across dates.</p>
        <div class="panel" style="overflow-x:auto;">
            <table class="data-table att-table"><thead>${head}</thead><tbody>${rows}</tbody></table>
        </div>`;
}

async function toggleMark(studentId, sessionId) {
    const key = `${studentId}_${sessionId}`;
    const next = !(atMarks[key] === true);
    atMarks[key] = next;
    renderAttendance();
    const { error } = await db.from('attendance').upsert(
        { session_id: sessionId, student_id: studentId, present: next, updated_by: CURRENT_UID, updated_at: new Date().toISOString() },
        { onConflict: 'session_id,student_id' }
    );
    if (error) { alert(`Couldn't save that mark: ${error.message}`); atMarks[key] = !next; renderAttendance(); }
}

async function deleteSession(sessionId) {
    const s = atSessions.find(x => x.id === sessionId);
    if (!confirm(`Delete the class on ${fmtSession(s && s.session_date)}?\n\nThis permanently removes the attendance marks for EVERY student for that day. This cannot be undone.`)) return;
    const { error } = await db.from('class_sessions').delete().eq('id', sessionId);
    if (error) { alert(`Couldn't delete that class: ${error.message}`); return; }
    atSessions = atSessions.filter(x => x.id !== sessionId);
    loadAtPage();
}

// ── OPEN A NEW CLASS ──
function openClassModal() {
    document.getElementById('open-alert').style.display = 'none';
    document.getElementById('opener-name').value = ADMIN_NAME || '';
    openModal('open-modal');
    setTimeout(() => document.getElementById('opener-name').focus(), 50);
}

async function submitNewClass(ev) {
    ev.preventDefault();
    const alert = document.getElementById('open-alert'); alert.style.display = 'none';
    const name = (document.getElementById('opener-name').value || '').trim();
    if (!name) { showModalAlert(alert, 'Please type your name so we know who opened attendance.', 'error'); return; }

    // Gentle guard against opening two classes the same day by accident.
    const t = new Date();
    const todayStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    if (atSessions.some(s => s.session_date === todayStr)) {
        if (!confirm('You already opened attendance today. Open another class for today anyway?')) return;
    }

    const btn = document.getElementById('open-save-btn'); btn.disabled = true; btn.textContent = 'Opening…';
    try {
        // session_date is set server-side (locked to today) by a DB trigger — we never send it.
        const ins = await db.from('class_sessions').insert({ course_id: atCourseId, opened_by_name: name })
            .select('id, session_date, opened_by_name').single();
        if (ins.error) throw new Error(ins.error.message);

        if (atStudentIds.length) {
            const rows = atStudentIds.map(sid => ({ session_id: ins.data.id, student_id: sid, present: true, updated_by: CURRENT_UID }));
            const at = await db.from('attendance').insert(rows);
            if (at.error) throw new Error(at.error.message);
        }
        atSessions.push(ins.data);
        atSessions.sort((a, b) => (a.session_date || '').localeCompare(b.session_date || ''));
        closeModal('open-modal');
        loadAtPage();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Open class';
    }
}
