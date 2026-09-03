// First-login guided tour for the ADMIN portal. Shows once (per browser,
// per user) with Next / Back / Skip. Call maybeStartTour(uid) after the
// layout renders; startTour(uid) forces it (e.g. a Replay button).

(function () {
    const STEPS = [
        { sel: null, title: 'Welcome to the office portal 👋', text: "Here's a quick tour of where everything is. You can skip it any time — it only shows once." },
        { sel: '.nav-item[href="dashboard.html"]', title: '🏠 Dashboard', text: 'A quick snapshot of the academy — student counts and recent activity.' },
        { sel: '.nav-item[href="courses.html"]', title: '🎓 Courses', text: 'A course groups subjects and enrolled students. Open one to assign subjects, exams, teachers and recordings.' },
        { sel: '.nav-item[href="subjects.html"]', title: '📚 Subjects', text: 'Where teaching content lives — presentations, video lectures, quizzes and notes. Toggle visibility to release items to students.' },
        { sel: '.nav-item[href="exams.html"]', title: '📝 Exams', text: 'Create multiple-choice or PDF exams. You can also import questions from a PDF, or from the Question Bank.' },
        { sel: '.nav-item[href="gradebook.html"]', title: '📊 Gradebook', text: 'Enter and manage grades per course — exams, orals and quizzes roll into each student’s overall score.' },
        { sel: '.nav-item[href="attendance.html"]', title: '🗓️ Attendance', text: 'Open the register for a class and mark who’s present. Students below the minimum are warned automatically.' },
        { sel: '.nav-item[href="recordings.html"]', title: '🎥 Zoom Recordings', text: 'Add class recordings and the live Zoom join links students use — reorder the links with the ▲ ▼ arrows.' },
        { sel: '.nav-item[href="staff.html"]', title: '💬 Students & Messages', text: 'From a student’s row you can write feedback or read their messages. The bell and badges flag anything new from students.' },
        { sel: '#avatar-btn', title: '👤 Your profile', text: 'Tap your picture to upload a photo, and set your role, specialty and bio so students know who you are.' },
        { sel: '.nav-item[href="guide.html"]', title: "You're all set 🎉", text: 'Want to see this again? Open the User Guide any time and tap “Replay the welcome tour”. There’s a full written guide there too.' },
    ];

    let idx = 0, uid = null, ov = null, prevHi = null;
    function key(u) { return 'mda_admin_tour_' + (u || 'anon'); }

    function ensure() {
        if (ov) return;
        ov = document.createElement('div');
        ov.className = 'tour-overlay';
        ov.innerHTML = `
            <div class="tour-card" id="tour-card">
                <button class="tour-skip" id="tour-skip">Skip</button>
                <div class="tour-title" id="tour-title"></div>
                <div class="tour-text" id="tour-text"></div>
                <div class="tour-foot">
                    <div class="tour-dots" id="tour-dots"></div>
                    <div class="tour-btns">
                        <button class="tour-btn ghost" id="tour-back">Back</button>
                        <button class="tour-btn primary" id="tour-next">Next</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(ov);
        document.getElementById('tour-skip').onclick = finish;
        document.getElementById('tour-back').onclick = () => { if (idx > 0) { idx--; show(); } };
        document.getElementById('tour-next').onclick = () => { if (idx < STEPS.length - 1) { idx++; show(); } else { finish(); } };
        document.addEventListener('keydown', onKey);
    }
    function onKey(e) {
        if (!ov || !ov.classList.contains('open')) return;
        if (e.key === 'Escape') finish();
        else if (e.key === 'ArrowRight' || e.key === 'Enter') document.getElementById('tour-next').click();
        else if (e.key === 'ArrowLeft') document.getElementById('tour-back').click();
    }
    function clearHi() { if (prevHi) { prevHi.classList.remove('tour-highlight'); prevHi = null; } }

    function show() {
        const step = STEPS[idx];
        document.getElementById('tour-title').textContent = step.title;
        document.getElementById('tour-text').textContent = step.text;
        document.getElementById('tour-back').style.visibility = idx === 0 ? 'hidden' : 'visible';
        document.getElementById('tour-next').textContent = idx === STEPS.length - 1 ? 'Finish' : 'Next';
        document.getElementById('tour-dots').innerHTML = STEPS.map((_, i) => `<span class="tour-dot ${i === idx ? 'on' : ''}"></span>`).join('');
        clearHi();
        const card = document.getElementById('tour-card');
        const target = step.sel ? document.querySelector(step.sel) : null;
        if (target) {
            target.classList.add('tour-highlight');
            prevHi = target;
            try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
            positionCard(card, target);
        } else {
            card.classList.add('centered'); card.style.left = ''; card.style.top = '';
        }
    }

    // Place the card beside the target, always kept fully inside the screen.
    function positionCard(card, target) {
        card.classList.remove('centered');
        card.style.left = '0px'; card.style.top = '0px';
        const vw = window.innerWidth, vh = window.innerHeight, gap = 14, pad = 12;
        const cw = Math.min(card.offsetWidth || 340, vw - pad * 2);
        const ch = card.offsetHeight || 220;
        const r = target.getBoundingClientRect();
        let left, top;
        if (vw - r.right >= cw + gap + pad) { left = r.right + gap; top = r.top; }
        else if (r.left >= cw + gap + pad) { left = r.left - cw - gap; top = r.top; }
        else if (vh - r.bottom >= ch + gap + pad) { left = r.left + r.width / 2 - cw / 2; top = r.bottom + gap; }
        else { left = r.left + r.width / 2 - cw / 2; top = r.top - ch - gap; }
        left = Math.max(pad, Math.min(left, vw - cw - pad));
        top = Math.max(pad, Math.min(top, vh - ch - pad));
        card.style.left = left + 'px'; card.style.top = top + 'px';
    }

    function start() { idx = 0; ensure(); ov.classList.add('open'); show(); }
    function finish() { clearHi(); if (ov) ov.classList.remove('open'); try { localStorage.setItem(key(uid), '1'); } catch (e) {} }

    window.maybeStartTour = function (userId) {
        uid = userId || null;
        try { if (localStorage.getItem(key(uid))) return; } catch (e) { return; }
        setTimeout(start, 500);
    };
    window.startTour = function (userId) { uid = userId || uid; start(); };
})();
