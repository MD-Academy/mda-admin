// Courses list — group subjects + enrol students. Opens course.html for detail.

let allCourses = [];
let subjectCounts = {};   // course_id -> # subjects
let studentCounts = {};   // course_id -> # enrolled students
let IS_SUPER = false;     // superadmin can manage; admins (teachers) view only

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
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function isExpired(d) {
    if (!d) return false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return new Date(d) < today;
}

const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

function visToggleHtml(id, isVisible) {
    return `<button class="vis-toggle ${isVisible ? 'visible' : 'hidden'}" onclick="toggleCourseVis('${id}')" title="${isVisible ? 'Visible to enrolled students — click to hide the whole course' : 'Hidden from students — click to show'}">${isVisible ? EYE : EYE_OFF}${isVisible ? 'Visible' : 'Hidden'}</button>`;
}

async function toggleCourseVis(id) {
    const c = allCourses.find(x => x.id === id);
    if (!c) return;
    const { error } = await db.from('courses').update({ is_visible: !c.is_visible }).eq('id', id);
    if (error) { alert(`Failed to update visibility: ${error.message}`); return; }
    c.is_visible = !c.is_visible;
    renderCourses();
}

// ── COVER IMAGE UPLOAD (public lesson-images bucket; images only, <=500KB) ──
const CARD_BUCKET = 'lesson-images';
const ALLOWED_IMG = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
const IMG_MAX = 500 * 1024;
let pickedCourseImage = null;
function onCourseImagePicked(e) {
    const f = e.target.files[0];
    if (!f) return;
    pickedCourseImage = f;
    document.getElementById('course-image-text').textContent = f.name;
}
async function uploadCardImage(file, prefix) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!file.type.startsWith('image/') || !ALLOWED_IMG.includes(ext)) return { error: 'Please choose an image (PNG, JPG, WEBP or GIF).' };
    if (file.size > IMG_MAX) return { error: `Image too large (${(file.size / 1024).toFixed(0)} KB). Max 500 KB.` };
    const path = `${prefix}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const up = await db.storage.from(CARD_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) return { error: up.error.message };
    const { data } = db.storage.from(CARD_BUCKET).getPublicUrl(path);
    return { url: data.publicUrl };
}

async function loadCourses() {
    const container = document.getElementById('courses-container');
    container.innerHTML = `<div class="loader">Loading courses…</div>`;

    const queries = [
        db.from('courses').select('id, name, description, created_at, expires_at, is_visible, image_url').order('created_at', { ascending: false }),
        db.from('course_subjects').select('course_id')
    ];
    if (IS_SUPER) queries.push(db.from('course_enrollments').select('course_id'));
    const results = await Promise.all(queries);
    const cRes = results[0], csRes = results[1], ceRes = IS_SUPER ? results[2] : { data: [] };

    if (cRes.error) {
        container.innerHTML = `<div class="loader" style="color:var(--red)">Error loading courses: ${escapeHtml(cRes.error.message)}</div>`;
        return;
    }

    allCourses = cRes.data || [];
    subjectCounts = {};
    studentCounts = {};
    (csRes.data || []).forEach(r => { subjectCounts[r.course_id] = (subjectCounts[r.course_id] || 0) + 1; });
    (ceRes.data || []).forEach(r => { studentCounts[r.course_id] = (studentCounts[r.course_id] || 0) + 1; });

    renderCourses();
}

function renderCourses() {
    const container = document.getElementById('courses-container');
    if (allCourses.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
                <h3>No courses yet</h3>
                <p>Click "Add Course" to create one, then add subjects and enrol students.</p>
            </div>`;
        return;
    }

    container.innerHTML = `<div class="card-grid">${allCourses.map(c => {
        const subs = subjectCounts[c.id] || 0;
        const studs = studentCounts[c.id] || 0;
        return `
            <div class="entity-card" style="position:relative; overflow:visible;">
                <button class="card-menu-btn" onclick="toggleCardMenu(event, '${c.id}')" aria-label="More options" title="More">⋯</button>
                <div class="card-menu" id="menu-${c.id}">
                    <button onclick="duplicateCourse('${c.id}')">
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        Duplicate course
                    </button>
                </div>
                ${c.image_url ? `<div style="height:88px;margin:-22px -22px 14px;border-radius:16px 16px 0 0;background:url('${escapeHtml(c.image_url)}') center/cover;"></div>` : ''}
                <div class="ec-head">
                    <div class="ec-title">${escapeHtml(c.name)}</div>
                    ${visToggleHtml(c.id, c.is_visible)}
                </div>
                <div class="ec-desc">${escapeHtml(c.description) || '<em style="color:var(--text-muted)">No description</em>'}</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <span class="ec-meta">${subs} subject${subs === 1 ? '' : 's'}</span>
                    ${IS_SUPER ? `<span class="ec-meta" style="background:#fdeef4;color:var(--crimson);">${studs} student${studs === 1 ? '' : 's'}</span>` : ''}
                    ${c.expires_at
                        ? (isExpired(c.expires_at)
                            ? `<span class="badge badge-red">Expired ${formatDate(c.expires_at)}</span>`
                            : `<span class="badge badge-green">Until ${formatDate(c.expires_at)}</span>`)
                        : `<span class="ec-meta" style="background:var(--bg);color:var(--text-muted);">No expiry</span>`}
                </div>
                <div class="ec-actions">
                    <button class="btn btn-primary btn-sm" onclick="openCourse('${c.id}')">Open</button>
                    <button class="btn btn-ghost btn-sm" onclick="openCourseModal('${c.id}')">Edit</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteCourse('${c.id}')">Delete</button>
                </div>
            </div>`;
    }).join('')}</div>`;
}

