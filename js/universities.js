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
        document.getElementById('uni-desc').value = u.description || '';
        editDegrees = Array.isArray(u.degrees) ? u.degrees.slice() : [];
        editExamDates = Array.isArray(u.exam_dates) ? u.exam_dates.slice() : [];
        if (u.image_url) document.getElementById('uni-image-current').textContent = 'A photo is set — choose a file to replace it.';
    } else {
        document.getElementById('uni-modal-title').textContent = 'Add University';
        ['uni-id', 'uni-name', 'uni-country', 'uni-location', 'uni-costs', 'uni-website', 'uni-desc'].forEach(f => document.getElementById(f).value = '');
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
        ? editDegrees.map((d, i) => `<span class="pill pill-assigned" style="cursor:default;">${escapeHtml(d)} <span class="x" style="cursor:pointer;" onclick="removeDegree(${i})">✕</span></span>`).join('')
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

    if (!name) { showModalAlert(alert, 'Please enter the university name.', 'error'); return; }
    if (editDegrees.length === 0) { showModalAlert(alert, 'Add at least one degree the university offers.', 'error'); return; }
    if (!web.ok) { showModalAlert(alert, web.msg, 'error'); return; }
    if (!ensureSafe(alert, [['Name', name], ['Country', country], ['Location', location], ['Costs', costs], ['Description', description]])) return;

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        const payload = { name, country: country || null, location: location || null, costs: costs || null, website: web.value, description: description || null, degrees: editDegrees, exam_dates: editExamDates };
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
async function loadReport() {
    const box = document.getElementById('report-list');
    box.innerHTML = `<div class="loader">Loading student selections…</div>`;
    if (UNIS.length === 0) await loadUnis();
    const { data, error } = await db.from('university_selections')
        .select('id, student_id, student_name, university_id, status, degrees, is_final_choice')
        .order('student_name', { ascending: true });
    if (error) { box.innerHTML = `<div class="empty-state"><h3 style="color:var(--red)">Couldn't load selections</h3><p>${escapeHtml(error.message)}</p></div>`; return; }
    SELS = data || [];
    renderReport();
}

function onReportSearch() { reportSearch = (document.getElementById('report-search').value || '').trim().toLowerCase(); renderReport(); }

function renderReport() {
    const box = document.getElementById('report-list');
    let sels = SELS;
    if (reportSearch) sels = sels.filter(s => (s.student_name || '').toLowerCase().includes(reportSearch));
    if (sels.length === 0) {
        box.innerHTML = `<div class="empty-state" style="padding:36px;"><p>${reportSearch ? 'No students match.' : 'No students have made selections yet.'}</p></div>`;
        return;
    }
    // Group by student.
    const byStudent = {};
    sels.forEach(s => { (byStudent[s.student_id] = byStudent[s.student_id] || { name: s.student_name, items: [] }).items.push(s); });

    box.innerHTML = Object.values(byStudent).sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(stu => {
        const rows = stu.items.map(s => {
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
        return `<div class="panel" style="padding:18px;margin-bottom:14px;">
            <div class="section-title" style="margin:0 0 10px;">${escapeHtml(stu.name || 'Student')}</div>
            <div class="list-rows">${rows}</div>
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
