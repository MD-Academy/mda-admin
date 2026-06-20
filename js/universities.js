// University Selection (admin) — manage partner universities + view/override student selections.

const CARD_BUCKET = 'lesson-images';     // reuse existing public image bucket
const ALLOWED_IMG = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
const IMG_MAX = 500 * 1024;
const COMMON_DEGREES = ['General Medicine', 'Dentistry', 'Veterinary Medicine', 'Pharmacy'];

let UNIS = [];            // [{id, name, country, location, costs, website, description, degrees[], image_url}]
let SELS = [];            // all student selections
let uniMap = {};          // id -> university
let editDegrees = [];     // degrees chips while editing a university
let editExamDates = [];   // exam date chips (ISO yyyy-mm-dd) while editing
let pickedUniImage = null;
let reportSearch = '';
let reportCourse = '';          // course filter (course id)
let reportSort = 'fewest';      // 'fewest' | 'az'
let reportTarget = 3;           // "target schools" threshold
let reportAttention = false;    // show only students below target
let ROSTER = [];                // [{id, name, courseIds:Set, courseNames:[], items:[]}]
let COURSES_LIST = [];          // [{id, name}]

function escapeHtml(s) { return s ? String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])) : ''; }
function fmtExamDate(iso) { return iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''; }
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function showModalAlert(el, msg, type) { el.className = `alert ${type}`; el.textContent = msg; el.style.display = 'block'; }

// ── TABS ──
function showUniTab(tab) {
    document.getElementById('tab-unis').style.display = tab === 'unis' ? 'block' : 'none';
    document.getElementById('tab-report').style.display = tab === 'report' ? 'block' : 'none';
    document.getElementById('tabbtn-unis').classList.toggle('active', tab === 'unis');
    document.getElementById('tabbtn-report').classList.toggle('active', tab === 'report');
    if (tab === 'report') loadReport();
}

// ════════════ UNIVERSITIES ════════════
async function loadUnis() {
    const box = document.getElementById('unis-list');
    box.innerHTML = `<div class="loader">Loading universities…</div>`;
    const { data, error } = await db.from('universities').select('*').order('order_index', { ascending: true }).order('name', { ascending: true });
    if (error) { box.innerHTML = `<div class="empty-state"><h3 style="color:var(--red)">Couldn't load universities</h3><p>${escapeHtml(error.message)}</p></div>`; return; }
    UNIS = data || [];
    uniMap = {}; UNIS.forEach(u => uniMap[u.id] = u);
    renderUnis();
}

function renderUnis() {
    const box = document.getElementById('unis-list');
    if (UNIS.length === 0) {
        box.innerHTML = `<div class="empty-state" style="padding:36px;"><h3>No universities yet</h3><p>Click <strong>+ Add University</strong> to create the first partner university students can choose.</p></div>`;
        return;
    }
    box.innerHTML = `<div class="card-grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr));">${UNIS.map(u => `
        <div class="panel" style="padding:0;overflow:hidden;">
            <div style="height:120px;background:${u.image_url ? `url('${escapeHtml(u.image_url)}') center/cover` : 'linear-gradient(135deg,#3a1020,#7a1f3d)'};"></div>
            <div style="padding:16px;">
                <div class="section-title" style="margin:0 0 4px;">${escapeHtml(u.name)}</div>
                <div class="hint" style="margin:0 0 8px;">${escapeHtml([u.location, u.country].filter(Boolean).join(', ')) || '—'}</div>
                <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px;">
                    ${(u.degrees || []).map(d => `<span class="badge badge-blue">${escapeHtml(d)}</span>`).join('') || '<span class="hint">No degrees set</span>'}
                </div>
                ${(u.exam_dates || []).length ? `<div class="hint" style="margin:-6px 0 12px;">📅 Exam: ${(u.exam_dates).map(d => escapeHtml(fmtExamDate(d))).join(' · ')}</div>` : ''}
                <div style="display:flex;gap:8px;">
                    <button class="btn btn-ghost btn-sm" onclick="openUniModal('${u.id}')">Edit</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteUni('${u.id}')">Delete</button>
                </div>
            </div>
        </div>`).join('')}</div>`;
}