function openCourse(id) {
    window.location.href = `course.html?id=${encodeURIComponent(id)}`;
}

// ── CARD MENU (⋯) + DUPLICATE COURSE ──
function toggleCardMenu(e, id) {
    e.stopPropagation();
    const menu = document.getElementById(`menu-${id}`);
    const open = menu.classList.contains('open');
    document.querySelectorAll('.card-menu.open').forEach(m => m.classList.remove('open'));
    if (!open) menu.classList.add('open');
}
document.addEventListener('click', () => document.querySelectorAll('.card-menu.open').forEach(m => m.classList.remove('open')));

async function _copyCourseLinks(table, col, srcCourseId, newCourseId) {
    const { data, error } = await db.from(table).select(col).eq('course_id', srcCourseId);
    if (error) throw new Error(error.message);
    const rows = (data || []).map(r => ({ course_id: newCourseId, [col]: r[col] }));
    if (rows.length) {
        const ins = await db.from(table).insert(rows);
        if (ins.error) throw new Error(ins.error.message);
    }
}

async function duplicateCourse(id) {
    document.querySelectorAll('.card-menu.open').forEach(m => m.classList.remove('open'));
    const src = allCourses.find(x => x.id === id);
    if (!src) return;
    const container = document.getElementById('courses-container');
    try {
        // 1) Create the copy (no students).
        const ins = await db.from('courses').insert({
            name: `Copy of ${src.name}`,
            description: src.description,
            expires_at: src.expires_at,
            is_visible: src.is_visible,
            image_url: src.image_url
        }).select('id').single();
        if (ins.error) throw new Error(ins.error.message);
        const newId = ins.data.id;
        // 2) Carry over the setup only — subjects + exams. NOT recordings, NOT students.
        await _copyCourseLinks('course_subjects', 'room_id', id, newId);
        await _copyCourseLinks('exam_courses', 'exam_id', id, newId);
        await loadCourses();
    } catch (err) {
        alert(`Could not duplicate the course: ${err.message}`);
    }
}

function openCourseModal(id = null) {
    const alert = document.getElementById('course-alert');
    alert.style.display = 'none';
    pickedCourseImage = null;
    document.getElementById('course-image-file').value = '';
    document.getElementById('course-image-text').textContent = 'Click to choose an image';
    document.getElementById('course-image-current').textContent = '';
    if (id) {
        const c = allCourses.find(x => x.id === id);
        if (!c) return;
        document.getElementById('course-modal-title').textContent = 'Edit Course';
        document.getElementById('course-id').value = c.id;
        document.getElementById('course-name').value = c.name || '';
        document.getElementById('course-desc').value = c.description || '';
        document.getElementById('course-expiry').value = c.expires_at || '';
        if (c.image_url) document.getElementById('course-image-current').textContent = 'A cover image is set — choose a file to replace it.';
    } else {
        document.getElementById('course-modal-title').textContent = 'Add Course';
        document.getElementById('course-id').value = '';
        document.getElementById('course-name').value = '';
        document.getElementById('course-desc').value = '';
        document.getElementById('course-expiry').value = '';
    }
    openModal('course-modal');
}

async function saveCourse(e) {
    e.preventDefault();
    const btn = document.getElementById('course-save-btn');
    const alert = document.getElementById('course-alert');
    alert.style.display = 'none';

    const id = document.getElementById('course-id').value;
    const payload = {
        name: document.getElementById('course-name').value.trim(),
        description: document.getElementById('course-desc').value.trim() || null,
        expires_at: document.getElementById('course-expiry').value || null
    };
    if (!payload.name) { showModalAlert(alert, 'Course name is required.', 'error'); return; }
    if (!ensureSafe(alert, [['Course Name', payload.name], ['Description', payload.description]])) return;

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        if (pickedCourseImage) {
            const up = await uploadCardImage(pickedCourseImage, 'courses');
            if (up.error) throw new Error(up.error);
            payload.image_url = up.url;
        }
        let res;
        if (id) res = await db.from('courses').update(payload).eq('id', id);
        else res = await db.from('courses').insert(payload);
        if (res.error) throw new Error(res.error.message);
        closeModal('course-modal');
        loadCourses();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Save Course';
    }
}

async function deleteCourse(id) {
    const c = allCourses.find(x => x.id === id);
    const name = c ? (c.name || 'this course') : 'this course';
    const subs = subjectCounts[id] || 0;
    const enrolMsg = IS_SUPER ? `${studentCounts[id] || 0} student enrolment(s) and ` : 'Any student enrolments and ';
    const ok = await confirmDialog({
        title: `Delete "${name}"?`,
        message: `This course will be removed. ${enrolMsg}${subs} subject link(s) will be detached. The subjects and students themselves are NOT deleted. This cannot be undone.`,
        confirmText: 'Delete Course',
        danger: true
    });
    if (!ok) return;
    const { error } = await db.from('courses').delete().eq('id', id);
    if (error) { alert(`Failed to delete course: ${error.message}`); return; }
    loadCourses();
}
