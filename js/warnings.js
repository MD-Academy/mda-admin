// Per-student warning/notice audit trail — official, printable proof for disputes.
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function fmtDateTime(iso) {
    return iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
}
const TYPE_LABEL = { attendance_low: 'Low attendance', grade_low: 'Low grade' };

async function initWarnings(studentId, profile) {
    let name = 'Student', email = '';
    try {
        const { data: p } = await db.from('profiles').select('full_name, email').eq('id', studentId).single();
        if (p) { name = p.full_name || 'Student'; email = p.email || ''; }
    } catch (e) { /* keep defaults */ }
    renderLayout('students', 'Warnings & Notices', name, profile);

    const { data, error } = await db.from('student_warnings')
        .select('id, type, course_name, detail, channel, email_to, subject, delivered, created_at')
        .eq('student_id', studentId).order('created_at', { ascending: false });

    const content = document.getElementById('page-content');
    if (error) {
        content.innerHTML = `<a class="back-link no-print" href="students.html">← Back to Students</a>
            <div class="empty-state"><h3 style="color:var(--red)">Couldn't load the record</h3><p>${escapeHtml(error.message)}</p></div>`;
        return;
    }

    const list = data || [];
    const rowsHtml = list.map(w => `
        <tr>
            <td style="white-space:nowrap;">${fmtDateTime(w.created_at)}</td>
            <td>${escapeHtml(TYPE_LABEL[w.type] || w.type)}</td>
            <td>${escapeHtml(w.course_name || '—')}</td>
            <td>${escapeHtml(w.detail || '')}</td>
            <td style="font-size:12px;">${w.channel === 'email' ? 'Email → ' + escapeHtml(w.email_to || '') + (w.delivered ? ' · <span style="color:var(--green)">sent ✓</span>' : ' · <span style="color:var(--red)">send failed</span>') : escapeHtml(w.channel)}</td>
        </tr>`).join('');

    const table = list.length
        ? `<div class="panel" style="overflow-x:auto;"><table class="data-table"><thead><tr><th>Date &amp; time</th><th>Type</th><th>Course</th><th>Detail</th><th>How it was sent</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`
        : `<div class="empty-state"><h3>No warnings on record</h3><p>The system hasn't sent this student any low-attendance or low-grade warnings.</p></div>`;

    content.innerHTML = `
        <a class="back-link no-print" href="students.html">← Back to Students</a>
        <div id="report">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
                <div>
                    <div style="font-size:12px;font-weight:700;letter-spacing:.4px;color:var(--crimson);text-transform:uppercase;">Medical Doctor Academy — Notification Record</div>
                    <h2 style="margin:4px 0 2px;font-size:21px;color:var(--navy-800);">${escapeHtml(name)}</h2>
                    <p style="margin:0;font-size:13px;color:var(--text-muted);">${escapeHtml(email)} &nbsp;·&nbsp; ${list.length} warning${list.length === 1 ? '' : 's'} on record &nbsp;·&nbsp; generated ${fmtDateTime(new Date().toISOString())}</p>
                </div>
                <button class="btn btn-primary no-print" onclick="window.print()">🖨 Print / Save as PDF</button>
            </div>
            ${table}
            <p style="margin-top:14px;font-size:12px;color:var(--text-muted);line-height:1.6;">This is an automatically generated record of warnings the system sent to the student. Each warning was delivered by email to the address on file and shown in the student's portal. Records are kept permanently and cannot be edited.</p>
        </div>`;
}