function openUniModal(id = null) {
    document.getElementById('uni-alert').style.display = 'none';
    pickedUniImage = null;
    document.getElementById('uni-image-file').value = '';
    document.getElementById('uni-image-text').textContent = 'Click to choose an image';
    document.getElementById('uni-image-current').textContent = '';
    if (id) {
        const u = uniMap[id];
        if (!u) return;
        document.getElementById('uni-modal-title').textContent = 'Edit University';
        document.getElementById('uni-id').value = u.id;
        document.getElementById('uni-name').value = u.name || '';
        document.getElementById('uni-country').value = u.country || '';
        document.getElementById('uni-location').value = u.location || '';
        document.getElementById('uni-costs').value = u.costs || '';
        document.getElementById('uni-website').value = u.website || '';
        document.getElementById('uni-app-link').value = u.application_url || '';
        document.getElementById('uni-desc').value = u.description || '';
        editDegrees = Array.isArray(u.degrees) ? u.degrees.slice() : [];
        editExamDates = Array.isArray(u.exam_dates) ? u.exam_dates.slice() : [];
        if (u.image_url) document.getElementById('uni-image-current').textContent = 'A photo is set — choose a file to replace it.';
    } else {
        document.getElementById('uni-modal-title').textContent = 'Add University';
        ['uni-id', 'uni-name', 'uni-country', 'uni-location', 'uni-costs', 'uni-website', 'uni-app-link', 'uni-desc'].forEach(f => document.getElementById(f).value = '');
        editDegrees = [];
        editExamDates = [];
    }
    renderDegreeEditor();
    renderExamDates();
    openModal('uni-modal');
}

function renderDegreeEditor() {
    const chips = document.getElementById('uni-degree-chips');
    chips.innerHTML = editDegrees.length
        ? editDegrees.map((d, i) => `<span class="pill pill-assigned" style="cursor:default;">${escapeHtml(d)} <span class="x" title="Remove this degree" style="cursor:pointer;" onclick="removeDegree(${i})">✕</span></span>`).join('')
        : `<span class="hint">No degrees added yet.</span>`;
    const quick = document.getElementById('uni-degree-quick');
    quick.innerHTML = COMMON_DEGREES.filter(d => !editDegrees.includes(d))
        .map(d => `<button type="button" class="pill pill-available" onclick="addDegree('${escapeHtml(d).replace(/'/g, "\\'")}')">${escapeHtml(d)} <span class="plus">+</span></button>`).join('');
}
function addDegree(d) {
    d = (d || '').trim();
    if (d && !editDegrees.includes(d)) editDegrees.push(d);
    renderDegreeEditor();
}
function removeDegree(i) { editDegrees.splice(i, 1); renderDegreeEditor(); }
function addCustomDegree() {
    const inp = document.getElementById('uni-degree-input');
    addDegree(inp.value);
    inp.value = '';
}

// ── EXAM DATES editor ──
function renderExamDates() {
    const chips = document.getElementById('uni-exam-chips');
    chips.innerHTML = editExamDates.length
        ? editExamDates.map((d, i) => `<span class="pill pill-assigned" style="cursor:default;">${escapeHtml(fmtExamDate(d))} <span class="x" style="cursor:pointer;" onclick="removeExamDate(${i})">✕</span></span>`).join('')
        : `<span class="hint">No exam dates added.</span>`;
}
function addExamDate(iso) {
    iso = (iso || '').trim();
    if (iso && !editExamDates.includes(iso)) { editExamDates.push(iso); editExamDates.sort(); }
    renderExamDates();
}
function removeExamDate(i) { editExamDates.splice(i, 1); renderExamDates(); }
function addExamDateFromInput() {
    const inp = document.getElementById('uni-exam-input');
    addExamDate(inp.value);
    inp.value = '';
}

