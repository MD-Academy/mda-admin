// Student feedback report — super-admin only (RLS: only super-admin reads feedback).
// Averages + comments per teacher / course / materials / recorded lesson.

let fbCourses = [];
let courseNameMap = {};
let nameMap = {};   // profile id -> full name (students + teachers)
let recMap = {};    // recording id -> title
let LAST = [];      // last loaded feedback rows

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function stars(n) { const r = Math.round(n); return '★★★★★'.slice(0, r) + '☆☆☆☆☆'.slice(0, 5 - r); }
function avgOf(list) { return list.length ? list.reduce((t, f) => t + f.stars, 0) / list.length : 0; }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''; }

async function loadCourses() {
    const { data } = await db.from('courses').select('id, name').order('name', { ascending: true });
    fbCourses = data || [];
    courseNameMap = {};
    const sel = document.getElementById('course-select');
    fbCourses.forEach(c => {
        courseNameMap[c.id] = c.name;
        const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; sel.appendChild(o);
    });
}

async function loadReport() {
    const box = document.getElementById('report-box');
    box.innerHTML = `<div class="loader">Loading feedback…</div>`;
    const courseId = document.getElementById('course-select').value;

    let q = db.from('feedback').select('id, student_id, course_id, target_type, target_id, stars, comment, updated_at').order('updated_at', { ascending: false });
    if (courseId) q = q.eq('course_id', courseId);
    const { data, error } = await q;
    if (error) { box.innerHTML = `<div class="empty-state"><h3 style="color:var(--red)">Couldn't load feedback</h3><p>${escapeHtml(error.message)}</p></div>`; return; }

    const fb = data || [];
    LAST = fb;
    if (!fb.length) { box.innerHTML = `<div class="empty-state"><h3>No feedback yet</h3><p>Ratings will appear here once students submit them.</p></div>`; return; }

    // Resolve names.
    const profileIds = new Set(), recIds = new Set();
    fb.forEach(f => {
        profileIds.add(f.student_id);
        if (f.target_type === 'teacher' && f.target_id) profileIds.add(f.target_id);
        if (f.target_type === 'recording' && f.target_id) recIds.add(f.target_id);
    });
    if (profileIds.size) { const { data: pf } = await db.from('profiles').select('id, full_name').in('id', [...profileIds]); (pf || []).forEach(p => { nameMap[p.id] = p.full_name || '(no name)'; }); }
    if (recIds.size) { const { data: rr } = await db.from('recordings').select('id, title').in('id', [...recIds]); (rr || []).forEach(r => { recMap[r.id] = r.title; }); }

    // Group by course.
    const byCourse = {};
    fb.forEach(f => { (byCourse[f.course_id] = byCourse[f.course_id] || []).push(f); });
    box.innerHTML = `<div id="report-print">${Object.keys(byCourse).sort((a, b) => (courseNameMap[a] || '').localeCompare(courseNameMap[b] || '')).map(cid => renderCourse(cid, byCourse[cid])).join('')}</div>`;
}

function commentsHtml(list) {
    const withComment = list.filter(f => f.comment && f.comment.trim());
    if (!withComment.length) return '';
    return `<div class="fb-comments">${withComment.map(f => `
        <div class="fb-comment"><span class="fb-stars">${stars(f.stars)}</span> <span class="who">${escapeHtml(nameMap[f.student_id] || 'Student')}</span> · ${fmtDate(f.updated_at)}<br>${escapeHtml(f.comment)}</div>`).join('')}</div>`;
}

function itemBlock(name, list) {
    const a = avgOf(list);
    return `<div class="fb-item">
        <div class="fb-item-head"><span class="fb-name">${name}</span><span class="fb-avg">${stars(a)} ${a.toFixed(1)} · ${list.length} rating${list.length === 1 ? '' : 's'}</span></div>
        ${commentsHtml(list)}
    </div>`;
}

function renderCourse(courseId, fb) {
    const courseFb = fb.filter(f => f.target_type === 'course');
    const matsFb = fb.filter(f => f.target_type === 'materials');
    const teacherFb = fb.filter(f => f.target_type === 'teacher');
    const recFb = fb.filter(f => f.target_type === 'recording');

    let html = `<div class="fb-block"><div style="font-size:18px;font-weight:800;color:var(--navy-800);margin-bottom:6px;">${escapeHtml(courseNameMap[courseId] || 'Course')}</div>`;

    if (courseFb.length) html += `<div class="fb-cat-title">⭐ Overall course</div>` + itemBlock('Course rating', courseFb);
    if (matsFb.length) html += `<div class="fb-cat-title">📄 Materials</div>` + itemBlock('Study materials', matsFb);

    if (teacherFb.length) {
        html += `<div class="fb-cat-title">👤 Teachers</div>`;
        const byT = {};
        teacherFb.forEach(f => { (byT[f.target_id] = byT[f.target_id] || []).push(f); });
        html += Object.keys(byT).sort((a, b) => (nameMap[a] || '').localeCompare(nameMap[b] || '')).map(tid => itemBlock(escapeHtml(nameMap[tid] || 'Teacher'), byT[tid])).join('');
    }

    if (recFb.length) {
        html += `<div class="fb-cat-title">🎥 Recorded classes</div>`;
        const byR = {};
        recFb.forEach(f => { (byR[f.target_id] = byR[f.target_id] || []).push(f); });
        html += Object.keys(byR).sort((a, b) => (recMap[a] || '').localeCompare(recMap[b] || '')).map(rid => itemBlock(escapeHtml(recMap[rid] || 'Recording'), byR[rid])).join('');
    }

    html += `</div>`;
    return html;
}

function targetLabel(f) {
    if (f.target_type === 'course') return 'Course overall';
    if (f.target_type === 'materials') return 'Materials';
    if (f.target_type === 'teacher') return 'Teacher: ' + (nameMap[f.target_id] || '?');
    if (f.target_type === 'recording') return 'Recording: ' + (recMap[f.target_id] || '?');
    return f.target_type;
}

function exportCsv() {
    if (!LAST.length) { alert('Nothing to export yet.'); return; }
    const rows = [['Course', 'What', 'Student', 'Stars', 'Comment', 'Date']];
    LAST.forEach(f => rows.push([
        courseNameMap[f.course_id] || '', targetLabel(f), nameMap[f.student_id] || '', f.stars,
        (f.comment || '').replace(/\s+/g, ' '), fmtDate(f.updated_at)
    ]));
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'feedback.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
}
