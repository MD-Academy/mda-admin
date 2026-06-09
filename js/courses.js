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

async function loadCourses() {
    const container = document.getElementById('courses-container');
    container.innerHTML = `<div class="loader">Loading courses…</div>`;

    const queries = [
        db.from('courses').select('id, name, description, created_at, expires_at').order('created_at', { ascending: false }),
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
            <div class="entity-card">
                <div class="ec-head">
                    <div class="ec-title">${escapeHtml(c.name)}</div>
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
                    <button class="btn btn-danger btn-sm" onclick="deleteCourse('${c.id}', '${escapeHtml(c.name).replace(/'/g, "\\'")}')">Delete</button>
                </div>
            </div>`;
    }).join('')}</div>`;
}

function openCourse(id) {
    window.location.href = `course.html?id=${encodeURIComponent(id)}`;
}

function openCourseModal(id = null) {
    const alert = document.getElementById('course-alert');
    alert.style.display = 'none';
    if (id) {
        const c = allCourses.find(x => x.id === id);
        if (!c) return;
        document.getElementById('course-modal-title').textContent = 'Edit Course';
        document.getElementById('course-id').value = c.id;
        document.getElementById('course-name').value = c.name || '';
        document.getElementById('course-desc').value = c.description || '';
        document.getElementById('course-expiry').value = c.expires_at || '';
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

async function deleteCourse(id, name) {
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
