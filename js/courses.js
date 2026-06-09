// Courses list — group subjects + enrol students. Opens course.html for detail.

let allCourses = [];
let subjectCounts = {};   // course_id -> # subjects
let studentCounts = {};   // course_id -> # enrolled students

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

async function loadCourses() {
    const container = document.getElementById('courses-container');
    container.innerHTML = `<div class="loader">Loading courses…</div>`;

    const [cRes, csRes, ceRes] = await Promise.all([
        db.from('courses').select('id, name, description, created_at').order('created_at', { ascending: false }),
        db.from('course_subjects').select('course_id'),
        db.from('course_enrollments').select('course_id')
    ]);

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
                    <span class="ec-meta" style="background:#fdeef4;color:var(--crimson);">${studs} student${studs === 1 ? '' : 's'}</span>
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
    } else {
        document.getElementById('course-modal-title').textContent = 'Add Course';
        document.getElementById('course-id').value = '';
        document.getElementById('course-name').value = '';
        document.getElementById('course-desc').value = '';
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
        description: document.getElementById('course-desc').value.trim() || null
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
    const studs = studentCounts[id] || 0;
    const ok = await confirmDialog({
        title: `Delete "${name}"?`,
        message: `This course will be removed. ${studs} student enrolment(s) and ${subs} subject link(s) will be detached. The subjects and students themselves are NOT deleted. This cannot be undone.`,
        confirmText: 'Delete Course',
        danger: true
    });
    if (!ok) return;
    const { error } = await db.from('courses').delete().eq('id', id);
    if (error) { alert(`Failed to delete course: ${error.message}`); return; }
    loadCourses();
}