function onUniImagePicked(e) {
    const f = e.target.files[0];
    if (!f) return;
    pickedUniImage = f;
    document.getElementById('uni-image-text').textContent = f.name;
}
async function uploadUniImage(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!file.type.startsWith('image/') || !ALLOWED_IMG.includes(ext)) return { error: 'Please choose an image (PNG, JPG, WEBP or GIF).' };
    if (file.size > IMG_MAX) return { error: `Image too large (${(file.size / 1024).toFixed(0)} KB). Max 500 KB.` };
    const path = `universities/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const up = await db.storage.from(CARD_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) return { error: up.error.message };
    const { data } = db.storage.from(CARD_BUCKET).getPublicUrl(path);
    return { url: data.publicUrl };
}

function cleanWebsite(raw) {
    const v = (raw || '').trim();
    if (!v) return { ok: true, value: null };
    if (!/^https?:\/\//i.test(v)) return { ok: false, msg: 'Website must start with http:// or https://' };
    if (/[\s<>"']/.test(v)) return { ok: false, msg: 'Website contains invalid characters.' };
    return { ok: true, value: v };
}

async function saveUni(e) {
    e.preventDefault();
    const btn = document.getElementById('uni-save-btn');
    const alert = document.getElementById('uni-alert');
    alert.style.display = 'none';

    const id = document.getElementById('uni-id').value;
    const name = document.getElementById('uni-name').value.trim();
    const country = document.getElementById('uni-country').value.trim();
    const location = document.getElementById('uni-location').value.trim();
    const costs = document.getElementById('uni-costs').value.trim();
    const description = document.getElementById('uni-desc').value.trim();
    const web = cleanWebsite(document.getElementById('uni-website').value);
    const appLink = cleanWebsite(document.getElementById('uni-app-link').value);

    if (!name) { showModalAlert(alert, 'Please enter the university name.', 'error'); return; }
    if (editDegrees.length === 0) { showModalAlert(alert, 'Add at least one degree the university offers.', 'error'); return; }
    if (!web.ok) { showModalAlert(alert, 'Website: ' + web.msg, 'error'); return; }
    if (!appLink.ok) { showModalAlert(alert, 'Application link: ' + appLink.msg, 'error'); return; }
    if (!ensureSafe(alert, [['Name', name], ['Country', country], ['Location', location], ['Costs', costs], ['Description', description]])) return;

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        const payload = { name, country: country || null, location: location || null, costs: costs || null, website: web.value, application_url: appLink.value, description: description || null, degrees: editDegrees, exam_dates: editExamDates };
        if (pickedUniImage) {
            const up = await uploadUniImage(pickedUniImage);
            if (up.error) throw new Error(up.error);
            payload.image_url = up.url;
        }
        const res = id ? await db.from('universities').update(payload).eq('id', id) : await db.from('universities').insert(payload);
        if (res.error) throw new Error(res.error.message);
        closeModal('uni-modal');
        await loadUnis();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Save University';
    }
}

async function deleteUni(id) {
    const u = uniMap[id];
    const ok = await confirmDialog({ title: 'Delete university?', message: `"${u ? u.name : ''}" will be removed, along with every student's selection of it. This cannot be undone.`, confirmText: 'Delete', danger: true });
    if (!ok) return;
    const { error } = await db.from('universities').delete().eq('id', id);
    if (error) { alert(`Couldn't delete: ${error.message}`); return; }
    await loadUnis();
}

// ════════════ STUDENT SELECTIONS REPORT ════════════
// Full course-coverage roster: EVERY enrolled student, with their selections
// (or a clear "no selection yet" flag) so the office can chase inactive ones.
async function loadReport() {
    const box = document.getElementById('report-list');
    box.innerHTML = `<div class="loader">Loading student selections…</div>`;
    if (UNIS.length === 0) await loadUnis();

    const [enrRes, selRes, courseRes, setRes] = await Promise.all([
        db.from('course_enrollments').select('student_id, course_id'),
        db.from('university_selections').select('id, student_id, student_name, university_id, status, degrees, is_final_choice'),
        db.from('courses').select('id, name').order('name', { ascending: true }),
        db.from('app_settings').select('value').eq('key', 'university_target').limit(1)
    ]);
    // Load the saved recommended target (students see this) into the input.
    const savedTarget = parseInt(((setRes.data || [])[0] || {}).value, 10);
    if (savedTarget >= 1 && savedTarget <= 20) {
        reportTarget = savedTarget;
        const ti = document.getElementById('report-target'); if (ti) ti.value = String(savedTarget);
    }
    if (enrRes.error || selRes.error) {
        const msg = (enrRes.error || selRes.error).message;
        box.innerHTML = `<div class="empty-state"><h3 style="color:var(--red)">Couldn't load the report</h3><p>${escapeHtml(msg)}</p></div>`;
        return;
    }
    SELS = selRes.data || [];
    COURSES_LIST = courseRes.data || [];
    const courseName = id => (COURSES_LIST.find(c => c.id === id) || {}).name || 'Course';

    // Names for every enrolled student.
    const enrolls = enrRes.data || [];
    const studentIds = [...new Set([...enrolls.map(e => e.student_id), ...SELS.map(s => s.student_id)])];
    let nameById = {};
    if (studentIds.length) {
        const { data: profs } = await db.from('profiles').select('id, full_name').in('id', studentIds);
        (profs || []).forEach(p => { nameById[p.id] = p.full_name; });
    }

    // Build the roster keyed by student.
    const map = {};
    const ensure = (sid) => (map[sid] = map[sid] || { id: sid, name: nameById[sid] || '', courseIds: new Set(), courseNames: [], items: [] });
    enrolls.forEach(e => {
        const stu = ensure(e.student_id);
        if (!stu.courseIds.has(e.course_id)) { stu.courseIds.add(e.course_id); stu.courseNames.push(courseName(e.course_id)); }
    });
    SELS.forEach(s => {
        const stu = ensure(s.student_id);
        if (!stu.name) stu.name = s.student_name || '';
        stu.items.push(s);
    });
    ROSTER = Object.values(map);

    // Populate the course filter (keep current selection if still valid).
    const sel = document.getElementById('report-course');
    if (sel) {
        const cur = reportCourse;
        sel.innerHTML = `<option value="">All courses</option>` +
            COURSES_LIST.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
        sel.value = COURSES_LIST.some(c => c.id === cur) ? cur : '';
        reportCourse = sel.value;
    }
    renderReport();
}

