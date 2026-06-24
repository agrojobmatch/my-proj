// public/js/student.js
import { auth, db } from './firebase.js';
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { collection, doc, query, where, getDocs, onSnapshot, addDoc, updateDoc, deleteDoc, serverTimestamp, orderBy, runTransaction, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

window.user = null;
window.globalJobs = [];
window.currentAnnouncements = [];
window.allCycles = [];

window.escapeHtml = function(text) { return text ? text.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;") : ""; };

// ฟังก์ชันส่ง Email (สำหรับแจ้งเตือนอาจารย์เวลาส่งงาน/ยกเลิกงาน)
window.sendEmailNotify = async function(emailTo, subject, message) {
    const gasURL = "https://script.google.com/macros/s/AKfycbxU3PrHjFtc3kZo3_9ThP1LbrlqRGJkEC3pYnBhx7UNFZOUocQ0SYxUgDBGcmsIXUN9tQ/exec"; 
    try { await fetch(gasURL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ to: emailTo, subject: subject, body: message }) }); } catch(e) { console.error("Email Error", e); }
};

// 1. ตรวจสอบสิทธิ์การเข้าถึงหน้าเว็บ (Route Protection)
onAuthStateChanged(auth, async (fbUser) => {
    if (fbUser) {
        Swal.fire({ title: 'กำลังตรวจสอบข้อมูล...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        try {
            // ✅ 1. หารอบปัจจุบันเหมือนฝั่ง auth.js
            const cyclesSnap = await getDocs(collection(db, "cycles"));
            let currentCycle = null;
            const today = new Date(); 
            today.setHours(0,0,0,0);
            
            cyclesSnap.forEach(d => {
                let c = d.data();
                let startDate = new Date(c.start + "T00:00:00"), 
                    endDate = new Date(c.end + "T23:59:59");
                if (today >= startDate && today <= endDate) {
                    currentCycle = c.name;
                }
            });
            
            if (!currentCycle && cyclesSnap.size > 0) {
                const sorted = Array.from(cyclesSnap.docs)
                    .map(d => ({ ...d.data(), id: d.id }))
                    .sort((a, b) => new Date(b.start) - new Date(a.start));
                if (sorted.length > 0) currentCycle = sorted[0].name;
            }

            // ✅ 2. ดึงข้อมูลนักศึกษาเฉพาะรอบปัจจุบันมาเก็บไว้เป็น window.user
            const q = query(
                collection(db, "users"), 
                where("email", "==", fbUser.email), 
                where("role", "==", "Student"),
                where("year", "==", currentCycle)
            );
            const snap = await getDocs(q);
            
            if (!snap.empty) {
                let profiles = [];
                snap.forEach(d => {
                    let uData = d.data();
                    uData.id = d.id; 
                    profiles.push(uData);
                });
                // ให้ระบบจำโปรไฟล์ของรอบนี้
                window.user = profiles[0]; 
                
                // โหลดรอบทั้งหมดมาเก็บไว้ (ถ้ามีเมนูให้ดูย้อนหลัง)
                const cyclesSnap2 = await getDocs(collection(db, "cycles"));
                window.allCycles = [];
                cyclesSnap2.forEach(d => { 
                    let c = d.data();
                    if(!c.name) c.name = d.id; 
                    window.allCycles.push(c); 
                });

                window.allCycles.sort((a, b) => {
                    let timeA = a.start || a.createdAt || a.name || "";
                    let timeB = b.start || b.createdAt || b.name || "";
                    return timeB.toString().localeCompare(timeA.toString());
                });

                // อัปเดตชื่อและรอบบนหน้าจอ
                document.getElementById('uName').innerText = window.user.name;
                if(document.getElementById('navYearBadge')) 
                    document.getElementById('navYearBadge').innerText = window.user.year;
                
                if (typeof setupStudentMenu === "function") setupStudentMenu();
                
                Swal.close();
                // โหลดข้อมูลงานและประกาศของรอบปัจจุบัน
                if (typeof loadDataFB === "function") loadDataFB();
                if (typeof loadAnnouncementsFB === "function") loadAnnouncementsFB();
            } else {
                // ถ้าไม่มีข้อมูลในรอบนี้ ให้เตะออก
                await signOut(auth);
                window.location.href = 'index.html'; 
            }
        } catch (err) {
            Swal.fire('เกิดข้อผิดพลาด', err.message, 'error');
            window.location.href = 'index.html';
        }
    } else {
        window.location.href = 'index.html';
    }
});

// ฟังก์ชันสร้างเมนู
function setupStudentMenu() {
    let navHtml = `
      <li class="nav-item"><button class="nav-link active" onclick="window.switchPage('page-announcement', this)"><i class="bi bi-megaphone me-1"></i>ประกาศงาน</button></li>
      <li class="nav-item"><button class="nav-link" onclick="window.switchPage('page-stu-post', this)"><i class="bi bi-clock me-1"></i>ลงเวลาว่าง</button></li>
      <li class="nav-item"><button class="nav-link" onclick="window.switchPage('page-stu-active', this)"><i class="bi bi-calendar-check me-1"></i>งานของฉัน</button></li>
      <li class="nav-item"><button class="nav-link" onclick="window.switchPage('page-stu-history', this)"><i class="bi bi-file-text me-1"></i>ประวัติ</button></li>
      <li class="nav-item"><button class="nav-link" onclick="window.switchPage('page-stu-finance', this)"><i class="bi bi-wallet2 me-1"></i>การเงิน</button></li>
    `;
    document.getElementById('nav-menu-items').innerHTML = navHtml;
}

// ระบบ นำทาง (Navigation)
window.logoutSystemFB = async function() { await signOut(auth); window.location.href = 'index.html'; };
window.switchPage = function(pageId, linkElement) {
    document.querySelectorAll('.content-page').forEach(el => el.classList.add('hidden'));
    document.getElementById(pageId).classList.remove('hidden');
    if(linkElement) { 
        document.querySelectorAll('.navbar-nav .nav-link').forEach(el => el.classList.remove('active')); 
        linkElement.classList.add('active'); 
        let navCollapse = document.getElementById('navbarNav'); 
        if(navCollapse && navCollapse.classList.contains('show')) new bootstrap.Collapse(navCollapse).hide(); 
    }
    if(pageId === 'page-stu-finance') window.loadFinanceDataFB();
};
window.goHome = function() { 
    document.querySelectorAll('.navbar-nav .nav-link').forEach(el => el.classList.remove('active')); 
    window.switchPage('page-announcement'); 
    document.querySelectorAll('.navbar-nav .nav-link')[0].classList.add('active'); 
};

// ==========================================
// ส่วนที่ 1: การโหลดข้อมูลงาน และ จัดการตารางงาน
// ==========================================
function loadDataFB() {
    let currentYear = window.user.year || "1/2568";
const q = query(collection(db, "jobs"), 
    where("studentEmail", "==", window.user.email), 
    where("year", "==", window.user.year) 
);
    // เพิ่ม error callback เพื่อให้เตือนกรณีลืมทำ Index ใน Firebase
    onSnapshot(q, (snap) => {
        window.globalJobs = []; let tH = 0, dC = 0, sumRate=0, countRate=0;
        snap.forEach(doc => { 
            let j = doc.data(); j.id = doc.id; window.globalJobs.push(j); 
            if(j.status === 'Completed') {
                tH += parseFloat(j.hours||0); dC++;
                if(j.rating) { sumRate += parseFloat(j.rating); countRate++; }
            }
        });
        
        let lim = window.user.limit || 40; let pct = lim > 0 ? (tH/lim)*100 : 0;
        document.getElementById('stu-progress-text').innerText = `${tH.toFixed(2)} / ${lim} ชม.`;
        document.getElementById('stu-progress-percent').innerText = Math.min(pct,100).toFixed(0)+"%";
        let bar = document.getElementById('stu-progress-bar'); 
        bar.style.width = Math.min(pct, 100) + "%"; 
        bar.className = `progress-bar ${pct>=100?'bg-success':(pct>=50?'bg-warning text-dark':'bg-primary')}`;
        document.getElementById('stuMyRating').innerText = countRate > 0 ? (sumRate/countRate).toFixed(1) : "0.0";
        
        renderStudent(window.globalJobs);
    }, (error) => {
        console.error("Firestore Index Error (คลิกลิงก์ด้านล่างเพื่อสร้างดัชนี): ", error);
    });
}

function renderStudent(list) {
    let aHtml = '', hHtml = '', tH = 0, dC = 0;
    if(list.length === 0) { 
        aHtml = '<div class="text-center text-muted py-5 bg-white rounded-3 shadow-sm">ไม่มีงานที่กำลังดำเนินการ</div>'; 
        hHtml = '<div class="text-center text-muted py-5">ไม่มีประวัติ</div>'; 
    }
    
    list.forEach(i => {
        if(i.status == 'Completed') { dC++; tH += parseFloat(i.hours)||0; }
        
        // แก้ไขป้ายสถานะ Expired ให้ถูกต้อง
        let badge = i.status=='Available'?'badge-soft-info':(i.status=='Booked'?'badge-soft-warning':(i.status=='PendingApproval'?'bg-primary text-white':(i.status=='Expired'?'bg-secondary text-white':'badge-soft-success')));
        let sText = i.status == 'Available' ? 'ว่าง (รอจอง)' : (i.status == 'Booked' ? 'ถูกจองแล้ว' : (i.status == 'PendingApproval' ? 'รอตรวจสอบ' : (i.status == 'Expired' ? 'หมดอายุ' : 'เสร็จสิ้น')));
        
        let action = '';
        if(i.status == 'Booked') {
            let today = new Date(); today.setHours(0, 0, 0, 0);
            let dParts = i.date.split('-');
            let jobDate = new Date(dParts[0], dParts[1] - 1, dParts[2]); jobDate.setHours(0, 0, 0, 0);

            if (today >= jobDate) { 
                action = `<div class="mt-3 bg-light p-3 rounded-3"><div class="input-group input-group-sm mb-2"><span class="input-group-text bg-white">เริ่ม</span><input type="time" id="s-${i.id}" class="form-control"><span class="input-group-text bg-white">จบ</span><input type="time" id="e-${i.id}" class="form-control"></div><button onclick="window.confirmSendJobFB('${i.id}')" class="btn btn-warning btn-sm w-100 fw-bold shadow-sm mb-2">ส่งงาน</button></div>`; 
            } 
            else { 
                action = `<div class="mt-3 p-2 bg-light border text-center small text-muted rounded-pill mb-2"><i class="bi bi-lock-fill text-warning me-1"></i> จะสามารถส่งงานได้ตั้งแต่วันที่ ${i.date}</div>`; 
            }
            if(i.announcementId) { 
                action += `<button onclick="window.confirmCancelStudentJobFB('${i.id}', '${i.announcementId}')" class="btn btn-outline-danger btn-sm w-100 rounded-pill mt-1">ยกเลิกการรับงานนี้</button>`; 
            }
        }
        else if (i.status == 'Available') action = `<div class="mt-3 d-flex gap-2"><button onclick="window.openEditFB('${i.id}', '${i.date}', '${i.time}')" class="btn btn-outline-secondary btn-sm flex-fill rounded-pill">แก้ไข</button><button onclick="window.confirmDelJobFB('${i.id}')" class="btn btn-outline-danger btn-sm flex-fill rounded-pill">ลบ</button></div>`;
        else if (i.status == 'PendingApproval') action = `<div class="mt-3 p-2 bg-light text-center small text-primary fw-bold rounded-pill"><i class="bi bi-hourglass-split"></i> รอตรวจสอบ</div>`;
        
        let typ = i.jobType==='Piecework' ? `<div class="badge bg-info text-dark mb-2">เหมาจ่าย ${i.fixedHours} ชม.</div>` : '';
        let ratingHtml = '';
        if(i.status == 'Completed' && i.rating) { 
            ratingHtml = `<div class="mt-2 p-2 bg-warning bg-opacity-10 rounded small border-start border-3 border-warning"><div class="text-warning fw-bold"><i class="bi bi-star-fill"></i> ให้คะแนน: ${i.rating}/5</div>${i.review ? `<div class="text-dark fst-italic mt-1">"${escapeHtml(i.review)}"</div>` : ''}</div>`; 
        }

        let c = `<div class="col-12 mb-3"><div class="card p-3 shadow-sm border-0 h-100"><div class="d-flex justify-content-between align-items-center mb-2"><div class="fw-bold text-dark"><i class="bi bi-calendar-event me-2 text-primary"></i>${i.date}</div><span class="badge ${badge}">${sText}</span></div>${typ}<div class="small text-muted mb-2"><i class="bi bi-clock me-2"></i> ${i.time} ${i.timeReal ? `(เวลาทำจริง: ${i.timeReal})` : ''}</div>${i.teacherName ? `<div class="mt-2 small bg-light p-2 rounded"><div><i class="bi bi-person-fill text-primary"></i> <b>${escapeHtml(i.teacherName)}</b></div><div><i class="bi bi-card-text"></i> ${escapeHtml(i.task)}</div></div>` : ''}${i.status == 'Completed' ? `<div class="mt-2 small text-success fw-bold p-2 bg-success bg-opacity-10 rounded"><i class="bi bi-check-circle-fill me-1"></i> เสร็จสิ้น (${i.hours} ชม.)</div>` : ''}${ratingHtml}${action}</div></div>`;
        
        // แยกเข้าหมวดประวัติหากเสร็จสิ้นหรือหมดอายุ
        if(i.status == 'Completed' || i.status == 'Expired') { hHtml += c; } 
        else aHtml += c;
    });

    document.getElementById('stuTotalHours').innerText = tH.toFixed(2); 
    document.getElementById('stuDoneCount').innerText = dC;
    document.getElementById('stuActiveList').innerHTML = `<div class="row">${aHtml || '<div class="col-12 text-center text-muted py-4">ไม่มีงานค้าง</div>'}</div>`;
    document.getElementById('stuHistoryList').innerHTML = `<div class="row">${hHtml || '<div class="col-12 text-center text-muted py-4">ไม่มีประวัติ</div>'}</div>`;
}

// ลงเวลาว่าง
window.confirmAddJobFB = async function() {
    let currentTotalHours = 0; 
    window.globalJobs.forEach(j => { if(j.status === 'Completed' || j.status === 'PendingApproval') currentTotalHours += parseFloat(j.hours||0); });
    let limit = parseFloat(window.user.limit) || 40;
    
    if (currentTotalHours >= limit) return Swal.fire('ไม่อนุญาต', `ชั่วโมงทำงานสะสมของคุณเต็มแล้ว (${currentTotalHours.toFixed(1)}/${limit} ชม.)\nระบบไม่อนุญาตให้ลงเวลาว่างเพิ่ม`, 'error');

    const d = document.getElementById('sDate').value, s = document.getElementById('sTimeStart').value, e = document.getElementById('sTimeEnd').value;
    if(!d||!s||!e) return Swal.fire('เตือน', 'กรอกเวลาให้ครบทุกช่อง', 'warning');
    
    let sm = parseInt(s.split(':')[0])*60 + parseInt(s.split(':')[1]), em = parseInt(e.split(':')[0])*60 + parseInt(e.split(':')[1]);
    if ((em - sm) < 120) return Swal.fire('เวลาไม่ถูกต้อง', 'ต้องลงเวลาอย่างน้อย 2 ชั่วโมง', 'warning');
    
    Swal.fire({ title: 'กำลังบันทึก...', didOpen: ()=>Swal.showLoading() });
    try {
        await addDoc(collection(db, "jobs"), { 
            studentEmail: window.user.email, stuName: window.user.name, 
            studentId: window.user.studentId||'', major: window.user.major||'', phone: window.user.phone||'', 
            year: window.user.year, date: d, time: `${s} - ${e}`, 
            status: "Available", jobType: "General", hours: 0, createdAt: serverTimestamp() 
        });
        Swal.fire('สำเร็จ', 'ลงเวลาว่างเรียบร้อย', 'success'); 
        document.getElementById('sDate').value=''; document.getElementById('sTimeStart').value=''; document.getElementById('sTimeEnd').value=''; 
        window.switchPage('page-stu-active');
    } catch(e) { Swal.fire('ผิดพลาด', e.message, 'error'); }
};

// แก้ไข / ลบ เวลาว่าง
window.openEditFB = function(id,d,t) { 
    let p=t.split(' - '); 
    document.getElementById('edit-id').value=id; document.getElementById('edit-date').value=d; 
    document.getElementById('edit-start').value=p[0]; document.getElementById('edit-end').value=p[1]; 
    bootstrap.Modal.getOrCreateInstance(document.getElementById('editModal')).show(); 
};
window.confirmSaveEditFB = async function() { 
    try { 
        await updateDoc(doc(db, "jobs", document.getElementById('edit-id').value), { 
            date: document.getElementById('edit-date').value, 
            time: `${document.getElementById('edit-start').value} - ${document.getElementById('edit-end').value}` 
        }); 
        Swal.fire('สำเร็จ','','success'); 
        bootstrap.Modal.getInstance(document.getElementById('editModal')).hide(); 
    } catch(e) { Swal.fire('ผิดพลาด', e.message, 'error'); } 
};
window.confirmDelJobFB = async function(id) { 
    Swal.fire({title:'ลบรายการ?',icon:'error',showCancelButton:true}).then(async r=>{ 
        if(r.isConfirmed) { 
            try { await deleteDoc(doc(db, "jobs", id)); Swal.fire('ลบแล้ว','','success'); } catch(e) { Swal.fire('ผิดพลาด', e.message, 'error'); } 
        } 
    }); 
};

// ==========================================
// ส่วนที่ 2: ระบบประกาศงาน และ การรับงาน
// ==========================================
function loadAnnouncementsFB() { 
    onSnapshot(query(collection(db, "announcements"), orderBy("createdAt", "desc")), (snap) => {
        window.currentAnnouncements = []; let h = '';
        snap.forEach(doc => { let d=doc.data(); d.id=doc.id; window.currentAnnouncements.push(d); });
        
        let list = window.currentAnnouncements.filter(a => !a.year || a.year === window.user.year);
        
        let today = new Date(); today.setHours(0, 0, 0, 0); 
        list = list.filter(a => {
            if(!a.workDate) return true;
            let dParts = a.workDate.split(' เวลา ')[0].split('-');
            if (dParts.length === 3) {
                let jobDate = new Date(dParts[0], dParts[1] - 1, dParts[2]); jobDate.setHours(0, 0, 0, 0);
                return jobDate >= today; 
            }
            return true;
        });

        if(document.getElementById('announce-year-badge')) document.getElementById('announce-year-badge').innerText = window.user.year;
        
        if(list.length === 0) { 
            document.getElementById('announceList').innerHTML = `<div class="col-12"><div class="text-center py-5 text-muted bg-white rounded-4 shadow-sm">ยังไม่มีประกาศงานใหม่</div></div>`; 
            return; 
        }
        
        list.forEach(i => {
            let cur = i.currentCount || 0; let pct = (cur/i.capacity)*100; let hasAp = (i.applicants || []).includes(window.user.email);
            let now = new Date(); let isOpeningSoon = false; let isExpired = false; let openLabel = '';
            
            if (i.openDate && i.openTime) { let openDt = new Date(`${i.openDate}T${i.openTime}`); if (now < openDt) { isOpeningSoon = true; openLabel = `${i.openDate.split('-').reverse().join('/')} ${i.openTime} น.`; } }
            if (i.closeDate && i.closeTime) { let closeDt = new Date(`${i.closeDate}T${i.closeTime}`); if (now > closeDt) isExpired = true; }

            if(i.workDate) {
                let jdParts = i.workDate.split(' เวลา ')[0].split('-');
                if (jdParts.length === 3) { let jobDate = new Date(jdParts[0], jdParts[1] - 1, jdParts[2]); jobDate.setHours(23, 59, 59, 999); if (now > jobDate) isExpired = true; }
            }

            let isManualClosed = i.isOpen === false; let isF = (cur >= i.capacity);

            let studentBtn = '';
            if (hasAp) studentBtn = `<button class="btn btn-secondary w-100 disabled rounded-pill">รับงานแล้ว</button>`;
            else if (isManualClosed) studentBtn = `<button class="btn btn-outline-danger w-100 disabled rounded-pill">ปิดรับชั่วคราว</button>`;
            else if (isExpired) studentBtn = `<button class="btn btn-outline-secondary w-100 disabled rounded-pill">หมดเวลารับสมัคร</button>`;
            else if (isF) studentBtn = `<button class="btn btn-outline-danger w-100 disabled rounded-pill">เต็มแล้ว</button>`;
            else if (isOpeningSoon) studentBtn = `<button class="btn btn-outline-primary w-100 disabled rounded-pill" style="font-size:0.85rem;"><i class="bi bi-clock-history"></i> เปิดรับ: ${openLabel}</button>`;
            else studentBtn = `<button onclick="window.confirmApplyFB('${i.id}', '${escapeHtml(i.topic)}')" class="btn btn-primary w-100 rounded-pill shadow-sm">🖐️ รับงานนี้</button>`;

            let vBtn = `<button onclick="window.openViewAnnouncementModalFB('${i.id}')" class="btn btn-outline-secondary btn-sm w-100 rounded-pill mb-2"><i class="bi bi-info-circle me-1"></i> ดูรายละเอียดงาน</button>`;
            let tBad = i.jobType === 'Piecework' ? `<span class="badge bg-info text-dark border me-1"><i class="bi bi-box-seam me-1"></i>เหมา</span>` : `<span class="badge bg-light text-secondary border me-1"><i class="bi bi-clock me-1"></i>ชม.</span>`;
            let countBadge = `<span class="badge bg-white text-primary border border-primary rounded-pill me-1"><i class="bi bi-people-fill"></i> ${cur}/${i.capacity}</span>`;
            let statusBadge = isManualClosed ? '<span class="badge bg-danger rounded-pill">ปิดชั่วคราว</span>' : (isExpired ? '<span class="badge bg-secondary rounded-pill">หมดเวลา</span>' : (isF ? '<span class="badge bg-secondary rounded-pill">เต็ม</span>' : (isOpeningSoon ? '<span class="badge bg-warning text-dark rounded-pill">รอเปิด</span>' : '<span class="badge bg-success rounded-pill">เปิดรับ</span>')));

            h += `<div class="col-12 col-md-6 col-lg-4"><div class="card card-announce h-100 border-0"><div class="card-body p-4"><div class="mb-2">${tBad} ${countBadge} ${statusBadge}</div><div class="d-flex justify-content-between align-items-start mb-3"><h6 class="fw-bold text-dark mb-0 text-truncate" style="max-width:100%; font-size: 1.1rem;">${escapeHtml(i.topic)}</h6></div><div class="small text-muted mb-3 d-flex align-items-center"><div class="bg-light rounded-circle p-2 me-2"><i class="bi bi-person-fill text-primary"></i></div>${escapeHtml(i.teacherName)}</div><div class="progress mb-3" style="height: 6px; background-color: #f1f1f1;"><div class="progress-bar ${(isF||isExpired||isManualClosed)?'bg-danger':'bg-success'}" style="width: ${Math.min(pct, 100)}%; border-radius: 10px;"></div></div><div class="small bg-light p-3 rounded-3 mb-3"><div class="mb-1"><i class="bi bi-calendar-event me-2 text-secondary"></i> ${i.workDate}</div><div class="text-truncate"><i class="bi bi-geo-alt me-2 text-secondary"></i> ${escapeHtml(i.location)}</div></div><p class="card-text small text-secondary mb-0 text-truncate" style="max-height:3em;">${escapeHtml(i.desc)}</p></div><div class="card-footer bg-white border-0 pb-4 pt-0 px-4">${vBtn}${studentBtn}</div></div></div>`;
        });
        document.getElementById('announceList').innerHTML = h;
    });
}

window.openViewAnnouncementModalFB = function(id) { 
    const i = window.currentAnnouncements.find(x => x.id == id); 
    if(!i) return; 
    document.getElementById('view-topic').innerText = i.topic; 
    document.getElementById('view-teacher').innerText = i.teacherName; 
    document.getElementById('view-date').innerText = i.workDate; 
    document.getElementById('view-location').innerText = i.location; 
    document.getElementById('view-desc').innerText = i.desc || '-'; 
    bootstrap.Modal.getOrCreateInstance(document.getElementById('viewAnnouncementModal')).show(); 
};

window.confirmApplyFB = async function(id, topic) {
    let currentTotalHours = 0; 
    window.globalJobs.forEach(j => { if(j.status === 'Completed' || j.status === 'PendingApproval') currentTotalHours += parseFloat(j.hours||0); });
    let limit = parseFloat(window.user.limit) || 40;
    
    if (currentTotalHours >= limit) return Swal.fire('ไม่อนุญาต', `ชั่วโมงทำงานสะสมของคุณเต็มแล้ว (${currentTotalHours.toFixed(1)}/${limit} ชม.)\nระบบไม่อนุญาตให้รับงานเพิ่ม`, 'error');

    Swal.fire({ title: 'ยืนยันรับงานนี้?', text: `คุณต้องการลงเวลาทำงาน: ${topic} ใช่หรือไม่?`, icon: 'question', showCancelButton: true, confirmButtonText: 'ยืนยันรับงาน' }).then(async (r) => {
        if (r.isConfirmed) {
            Swal.fire({ title: 'กำลังตรวจสอบคิวและบันทึกข้อมูล...', didOpen: () => Swal.showLoading() });
            try {
                const docRef = doc(db, "announcements", id); let finalData = null;
                await runTransaction(db, async (transaction) => {
                    const docSnap = await transaction.get(docRef);
                    if (!docSnap.exists()) throw new Error("NOT_FOUND");
                    let data = docSnap.data(); let apps = data.applicants || [];
                    if (data.isOpen === false) throw new Error("CLOSED");
                    if (apps.length >= data.capacity) throw new Error("FULL");
                    if (apps.includes(window.user.email)) throw new Error("ALREADY_APPLIED");
                    
                    let expectedHrs = 0;
                    if (data.jobType === 'Piecework') { expectedHrs = parseFloat(data.fixedHours || 0); } 
                    else {
                        if (data.workDate && data.workDate.includes(' เวลา ')) {
                            let tArr = data.workDate.split(' เวลา ')[1].split('-');
                            if(tArr.length === 2) {
                                let sm = parseInt(tArr[0].split(':')[0])*60 + parseInt(tArr[0].split(':')[1]), em = parseInt(tArr[1].split(':')[0])*60 + parseInt(tArr[1].split(':')[1]);
                                expectedHrs = (em - sm) / 60;
                            }
                        }
                    }
                    if (currentTotalHours + expectedHrs > limit) throw new Error(`OVER_LIMIT:${expectedHrs}`);

                    apps.push(window.user.email); transaction.update(docRef, { applicants: apps, currentCount: apps.length });
                    let datePart = data.workDate, timePart = "-";
                    if (data.workDate.includes(' เวลา ')) { let parts = data.workDate.split(' เวลา '); datePart = parts[0]; timePart = parts[1]; }
                    const newJobRef = doc(collection(db, "jobs"));
                    transaction.set(newJobRef, { studentEmail: window.user.email, stuName: window.user.name, studentId: window.user.studentId || '', major: window.user.major || '', phone: window.user.phone || '', year: window.user.year, date: datePart, time: timePart, status: "Booked", jobType: data.jobType || "General", fixedHours: data.fixedHours || 0, hours: 0, teacherName: data.teacherName, teacherEmail: data.teacherEmail, task: data.topic, location: data.location, announcementId: id, createdAt: serverTimestamp() });
                    finalData = data; 
                });
                if (finalData) {
                    let subject = `📌 มีนักศึกษารับงานของคุณ: ${topic}`; let emailMsg = `เรียน ${finalData.teacherName},\n\nขณะนี้ นักศึกษา ${window.user.name} ได้กดรับงานหัวข้อ: "${topic}" ของคุณเรียบร้อยแล้ว\n\nสามารถตรวจสอบรายชื่อผู้สมัครได้ในระบบ:\nhttps://agro-job-match.web.app`;
                    window.sendEmailNotify(finalData.teacherEmail, subject, emailMsg);
                    Swal.fire('สำเร็จ!', 'คุณได้รับงานนี้แล้ว!\nตรวจสอบรายละเอียดได้ที่เมนู "งานของฉัน"', 'success'); window.switchPage('page-stu-active', document.querySelectorAll('.navbar-nav .nav-link')[2]);
                }
            } catch(e) { 
                if (e.message === "CLOSED") Swal.fire('เสียใจด้วย!', 'ปิดรับสมัครงานนี้ชั่วคราวแล้ว', 'error');
                else if (e.message === "FULL") Swal.fire('ช้าไปนิดเดียว!', 'งานนี้เต็มจำนวนแล้ว', 'error');
                else if (e.message === "ALREADY_APPLIED") Swal.fire('เตือน', 'คุณรับงานนี้ไปแล้ว', 'warning');
                else if (e.message === "NOT_FOUND") Swal.fire('ผิดพลาด', 'ไม่พบประกาศงานนี้ในระบบ อาจถูกลบไปแล้ว', 'error');
                else if (e.message.startsWith("OVER_LIMIT")) {
                    let hrs = e.message.split(':')[1];
                    Swal.fire('ไม่อนุญาตเด็ดขาด!', `งานนี้ใช้เวลาประมาณ ${parseFloat(hrs).toFixed(1)} ชม.\nซึ่งจะทำให้ชั่วโมงรวมของคุณเกินโควตา ${limit} ชม.\n(ปัจจุบันทำไปแล้ว ${currentTotalHours.toFixed(1)} ชม.)`, 'error');
                }
                else Swal.fire('ผิดพลาด', e.message, 'error'); 
            }
        }
    });
};

window.confirmCancelStudentJobFB = async function(jobId, annId) {
    Swal.fire({ title: 'ยืนยันยกเลิกรับงาน?', text: "คุณต้องการยกเลิกการรับงานนี้ใช่หรือไม่? ระบบจะลบงานนี้ออกและคืนโควตาให้ผู้อื่น", icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'ใช่, ยกเลิกรับงาน' }).then(async (result) => {
        if (result.isConfirmed) {
            Swal.fire({ title: 'กำลังยกเลิกงาน...', didOpen: () => Swal.showLoading() });
            try {
                const annRef = doc(db, "announcements", annId); const annSnap = await getDoc(annRef);
                if (annSnap.exists()) {
                    let data = annSnap.data(); let apps = data.applicants || []; const index = apps.indexOf(window.user.email);
                    if (index > -1) { apps.splice(index, 1); await updateDoc(annRef, { applicants: apps, currentCount: apps.length }); }
                    let subject = `⚠️ แจ้งเตือน: นักศึกษายกเลิกการรับงาน (${data.topic})`; let emailMsg = `เรียน ผู้ดูแลงาน,\n\nนักศึกษา ${window.user.name} ได้กดยกเลิกการรับงานในหัวข้อ: "${data.topic}"\n\nขณะนี้ระบบได้ทำการลบข้อมูลนักศึกษาออก และคืนโควตาผู้สมัครให้ผู้อื่นสามารถกดรับงานนี้ได้ตามปกติแล้ว\n\nตรวจสอบรายละเอียดเพิ่มเติมได้ที่ระบบ:\nhttps://agro-job-match.web.app`;
                    window.sendEmailNotify(data.teacherEmail, subject, emailMsg);
                } 
                await deleteDoc(doc(db, "jobs", jobId));
                Swal.fire('ยกเลิกแล้ว', 'คุณได้ยกเลิกการรับงานนี้เรียบร้อยแล้ว', 'success');
            } catch (e) { Swal.fire('ผิดพลาด', e.message, 'error'); }
        }
    });
};

// ==========================================
// ส่วนที่ 3: การส่งเวลาปฏิบัติงานจริง (จบงาน)
// ==========================================
window.confirmSendJobFB = async function(id) {
    const s = document.getElementById('s-'+id).value, e = document.getElementById('e-'+id).value;
    if(!s || !e) return Swal.fire('ระบุเวลาจริง', 'กรุณาระบุเวลาให้ครบถ้วน', 'warning');
    
    let sm = parseInt(s.split(':')[0])*60 + parseInt(s.split(':')[1]), em = parseInt(e.split(':')[0])*60 + parseInt(e.split(':')[1]); 
    let hrs = ((em - sm) / 60).toFixed(2);
    let jobData = window.globalJobs.find(x => x.id === id);
    
    if(jobData && jobData.jobType === 'Piecework' && jobData.fixedHours) { hrs = parseFloat(jobData.fixedHours).toFixed(2); } 
    else if(hrs <= 0) { return Swal.fire('เวลาไม่ถูกต้อง', 'เวลาเลิกงานต้องมากกว่าเวลาเริ่มงาน', 'warning'); }

    let currentTotalHours = 0;
    window.globalJobs.forEach(j => { if((j.status === 'Completed' || j.status === 'PendingApproval') && j.id !== id) { currentTotalHours += parseFloat(j.hours||0); } });
    let limit = parseFloat(window.user.limit) || 40;
    
    if (currentTotalHours + parseFloat(hrs) > limit) {
        let remain = limit - currentTotalHours;
        return Swal.fire('ส่งเวลาเกินไม่ได้!', `คุณเหลือโควตาเบิกได้อีกแค่ ${remain.toFixed(1)} ชม. (แต่รอบนี้จะเคลม ${hrs} ชม.)\nกรุณาแก้ไขเวลาให้พอดีกับโควตา หรือติดต่ออาจารย์`, 'error');
    }

    Swal.fire({ title: 'กำลังส่งงาน...', didOpen: ()=>Swal.showLoading() });
    try {
        await updateDoc(doc(db, "jobs", id), { status: "PendingApproval", timeReal: `${s}-${e}`, hours: parseFloat(hrs) });
        if (jobData && jobData.teacherEmail) {
            let subject = `📢 มีงานรอตรวจสอบ: ${jobData.task}`;
            let typeLabel = jobData.jobType === 'Piecework' ? `(งานเหมาจ่าย ${hrs} ชม.)` : '';
            let emailMsg = `สวัสดี  ${jobData.teacherName},\n\nนักศึกษา ${window.user.name} ได้กดส่งเวลาทำงานสำหรับงาน: "${jobData.task}" เข้ามาในระบบแล้ว\n\n📅 วันที่ทำ: ${jobData.date}\n⏰ เวลาที่ทำจริง: ${s} - ${e}\n⏱ ยอดชั่วโมงที่จะได้: ${hrs} ชั่วโมง ${typeLabel}\n\n👉 รบกวนเข้าสู่ระบบเพื่อตรวจสอบและกดอนุมัติงานให้นักศึกษา:\nhttps://agro-job-match.web.app`;
            window.sendEmailNotify(jobData.teacherEmail, subject, emailMsg);
        }
        Swal.fire('สำเร็จ', 'ส่งงานเรียบร้อยแล้ว ', 'success');
    } catch(e) { Swal.fire('ผิดพลาด', e.message, 'error'); }
};

// ==========================================
// ส่วนที่ 4: ระบบเบิกจ่ายเงิน (Finance & PDF) อัปเดตโหลดใหม่ได้
// ==========================================
window.loadFinanceDataFB = function() {
    let unpaid = window.globalJobs.filter(j => j.status === 'Completed' && !j.withdrawn);
    let h = '';
    if(unpaid.length === 0) h = '<tr><td colspan="4" class="text-center py-5 text-muted"><i class="bi bi-inbox fs-1 d-block mb-2 text-light-gray"></i>ไม่มีรายการที่เบิกได้</td></tr>';
    else { unpaid.forEach(j => { h += `<tr><td class="ps-4"><input type="checkbox" class="job-check form-check-input" value="${j.id}"></td><td><div class="fw-bold">${j.date}</div></td><td>${escapeHtml(j.task)}</td><td><span class="badge bg-light text-dark border">${j.hours}</span></td></tr>`; }); }
    document.getElementById('financeUnpaidList').innerHTML = h; 
    if (typeof window.loadFinHistoryFB === 'function') window.loadFinHistoryFB();
};

window.toggleJobChecks = function(src) { document.querySelectorAll('.job-check').forEach(c => c.checked = src.checked); };

window.confirmWithdrawalFB = async function() {
    let ids = Array.from(document.querySelectorAll('.job-check:checked')).map(c => c.value);
    if(ids.length === 0) return Swal.fire('แจ้งเตือน', 'กรุณาเลือกงานที่ต้องการเบิกเงิน', 'warning');
    
    Swal.fire({ title: 'กำลังสร้างเอกสาร PDF...', text: 'กรุณารอสักครู่ ระบบกำลังจัดหน้ากระดาษ (ห้ามปิดหน้าต่าง)', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    
    try {
        let tAmt = 0, tHours = 0;
        let rowsHtml = ''; 
        let jobsListToSave = []; // เก็บข้อมูลงานไว้โหลดใหม่

        let currentRate = 50; 
        const cycleSnap = window.allCycles.find(c => c.name === window.user.year);
        if (cycleSnap && cycleSnap.ratePerHour) currentRate = parseFloat(cycleSnap.ratePerHour);

        for(let i = 0; i < ids.length; i++) {
            let id = ids[i];
            let j = window.globalJobs.find(x => x.id === id);
            if(j) { 
                let hrs = parseFloat(j.hours||0);
                tHours += hrs;
                tAmt += hrs * currentRate; 
                let timeStr = j.timeReal || j.time;
                let tArr = timeStr.split('-');
                let formattedTime = `${tArr[0] ? tArr[0].trim() : '-'} - ${tArr[1] ? tArr[1].trim() : '-'}`;
                
                // เก็บ Array งาน
                jobsListToSave.push({ date: j.date, time: formattedTime, task: j.task || '-', teacherName: j.teacherName || '-', hours: hrs });
                
                rowsHtml += `
                    <tr>
                        <td style="border: 1px solid #000; padding: 10px 8px; text-align: center;">${i+1}</td>
                        <td style="border: 1px solid #000; padding: 10px 8px; text-align: center;">${j.date}</td>
                        <td style="border: 1px solid #000; padding: 10px 8px; text-align: center;">${formattedTime}</td>
                        <td style="border: 1px solid #000; padding: 10px 8px;">${j.task || '-'}</td>
                        <td style="border: 1px solid #000; padding: 10px 8px; text-align: center;">${j.teacherName || '-'}</td>
                        <td style="border: 1px solid #000; padding: 10px 8px; text-align: center;">${hrs.toFixed(1)}</td>
                    </tr>
                `;
            }
        }

        let dNum = "AGRO-" + new Date().getTime().toString().slice(-6);

        const pdfContainer = document.createElement('div');
        pdfContainer.innerHTML = `
            <div style="width: 100%; max-width: 800px; margin: 0 auto; font-family: 'Prompt', sans-serif; color: #000; background: #fff; padding: 30px;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <h4 style="margin: 0; font-weight: bold; font-size: 22px;">ใบเบิกเงินค่าตอบแทนนักศึกษาทุนทำงานแลกเปลี่ยน</h4>
                    <h5 style="margin: 8px 0 0 0; font-size: 18px;">คณะอุตสาหกรรมเกษตร มหาวิทยาลัยสงขลานครินทร์</h5>
                </div>
                <div style="margin-bottom: 20px; font-size: 16px; line-height: 1.8;">
                    <div style="display: flex; justify-content: space-between;">
                        <div><b>เลขที่เอกสาร:</b> ${dNum}</div><div><b>วันที่พิมพ์:</b> ${new Date().toLocaleDateString('th-TH')}</div>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-top: 5px;">
                        <div><b>ชื่อ-นามสกุล:</b> ${window.user.name}</div><div><b>รหัสนักศึกษา:</b> ${window.user.studentId || '-'}</div>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-top: 5px;">
                        <div><b>ปีการศึกษา:</b> ${window.user.year}</div><div><b>อัตราค่าจ้าง:</b> ${currentRate} บาท/ชั่วโมง</div>
                    </div>
                </div>
                <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 40px;">
                    <thead><tr style="background-color: #f1f1f1;"><th style="border: 1px solid #000; padding: 12px 8px; text-align: center; width: 8%;">ลำดับ</th><th style="border: 1px solid #000; padding: 12px 8px; text-align: center; width: 16%;">วันที่</th><th style="border: 1px solid #000; padding: 12px 8px; text-align: center; width: 18%;">เวลา</th><th style="border: 1px solid #000; padding: 12px 8px; text-align: center; width: 28%;">รายละเอียดงาน</th><th style="border: 1px solid #000; padding: 12px 8px; text-align: center; width: 20%;">ผู้คุมงาน</th><th style="border: 1px solid #000; padding: 12px 8px; text-align: center; width: 10%;">ชม.</th></tr></thead>
                    <tbody>
                        ${rowsHtml}
                        <tr><td colspan="5" style="border: 1px solid #000; padding: 12px 15px; text-align: right; font-weight: bold;">รวมชั่วโมงทำงานทั้งหมด</td><td style="border: 1px solid #000; padding: 12px 8px; text-align: center; font-weight: bold; color: #0d6efd;">${tHours.toFixed(1)}</td></tr>
                        <tr style="background-color: #f8f9fa;"><td colspan="5" style="border: 1px solid #000; padding: 12px 15px; text-align: right; font-weight: bold; font-size: 16px;">รวมเป็นเงิน (บาท)</td><td style="border: 1px solid #000; padding: 12px 8px; text-align: center; font-weight: bold; font-size: 16px; color: #198754;">${tAmt.toLocaleString()}</td></tr>
                    </tbody>
                </table>
                <div style="margin-top: 50px; font-size: 16px; color: #000;">
                    <div style="text-align: center; margin-bottom: 50px;"><div style="margin-bottom: 15px;">ลงชื่อ</div><div style="margin-bottom: 10px;">ลงชื่อ.......................................................................</div><div style="margin-bottom: 10px;">(${window.user.name})</div><div>วันที่......../......../........</div></div>
                    <table style="width: 100%; border-collapse: collapse; font-size: 16px; text-align: center; border: none;"><tr><td style="width: 50%; padding-bottom: 20px; border: none;">ผู้ตรวจสอบ</td><td style="width: 50%; padding-bottom: 20px; border: none;">ผู้อนุมัติ</td></tr><tr><td style="padding-bottom: 10px; border: none;">ลงชื่อ.......................................................................</td><td style="padding-bottom: 10px; border: none;">ลงชื่อ.......................................................................</td></tr><tr><td style="border: none;">(นางสาว ดวงเพ็ญ พรหมบริรักษ์)</td><td style="border: none;">(รศ. ดร. ปิยะรัตน์ บุญแสวง)</td></tr></table>
                </div>
            </div>
        `;

        const opt = { margin: [10, 10, 10, 10], filename: `ใบเบิกเงิน_${window.user.studentId}_${dNum}.pdf`, image: { type: 'jpeg', quality: 1.0 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } };
        await html2pdf().set(opt).from(pdfContainer).save();

        for(let id of ids) { await updateDoc(doc(db, "jobs", id), { withdrawn: true }); }

        // บันทึกลงฐานข้อมูลพร้อม jobsListToSave
        await addDoc(collection(db, "withdrawals"), { 
            docNum: dNum, studentEmail: window.user.email, studentName: window.user.name, studentId: window.user.studentId || '',
            year: window.user.year, amount: tAmt, totalHours: tHours, rate: currentRate, status: "รอส่งเอกสาร", timestamp: new Date().getTime(),
            jobsList: jobsListToSave 
        });

        Swal.fire('ดาวน์โหลดสำเร็จ!', 'ระบบได้บันทึกและดาวน์โหลดใบเบิก (PDF) ลงในเครื่องของคุณแล้ว<br>กรุณาพิมพ์และนำส่งงานกิจการนักศึกษา', 'success');
        if (typeof window.loadFinanceDataFB === 'function') window.loadFinanceDataFB();
    } catch(e) { console.error(e); Swal.fire('ผิดพลาด', 'เกิดข้อผิดพลาดในการสร้างเอกสาร PDF: ' + e.message, 'error'); }
};

window.loadFinHistoryFB = function() {
    onSnapshot(query(collection(db, "withdrawals"), where("studentEmail", "==", window.user.email), orderBy("timestamp", "desc")), (snap) => {
        let h = '';
        window.myWithdrawals = []; // เก็บไว้สำหรับโหลดใหม่
        snap.forEach(doc => { 
            let w = doc.data(); w.id = doc.id;
            window.myWithdrawals.push(w);
            let badge = w.status==='รอส่งเอกสาร'?'badge-soft-warning':(w.status==='กำลังดำเนินการ'?'badge-soft-info':'badge-soft-success'); 
            
            h += `
            <div class="card p-3 shadow-sm border-0 mb-3">
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <div class="fw-bold text-dark">เลขที่: ${w.docNum||'-'}</div>
                        <small class="text-muted"><i class="bi bi-calendar me-1"></i>${new Date(w.timestamp).toLocaleDateString('th-TH')}</small>
                    </div>
                    <div class="text-end">
                        <div class="fw-bold text-primary mb-1">${w.amount.toLocaleString()} บ.</div>
                        <span class="badge ${badge}">${w.status}</span>
                    </div>
                </div>
                <div class="mt-3 pt-2 border-top text-end">
                    <button class="btn btn-sm btn-outline-danger rounded-pill px-3" onclick="window.reDownloadPDF('${w.id}')"><i class="bi bi-file-pdf-fill me-1"></i> โหลดใบเบิก (PDF) อีกครั้ง</button>
                </div>
            </div>`; 
        });
        document.getElementById('financeHistoryList').innerHTML = h || '<div class="text-center py-5 text-muted"><i class="bi bi-clock-history fs-1 d-block mb-2"></i>ไม่มีประวัติ</div>';
    });
};

// ฟังก์ชันสำหรับโหลด PDF ซ้ำ
window.reDownloadPDF = async function(id) {
    let w = window.myWithdrawals.find(x => x.id === id);
    if(!w) return Swal.fire('ผิดพลาด', 'ไม่พบข้อมูลใบเบิกนี้', 'error');
    
    // ดักไว้เผื่อเป็นข้อมูลเก่าที่ยังไม่มี Array jobsList
    if(!w.jobsList || w.jobsList.length === 0) return Swal.fire('แจ้งเตือน', 'ใบเบิกนี้เป็นเวอร์ชันเก่า ไม่สามารถโหลดซ้ำได้ กรุณาติดต่อแอดมิน', 'warning');

    Swal.fire({ title: 'กำลังสร้างเอกสาร PDF...', text: 'กรุณารอสักครู่ (ห้ามปิดหน้าต่าง)', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    
    try {
        let rowsHtml = '';
        w.jobsList.forEach((j, i) => {
            rowsHtml += `
                <tr>
                    <td style="border: 1px solid #000; padding: 10px 8px; text-align: center;">${i+1}</td>
                    <td style="border: 1px solid #000; padding: 10px 8px; text-align: center;">${j.date}</td>
                    <td style="border: 1px solid #000; padding: 10px 8px; text-align: center;">${j.time}</td>
                    <td style="border: 1px solid #000; padding: 10px 8px;">${j.task}</td>
                    <td style="border: 1px solid #000; padding: 10px 8px; text-align: center;">${j.teacherName}</td>
                    <td style="border: 1px solid #000; padding: 10px 8px; text-align: center;">${j.hours.toFixed(1)}</td>
                </tr>
            `;
        });

        let tHours = w.totalHours || (w.amount / (w.rate || 50));
        let currentRate = w.rate || 50;

        const pdfContainer = document.createElement('div');
        pdfContainer.innerHTML = `
            <div style="width: 100%; max-width: 800px; margin: 0 auto; font-family: 'Prompt', sans-serif; color: #000; background: #fff; padding: 30px;">
                <div style="text-align: center; margin-bottom: 30px;"><h4 style="margin: 0; font-weight: bold; font-size: 22px;">ใบเบิกเงินค่าตอบแทนนักศึกษาทุนทำงานแลกเปลี่ยน</h4><h5 style="margin: 8px 0 0 0; font-size: 18px;">คณะอุตสาหกรรมเกษตร มหาวิทยาลัยสงขลานครินทร์</h5></div>
                <div style="margin-bottom: 20px; font-size: 16px; line-height: 1.8;"><div style="display: flex; justify-content: space-between;"><div><b>เลขที่เอกสาร:</b> ${w.docNum}</div><div><b>วันที่พิมพ์:</b> ${new Date().toLocaleDateString('th-TH')}</div></div><div style="display: flex; justify-content: space-between; margin-top: 5px;"><div><b>ชื่อ-นามสกุล:</b> ${w.studentName}</div><div><b>รหัสนักศึกษา:</b> ${w.studentId || window.user.studentId || '-'}</div></div><div style="display: flex; justify-content: space-between; margin-top: 5px;"><div><b>ปีการศึกษา:</b> ${w.year}</div><div><b>อัตราค่าจ้าง:</b> ${currentRate} บาท/ชั่วโมง</div></div></div>
                <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 40px;">
                    <thead><tr style="background-color: #f1f1f1;"><th style="border: 1px solid #000; padding: 12px 8px; text-align: center; width: 8%;">ลำดับ</th><th style="border: 1px solid #000; padding: 12px 8px; text-align: center; width: 16%;">วันที่</th><th style="border: 1px solid #000; padding: 12px 8px; text-align: center; width: 18%;">เวลา</th><th style="border: 1px solid #000; padding: 12px 8px; text-align: center; width: 28%;">รายละเอียดงาน</th><th style="border: 1px solid #000; padding: 12px 8px; text-align: center; width: 20%;">ผู้คุมงาน</th><th style="border: 1px solid #000; padding: 12px 8px; text-align: center; width: 10%;">ชม.</th></tr></thead>
                    <tbody>${rowsHtml}<tr><td colspan="5" style="border: 1px solid #000; padding: 12px 15px; text-align: right; font-weight: bold;">รวมชั่วโมงทำงานทั้งหมด</td><td style="border: 1px solid #000; padding: 12px 8px; text-align: center; font-weight: bold; color: #0d6efd;">${tHours.toFixed(1)}</td></tr><tr style="background-color: #f8f9fa;"><td colspan="5" style="border: 1px solid #000; padding: 12px 15px; text-align: right; font-weight: bold; font-size: 16px;">รวมเป็นเงิน (บาท)</td><td style="border: 1px solid #000; padding: 12px 8px; text-align: center; font-weight: bold; font-size: 16px; color: #198754;">${w.amount.toLocaleString()}</td></tr></tbody>
                </table>
                <div style="margin-top: 50px; font-size: 16px; color: #000;"><div style="text-align: center; margin-bottom: 50px;"><div style="margin-bottom: 15px;">ลงชื่อ</div><div style="margin-bottom: 10px;">ลงชื่อ.......................................................................</div><div style="margin-bottom: 10px;">(${w.studentName})</div><div>วันที่......../......../........</div></div><table style="width: 100%; border-collapse: collapse; font-size: 16px; text-align: center; border: none;"><tr><td style="width: 50%; padding-bottom: 20px; border: none;">ผู้ตรวจสอบ</td><td style="width: 50%; padding-bottom: 20px; border: none;">ผู้อนุมัติ</td></tr><tr><td style="padding-bottom: 10px; border: none;">ลงชื่อ.......................................................................</td><td style="padding-bottom: 10px; border: none;">ลงชื่อ.......................................................................</td></tr><tr><td style="border: none;">(นางสาว ดวงเพ็ญ พรหมบริรักษ์)</td><td style="border: none;">(รศ. ดร. ปิยะรัตน์ บุญแสวง)</td></tr></table></div>
            </div>
        `;

        const opt = { margin: [10, 10, 10, 10], filename: `ใบเบิกเงิน_${w.studentId || window.user.studentId}_${w.docNum}_(โหลดซ้ำ).pdf`, image: { type: 'jpeg', quality: 1.0 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } };
        await html2pdf().set(opt).from(pdfContainer).save();
        Swal.fire('ดาวน์โหลดสำเร็จ!', 'ระบบได้ดาวน์โหลดใบเบิก (PDF) อีกครั้งเรียบร้อยแล้ว', 'success');

    } catch(e) { console.error(e); Swal.fire('ผิดพลาด', 'เกิดข้อผิดพลาดในการสร้างเอกสาร PDF: ' + e.message, 'error'); }
};