function onReportSearch() { reportSearch = (document.getElementById('report-search').value || '').trim().toLowerCase(); renderReport(); }
function onReportCourse() { reportCourse = document.getElementById('report-course').value; renderReport(); }
function onReportSort() { reportSort = document.getElementById('report-sort').value; renderReport(); }
function onReportAttention() { reportAttention = document.getElementById('report-attention').checked; renderReport(); }
let _targetSaveTimer = null;
function onReportTarget() {
    const v = parseInt(document.getElementById('report-target').value, 10);
    reportTarget = (v >= 1 && v <= 20) ? v : 3;
    renderReport();
    // Persist (debounced) so students see it as their recommended number.
    clearTimeout(_targetSaveTimer);
    _targetSaveTimer = setTimeout(saveTarget, 600);
}
async function saveTarget() {
    const note = document.getElementById('target-saved');
    const { error } = await db.from('app_settings').upsert(
        { key: 'university_target', value: String(reportTarget), updated_at: new Date().toISOString() },
        { onConflict: 'key' }
    );
    if (note) {
        note.textContent = error ? "Couldn't save" : 'Saved ✓';
        note.style.color = error ? 'var(--red)' : 'var(--green)';
        if (!error) setTimeout(() => { note.textContent = ''; }, 1800);
    }
}

function renderReport() {
    const box = document.getElementById('report-list');
    const summaryEl = document.getElementById('report-summary');

    // Cohort = course + name filters (NOT the attention filter — summary covers the whole cohort).
    let base = ROSTER.slice();
    if (reportCourse) base = base.filter(s => s.courseIds.has(reportCourse));
    if (reportSearch) base = base.filter(s => (s.name || '').toLowerCase().includes(reportSearch));

    const noneCount = base.filter(s => s.items.length === 0).length;
    const belowCount = base.filter(s => s.items.length > 0 && s.items.length < reportTarget).length;
    if (summaryEl) {
        summaryEl.innerHTML = base.length
            ? `<strong>${base.length}</strong> student${base.length === 1 ? '' : 's'} ·
               <span style="color:#b91c1c;font-weight:600;">${noneCount} with no selection</span> ·
               <span style="color:#b45309;font-weight:600;">${belowCount} below target (${reportTarget})</span>`
            : '';
    }

    // What we actually display (optionally only those needing attention).
    let rows = base;
    if (reportAttention) rows = rows.filter(s => s.items.length < reportTarget);

    rows.sort((a, b) => reportSort === 'az'
        ? (a.name || '').localeCompare(b.name || '')
        : (a.items.length - b.items.length) || (a.name || '').localeCompare(b.name || ''));

    if (rows.length === 0) {
        const why = reportAttention ? 'No students need attention with the current target. 🎉'
            : (reportSearch || reportCourse) ? 'No students match these filters.'
            : 'No students are enrolled in any course yet.';
        box.innerHTML = `<div class="empty-state" style="padding:36px;"><p>${why}</p></div>`;
        return;
    }

    box.innerHTML = rows.map(stu => {
        const courseChips = stu.courseNames.length
            ? stu.courseNames.map(c => `<span class="badge badge-blue" style="margin-left:6px;">${escapeHtml(c)}</span>`).join('')
            : `<span class="badge" style="background:#f1f5f9;color:#64748b;margin-left:6px;">No course</span>`;

        const count = stu.items.length;
        let countNote = '';
        if (count === 0) {
            countNote = `<div class="alert" style="display:block;background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;margin:0;">⚠️ No universities selected yet — encourage this student to start choosing.</div>`;
        } else {
            const rowsHtml = stu.items.map(s => {
                const u = uniMap[s.university_id];
                const uname = u ? u.name : 'University';
                const degs = (s.degrees || []).join(', ') || '—';
                const badge = s.status === 'accepted'
                    ? `<span class="badge badge-green">Accepted</span>`
                    : `<span class="badge badge-blue">Applying</span>`;
                const star = s.is_final_choice ? ` <span class="badge" style="background:#fef3c7;color:#92400e;">★ Final choice</span>` : '';
                return `<div class="list-row">
                    <div class="lr-body">
                        <div class="lr-title">${escapeHtml(uname)} ${badge}${star}</div>
                        <div class="lr-sub">Degrees: ${escapeHtml(degs)}</div>
                    </div>
                    <div class="lr-actions">
                        <button class="btn btn-ghost btn-sm" onclick="ovrToggleStatus('${s.id}')">${s.status === 'accepted' ? 'Mark applying' : 'Mark accepted'}</button>
                        <button class="btn btn-ghost btn-sm" onclick="ovrToggleFinal('${s.id}')">${s.is_final_choice ? 'Unset final' : 'Set ★ final'}</button>
                        <button class="btn btn-danger btn-sm" onclick="ovrRemove('${s.id}')">Remove</button>
                    </div>
                </div>`;
            }).join('');
            const belowNote = count < reportTarget
                ? `<div class="hint" style="color:#b45309;margin:0 0 8px;">Only ${count} of ${reportTarget} target schools — could pick more.</div>`
                : '';
            countNote = belowNote + `<div class="list-rows">${rowsHtml}</div>`;
        }

        const countBadgeColor = count === 0 ? '#b91c1c' : (count < reportTarget ? '#b45309' : '#15803d');
        return `<div class="panel" style="padding:18px;margin-bottom:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
                <div class="section-title" style="margin:0;">${escapeHtml(stu.name || 'Student')} ${courseChips}</div>
                <span style="font-size:13px;font-weight:700;color:${countBadgeColor};white-space:nowrap;">${count} selected</span>
            </div>
            ${countNote}
        </div>`;
    }).join('');
}

const OVR_WARN = 'You\'re about to edit this student\'s selection. Is this what you would like to do?';
function selById(id) { return SELS.find(s => s.id === id); }

async function ovrToggleStatus(id) {
    const s = selById(id); if (!s) return;
    const ok = await confirmDialog({ title: 'Override student selection?', message: OVR_WARN, confirmText: 'Yes, edit', danger: false });
    if (!ok) return;
    const next = s.status === 'accepted' ? 'applying' : 'accepted';
    const upd = { status: next };
    if (next === 'applying' && s.is_final_choice) upd.is_final_choice = false;   // can't be final if no longer accepted
    const { error } = await db.from('university_selections').update(upd).eq('id', id);
    if (error) { alert(`Couldn't update: ${error.message}`); return; }
    loadReport();
}

async function ovrToggleFinal(id) {
    const s = selById(id); if (!s) return;
    if (!s.is_final_choice && s.status !== 'accepted') { alert('Mark this as Accepted before setting it as the final choice.'); return; }
    const ok = await confirmDialog({ title: 'Override student selection?', message: OVR_WARN, confirmText: 'Yes, edit', danger: false });
    if (!ok) return;
    if (!s.is_final_choice) {
        // clear any existing final for this student first (one final choice allowed)
        await db.from('university_selections').update({ is_final_choice: false }).eq('student_id', s.student_id).eq('is_final_choice', true);
    }
    const { error } = await db.from('university_selections').update({ is_final_choice: !s.is_final_choice }).eq('id', id);
    if (error) { alert(`Couldn't update: ${error.message}`); return; }
    loadReport();
}

async function ovrRemove(id) {
    const ok = await confirmDialog({ title: 'Remove this selection?', message: OVR_WARN + ' This deletes the student\'s selection of this university.', confirmText: 'Yes, remove', danger: true });
    if (!ok) return;
    const { error } = await db.from('university_selections').delete().eq('id', id);
    if (error) { alert(`Couldn't remove: ${error.message}`); return; }
    loadReport();
}
