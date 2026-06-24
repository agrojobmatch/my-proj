// public/js/teacher.js
import { auth, db } from './firebase.js';
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { collection, doc, query, where, getDocs, onSnapshot, addDoc, updateDoc, deleteDoc, serverTimestamp, orderBy, runTransaction, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

window.user = null;
window.globalJobs = [];
window.currentAnnouncements = [];
window.allCycles = [];

window.escapeHtml = function(text) { return text ? text.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;") : ""; };

// ฟังก์ชันส่ง Email และ LINE
window.sendEmailNotify = async function(emailTo, subject, message) {
    const gasURL = "https://script.google.com/macros/s/AKfycbxU3PrHjFtc3kZo3_9ThP1LbrlqRGJkEC3pYnBhx7UNFZOUocQ0SYxUgDBGcmsIXUN9tQ/exec"; 
    try { await fetch(gasURL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ to: emailTo, subject: subject, body: message }) }); } catch(e) { console.error("Email Error", e); }
};

window.sendLineNotifyFB = async function(message) {
    const gasURL = "https://script.google.com/macros/s/AKfycbz-8z7zPHk5u3zwX2qlVWxlC-eosMBu_z5NLIlcCT254PuNuqYLJJjif37L3xZO2Npc/exec"; 
    try { await fetch(gasURL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: "sendLine", message: message }) }); } catch(e) { console.error("LINE Error", e); }
};

// 1. ตรวจสอบสิทธิ์และดึงข้อมูลเริ่มต้น
onAuthStateChanged(auth, async (fbUser) => {
    if (fbUser) {
        Swal.fire({ title: 'กำลังตรวจสอบข้อมูล...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        try {
            const q = query(collection(db, "users"), where("email", "==", fbUser.email));
            const snap = await getDocs(q);
            
            if (!snap.empty) {
                let profiles = [];
                snap.forEach(d => profiles.push(d.data()));
                let isStaffOrAdmin = profiles.find(u => u.role !== 'Student');
                
                if (isStaffOrAdmin && (isStaffOrAdmin.role === 'Teacher' || isStaffOrAdmin.role === 'Staff')) {
                    window.user = isStaffOrAdmin;
                    
                 const cyclesSnap = await getDocs(collection(db, "cycles"));
                    let html = '';
                    cyclesSnap.forEach(d => { 
                        let c = d.data(); 
                        if(!c.name) c.name = d.id.replace(/-/g, '/'); 
                        window.allCycles.push(c);
                    });
                    
                    // ใช้ JavaScript จัดเรียงวันที่รอบล่าสุดให้อยู่บนสุด (แก้ปัญหาบุคลากรไม่โชว์รอบปัจจุบัน)
                    window.allCycles.sort((a, b) => new Date(b.start) - new Date(a.start));
                    
                    window.allCycles.forEach(c => {
                        html += `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`;
                    });
                    
                    document.getElementById('tea-cycle-select').innerHTML = html;
                    // แก้ไข: บังคับให้หน้าแรกแสดงผลเป็นรอบล่าสุดเสมอเมื่อล็อกอินเข้ามาใหม่
                    if(window.allCycles.length > 0) {
                        window.user.year = window.allCycles[0].name;
                    }

                    document.getElementById('tea-cycle-select').value = window.user.year;

                    document.getElementById('uName').innerText = window.user.name;
                    document.getElementById('uRole').innerText = window.user.role;
                    if(document.getElementById('navYearBadge')) document.getElementById('navYearBadge').innerText = window.user.year;
                    
                    Swal.close();
                    loadDataFB();
                    loadAnnouncementsFB();
                } else {
                    await signOut(auth);
                    window.location.href = 'index.html'; 
                }
            }
        } catch (err) {
            Swal.fire('เกิดข้อผิดพลาด', err.message, 'error');
            window.location.href = 'index.html';
        }
    } else {
        window.location.href = 'index.html';
    }
});

// UI & Navigation Functions
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
};
window.goHome = function() { 
    document.querySelectorAll('.navbar-nav .nav-link').forEach(el => el.classList.remove('active')); 
    window.switchPage('page-announcement'); 
    document.querySelectorAll('.navbar-nav .nav-link')[0].classList.add('active'); 
};
window.onTeacherCycleChange = function(newYear) { 
    if(!newYear) return; 
    window.user.year = newYear; 
    if(document.getElementById('navYearBadge')) document.getElementById('navYearBadge').innerText = newYear; 
    loadDataFB(); loadAnnouncementsFB(); 
};

// ==========================================
// ส่วนที่ 1: ระบบจัดการข้อมูลนักศึกษาและการจอง
// ==========================================

function loadDataFB() {
    let currentYear = document.getElementById('tea-cycle-select').value || window.user.year || "1/2568";
    
    // ดึงงานทั้งหมดในรอบปีนั้น เพื่อให้เห็นทั้งเด็กที่ว่าง และงานที่ตัวเองดูแล
    const q = query(collection(db, "jobs"), where("year", "==", currentYear));
    
    onSnapshot(q, (snap) => {
        window.globalJobs = [];
        snap.forEach(doc => { 
            let j = doc.data(); 
            j.id = doc.id; 
            window.globalJobs.push(j); 
        });
        window.renderTeacherWithFilter();
    }, (error) => {
        console.error("Firestore Error: ", error);
    });
}

window.renderTeacherWithFilter = function() {
    const txt = document.getElementById('teaSearch').value.toLowerCase();
    const date = document.getElementById('teaDateFilter').value;
    const filtered = window.globalJobs.filter(i => (!date || i.date === date) && (!txt || (i.stuName && i.stuName.toLowerCase().includes(txt)) || (i.studentId && i.studentId.includes(txt))));
    
    let avail = '', pending = '', hist = '';
    
    filtered.forEach(item => {
        if(item.status == 'Available') {
             let sumRate = 0, countRate = 0;
             window.globalJobs.forEach(j => { if(j.studentEmail === item.studentEmail && j.status === 'Completed' && j.rating) { sumRate += parseFloat(j.rating); countRate++; } });
             let avgRating = countRate > 0 ? (sumRate / countRate).toFixed(1) : "0.0";
             let ratingBadge = countRate > 0 ? `<span class="badge bg-warning text-dark border border-warning shadow-sm"><i class="bi bi-star-fill text-danger me-1"></i>${avgRating} (${countRate} รีวิว)</span>` : `<span class="badge bg-light text-muted border">ยังไม่มีคะแนน</span>`;

            avail += `<div class="col-md-6"><div class="card p-3 shadow-sm border-0 border-start border-4 border-info h-100"><div class="d-flex justify-content-between mb-2"><strong class="text-dark">${item.date}</strong> <span class="text-primary fw-bold">${item.time}</span></div><div class="mb-2 small"><div class="d-flex justify-content-between align-items-center"><span><i class="bi bi-person-circle me-1 text-muted"></i> <strong>${escapeHtml(item.stuName)}</strong></span> ${ratingBadge}</div><span class="text-muted ms-4 d-block">${escapeHtml(item.major)}</span><span class="text-primary ms-4 d-block mt-1 fw-bold"><i class="bi bi-telephone-fill"></i> ${escapeHtml(item.phone || 'ไม่ระบุเบอร์โทร')}</span></div><div class="mb-2"><input type="text" id="t-${item.id}" class="form-control form-control-sm mb-1 bg-light border-0" placeholder="รายละเอียดงาน"><input type="text" id="l-${item.id}" class="form-control form-control-sm bg-light border-0" placeholder="สถานที่"></div><button onclick="window.confirmBookJobFB('${item.id}', '${item.studentEmail}')" class="btn btn-primary btn-sm w-100 rounded-pill">ยืนยันจอง</button></div></div>`;
        } else if (item.teacherEmail === window.user.email) {
             let rateBtn = ''; let actionBtn = '';
             if (item.status == 'PendingApproval') { actionBtn = `<button onclick="window.openApproveModalFB('${item.id}', '${item.studentEmail}', '${item.timeReal}')" class="btn btn-success w-100 mt-2 rounded-pill shadow-sm fw-bold"><i class="bi bi-pencil-square me-1"></i> ตรวจสอบและแก้ไขเวลา</button>`; } 
             else if (item.status == 'Booked') { actionBtn = `<div class="mt-2 pt-2 border-top d-flex gap-2"><button onclick="window.openEditBookingFB('${item.id}','${escapeHtml(item.task)}','${escapeHtml(item.location)}')" class="btn btn-light btn-sm flex-fill rounded-pill">แก้ไข</button><button onclick="window.confirmCancelBookingFB('${item.id}')" class="btn btn-outline-danger btn-sm flex-fill rounded-pill">ยกเลิก</button></div>`; }

             if(item.status == 'Completed' && !item.rating) rateBtn = `<button onclick="window.openRatingFB('${item.id}')" class="btn btn-warning btn-sm w-100 mt-2 rounded-pill"><i class="bi bi-star me-1"></i> ให้คะแนน</button>`;
             else if (item.status == 'Completed' && item.rating) rateBtn = `<div class="text-center text-warning small mt-2"><i class="bi bi-star-fill"></i> ${item.rating}/5</div>`;
             
             let badgeCls = item.status=='Completed'?'badge-soft-success':(item.status=='PendingApproval'?'bg-primary text-white':'badge-soft-warning');
             let badgeText = item.status=='Completed'?'เสร็จสิ้น':(item.status=='PendingApproval'?'รอตรวจ':'ถูกจองแล้ว');
             let borderCls = item.status=='Completed'?'border-success':(item.status=='PendingApproval'?'border-primary':'border-warning');

             let cardHtml = `<div class="col-md-6"><div class="card p-3 shadow-sm border-0 border-start border-4 ${borderCls} h-100"><div class="d-flex justify-content-between mb-2"><strong>${item.date}</strong> <span class="badge ${badgeCls}">${badgeText}</span></div><div class="small text-muted mb-1"><i class="bi bi-clock me-1"></i>${item.time} ${item.timeReal ? `<span class="text-primary fw-bold ms-1">(ส่ง: ${item.timeReal})</span>` : ''}</div><div class="small"><strong>นศ:</strong> ${escapeHtml(item.stuName)}</div><div class="small text-primary mb-1"><i class="bi bi-telephone-fill"></i> ${escapeHtml(item.phone || 'ไม่ระบุ')}</div><div class="small text-muted bg-light p-2 rounded mt-2">งาน: ${escapeHtml(item.task)}</div>${actionBtn}${rateBtn}</div></div>`;
             
             if (item.status == 'Completed') hist += cardHtml; 
             else pending += cardHtml;
        }
    });
    
    document.getElementById('teaList').innerHTML = `<div class="row g-3">${avail || '<div class="col-12 text-muted text-center py-4">ไม่พบข้อมูล</div>'}</div>`;
    document.getElementById('teaPendingList').innerHTML = `<div class="row g-3">${pending || '<div class="col-12 text-muted text-center py-4 small">ไม่มีงานที่รอดำเนินการ</div>'}</div>`;
    document.getElementById('teaHistoryList').innerHTML = `<div class="row g-3">${hist || '<div class="col-12 text-muted text-center py-4 small">ไม่มีประวัติ</div>'}</div>`;
};

window.resetFilter = function() { document.getElementById('teaDateFilter').value=''; document.getElementById('teaSearch').value=''; window.renderTeacherWithFilter(); };

// การจองและแก้ไขการจอง
window.confirmBookJobFB = async function(id, studentEmail) {
    const t = document.getElementById('t-'+id).value, l = document.getElementById('l-'+id).value;
    if(!t || !l) return Swal.fire('ข้อมูลไม่ครบ', 'กรุณากรอกรายละเอียดงานและสถานที่', 'warning');
// เปลี่ยนช่วงเช็คโควตาเดิม เป็นโค้ดนี้ครับ
let stuHours = 0; let limit = 40; 
let currentYear = window.user.year;

try {
    const qUser = query(collection(db, "users"), where("email", "==", studentEmail)); 
    const snapUser = await getDocs(qUser); 
    snapUser.forEach(doc => { 
        if(doc.data().year === currentYear) limit = parseFloat(doc.data().limit) || 40; 
    });
    
    window.globalJobs.forEach(j => { 
        if (j.studentEmail === studentEmail && j.year === currentYear && j.status === 'Completed') stuHours += parseFloat(j.hours||0); 
    });
} catch(e) {}

if (stuHours >= limit) return Swal.fire('จองตัวไม่ได้!', `นักศึกษาคนนี้ชั่วโมงทำงานรอบ ${currentYear} เต็มโควตาแล้ว (${stuHours.toFixed(1)}/${limit} ชม.)`, 'error');

    Swal.fire({ title: 'กำลังจองงาน...', didOpen: () => Swal.showLoading() });
    try {
        await updateDoc(doc(db, "jobs", id), { status: "Booked", teacherName: window.user.name, teacherEmail: window.user.email, task: t, location: l });
        let subject = `🔔 มีคนจองเวลาทำงานของคุณแล้ว`; 
        let emailMsg = `สวัสดี,\n\nคุณได้รับการจองเวลาทำงานจากหน้าตารางเวลาว่างของคุณ\n\n👨‍🏫 ผู้จอง: ${window.user.name}\n📌 รายละเอียดงาน: ${t}\n📍 สถานที่: ${l}\n\n👉 กรุณาเตรียมตัวให้พร้อมตามวันและเวลาที่คุณได้ลงแจ้งว่างไว้\nตรวจสอบตารางงานของคุณได้ที่:\nhttps://agro-job-match.web.app`;
        window.sendEmailNotify(studentEmail, subject, emailMsg); 
        Swal.fire('สำเร็จ', 'จองเรียบร้อย', 'success');
    } catch(e) { Swal.fire('ผิดพลาด', e.message, 'error'); }
};

window.confirmCancelBookingFB = async function(id) { try { await updateDoc(doc(db, "jobs", id), { status: "Available", teacherName: "", teacherEmail: "", task: "", location: "" }); Swal.fire('ยกเลิกแล้ว', '', 'success'); } catch(e) { Swal.fire('ผิดพลาด', e.message, 'error'); } };
window.openEditBookingFB = function(id, t, l) { document.getElementById('bk-id').value=id; document.getElementById('bk-task').value=t; document.getElementById('bk-loc').value=l; bootstrap.Modal.getOrCreateInstance(document.getElementById('editBookingModal')).show(); };
window.confirmSaveBookingFB = async function() { try { await updateDoc(doc(db, "jobs", document.getElementById('bk-id').value), { task: document.getElementById('bk-task').value, location: document.getElementById('bk-loc').value }); Swal.fire('สำเร็จ', 'แก้ไขข้อมูลเรียบร้อย', 'success'); bootstrap.Modal.getInstance(document.getElementById('editBookingModal')).hide(); } catch(e) { Swal.fire('ผิดพลาด', e.message, 'error'); } };

// การให้คะแนน
window.openRatingFB = function(id) { document.getElementById('rate-job-id').value = id; window.setStar(0); bootstrap.Modal.getOrCreateInstance(document.getElementById('ratingModal')).show(); };
window.setStar = function(n) { document.getElementById('rate-score').value = n; for(let i=1; i<=5; i++) { let el = document.getElementById('star-'+i); if(i<=n) { el.classList.remove('bi-star'); el.classList.add('bi-star-fill'); } else { el.classList.remove('bi-star-fill'); el.classList.add('bi-star'); } } };
window.confirmRatingFB = async function() { let score = document.getElementById('rate-score').value; if(score == 0) return Swal.fire('เตือน', 'กรุณาให้ดาวนักศึกษา', 'warning'); try { await updateDoc(doc(db, "jobs", document.getElementById('rate-job-id').value), { rating: score, review: document.getElementById('rate-review').value }); Swal.fire('สำเร็จ', 'บันทึกคะแนนเรียบร้อย', 'success'); bootstrap.Modal.getInstance(document.getElementById('ratingModal')).hide(); } catch(e) { Swal.fire('ผิดพลาด', e.message, 'error'); } };

// การตรวจสอบงาน (Approve / Reject)
window.openApproveModalFB = function(id, studentEmail, timeReal) {
    document.getElementById('apv-job-id').value = id; document.getElementById('apv-student-email').value = studentEmail;
    let s = '', e = ''; if(timeReal && timeReal.includes('-')) { let parts = timeReal.split('-'); s = parts[0].trim(); e = parts[1].trim(); }
    document.getElementById('apv-start').value = s; document.getElementById('apv-end').value = e;
    bootstrap.Modal.getOrCreateInstance(document.getElementById('approveModal')).show();
};

window.confirmSaveApprovalFB = async function() {
    const id = document.getElementById('apv-job-id').value, 
          studentEmail = document.getElementById('apv-student-email').value, 
          s = document.getElementById('apv-start').value, 
          e = document.getElementById('apv-end').value;
          
    if(!s || !e) return Swal.fire('ข้อมูลไม่ครบ', 'กรุณาระบุเวลาเริ่มและเลิกงาน', 'warning');
    
    let sm = parseInt(s.split(':')[0])*60 + parseInt(s.split(':')[1]), 
        em = parseInt(e.split(':')[0])*60 + parseInt(e.split(':')[1]), 
        hrs = ((em - sm) / 60).toFixed(2);
        
    // ประกาศตัวแปร jobData ครั้งเดียวตรงนี้
    let jobData = window.globalJobs.find(x => x.id === id);
    
    if(jobData && jobData.jobType === 'Piecework' && jobData.fixedHours) { 
        hrs = parseFloat(jobData.fixedHours).toFixed(2); 
    } else if(hrs <= 0) { 
        return Swal.fire('เวลาไม่ถูกต้อง', 'เวลาเลิกงานต้องมากกว่าเวลาเริ่มงาน', 'warning'); 
    }

    let currentTotal = 0; 
    let limit = 40; 
    
    // ดึงค่าปีการศึกษามาใช้ได้เลย ไม่ต้องประกาศ jobData ซ้ำแล้ว
    let jobYear = jobData ? jobData.year : window.user.year;

    try {
        // 1. ดึงโควตาตามที่แอดมินกำหนดในรอบนั้นๆ แบบแม่นยำ
        const qUser = query(collection(db, "users"), where("email", "==", studentEmail)); 
        const snapUser = await getDocs(qUser); 
        snapUser.forEach(doc => { 
            let d = doc.data();
            if (d.year === jobYear) {
                limit = parseFloat(d.limit) || 40; // ได้ลิมิตตรงตามที่แอดมินตั้ง
            }
        });

        // 2. รวมชั่วโมงเฉพาะรอบนั้นๆ เพื่อกันข้ามเทอม
        const qJobs = query(collection(db, "jobs"), where("studentEmail", "==", studentEmail)); 
        const snapJobs = await getDocs(qJobs);
        snapJobs.forEach(doc => { 
            let j = doc.data(); 
            if (j.year === jobYear && (j.status === 'Completed' || j.status === 'PendingApproval') && doc.id !== id) { 
                currentTotal += parseFloat(j.hours || 0); 
            } 
        });
    } catch(err) {
        console.error("Error calculating hours:", err);
    }

    // --- เพิ่มเงื่อนไขตรวจสอบโควตาที่หายไป เพื่อให้ระบบบล็อกถ้ายอดชั่วโมงเกิน ---
    if (currentTotal + parseFloat(hrs) > limit) {
        let remain = limit - currentTotal;
        return Swal.fire('อนุมัติไม่ได้ โควตาเกิน!', `นักศึกษาคนนี้เหลือโควตาเบิกได้อีกแค่ ${remain.toFixed(1)} ชม. (แต่คุณจะอนุมัติให้ ${hrs} ชม.)\nกรุณาแก้ไขเวลาลดลงให้พอดี หรือตีกลับงานนี้`, 'error');
    }

    Swal.fire({ title: 'กำลังอนุมัติ...', didOpen: () => Swal.showLoading() });
    try {
        await updateDoc(doc(db, "jobs", id), { status: "Completed", timeReal: `${s}-${e}`, hours: parseFloat(hrs) });
        let subject = `✅ งานของคุณได้รับการอนุมัติแล้ว`; 
        let emailMsg = `สวัสดี,\n\n ${window.user.name} ได้ทำการตรวจสอบและอนุมัติเวลาทำงานของคุณเรียบร้อยแล้ว\n\n[สรุปข้อมูลการอนุมัติ]\n⏰ เวลาที่บันทึก: ${s} - ${e}\n⏱ จำนวนชั่วโมงที่ได้: ${hrs} ชั่วโมง\n\nชั่วโมงทำงานสะสมของคุณได้ถูกอัปเดตแล้ว สามารถเข้าตรวจสอบประวัติได้ที่:\nhttps://agro-job-match.web.app`;
        window.sendEmailNotify(studentEmail, subject, emailMsg);
        
        bootstrap.Modal.getInstance(document.getElementById('approveModal')).hide(); 
        Swal.fire('สำเร็จ', 'อนุมัติงานและอัปเดตชั่วโมงเรียบร้อย', 'success');
    } catch(err) { 
        Swal.fire('ผิดพลาด', err.message, 'error'); 
    }
};

window.confirmRejectJobFB = async function() {
    const id = document.getElementById('apv-job-id').value, studentEmail = document.getElementById('apv-student-email').value;
    Swal.fire({ title: 'ตีกลับงาน?', text: "คุณต้องการตีกลับเพื่อให้เด็กแก้ไขใหม่ หรือลบเวลาออกใช่หรือไม่?", icon: 'warning', showCancelButton: true, confirmButtonText: 'ตีกลับไปเป็น "ถูกจองแล้ว"', confirmButtonColor: '#d33' }).then(async (result) => {
        if (result.isConfirmed) {
            Swal.fire({ title: 'กำลังบันทึก...', didOpen: () => Swal.showLoading() });
            try {
                await updateDoc(doc(db, "jobs", id), { status: "Booked", timeReal: "", hours: 0 });
                let subject = `❌ แจ้งเตือน: งานของคุณถูกตีกลับ`; let emailMsg = `สวัสดี,\n\n ${window.user.name} ได้ทำการตีกลับการส่งเวลาทำงานของคุณ\n\n👉 สาเหตุที่อาจเป็นไปได้: เวลาทำงานไม่ถูกต้อง หรือยังทำงานไม่เสร็จสมบูรณ์\nกรุณาติดต่อนัดหมายกับผู้คุมงาน หรือทำการส่งเวลาทำงานใหม่ให้ถูกต้องอีกครั้ง\n\nเข้าสู่ระบบที่นี่:\nhttps://agro-job-match.web.app`;
                window.sendEmailNotify(studentEmail, subject, emailMsg);
                bootstrap.Modal.getInstance(document.getElementById('approveModal')).hide(); Swal.fire('สำเร็จ', 'ตีกลับสถานะงานแล้ว', 'success');
            } catch(err) { Swal.fire('ผิดพลาด', err.message, 'error'); }
        }
    });
};

// ==========================================
// ส่วนที่ 2: ระบบจัดการประกาศงานและงานด่วน
// ==========================================

function loadAnnouncementsFB() { 
    onSnapshot(query(collection(db, "announcements"), orderBy("createdAt", "desc")), (snap) => {
        window.currentAnnouncements = []; let h = '';
        snap.forEach(doc => { let d=doc.data(); d.id=doc.id; window.currentAnnouncements.push(d); });
        
        let list = window.currentAnnouncements.filter(a => (!a.year || a.year === window.user.year) && a.teacherEmail === window.user.email);
        if(document.getElementById('announce-year-badge')) document.getElementById('announce-year-badge').innerText = window.user.year;
        
        if(list.length === 0) { 
            document.getElementById('announceList').innerHTML = `<div class="col-12"><div class="text-center py-5 text-muted bg-white rounded-4 shadow-sm">คุณยังไม่ได้สร้างประกาศงาน</div></div>`; 
            return; 
        }
        
        list.forEach(i => {
            let cur = i.currentCount || 0; let pct = (cur/i.capacity)*100;
            let isManualClosed = i.isOpen === false; 
            let toggleText = isManualClosed ? '<i class="bi bi-play-circle"></i> เปิด' : '<i class="bi bi-pause-circle"></i> ปิด';
            
            let act = `<div class="d-flex flex-wrap gap-2 mt-3"><button onclick="window.viewApplicantsFB('${i.id}')" class="btn btn-info text-white btn-sm flex-fill rounded-pill shadow-sm"><i class="bi bi-people me-1"></i> สมัคร (${cur}/${i.capacity})</button><button onclick="window.toggleAnnounceStatusFB('${i.id}', ${i.isOpen !== false})" class="btn ${isManualClosed?'btn-success':'btn-warning'} btn-sm flex-fill rounded-pill shadow-sm">${toggleText}</button><button onclick="window.cloneAnnounceFB('${i.id}')" class="btn btn-outline-primary btn-sm flex-fill rounded-pill shadow-sm"><i class="bi bi-copy"></i> ก๊อปปี้</button><button onclick="window.deleteAnnounceFB('${i.id}')" class="btn btn-outline-danger btn-sm flex-fill rounded-pill shadow-sm"><i class="bi bi-trash"></i> ลบ</button></div>`;
            
            let statusBadge = isManualClosed ? '<span class="badge bg-danger rounded-pill">ปิดชั่วคราว</span>' : '<span class="badge bg-success rounded-pill">เปิดรับ</span>';

            h += `<div class="col-12 col-md-6 col-lg-4"><div class="card card-announce h-100 border-0"><div class="card-body p-4"><div class="mb-2">${statusBadge}</div><h6 class="fw-bold text-dark mb-0 text-truncate">${escapeHtml(i.topic)}</h6><div class="small bg-light p-3 rounded-3 mt-3 mb-3"><div class="mb-1"><i class="bi bi-calendar-event me-2 text-secondary"></i> ${i.workDate}</div></div></div><div class="card-footer bg-white border-0 pb-4 pt-0 px-4">${act}</div></div></div>`;
        });
        document.getElementById('announceList').innerHTML = h;
    });
}

window.openPostModalFB = function() { document.getElementById('anc-topic').value = ''; document.getElementById('anc-open-date').value = ''; document.getElementById('anc-open-time').value = ''; document.getElementById('anc-close-date').value = ''; document.getElementById('anc-close-time').value = ''; bootstrap.Modal.getOrCreateInstance(document.getElementById('announceModal')).show(); };
window.toggleHoursInput = function() { const isPiece = document.getElementById('type-piece').checked; const field = document.getElementById('field-fixed-hours'); if (isPiece) { field.classList.remove('hidden'); } else { field.classList.add('hidden'); } };

window.confirmPostAnnounceFB = async function() { 
    const t = document.getElementById('anc-topic').value, d = document.getElementById('anc-date').value, s = document.getElementById('anc-start').value, e = document.getElementById('anc-end').value, loc = document.getElementById('anc-loc').value, desc = document.getElementById('anc-desc').value, cap = document.getElementById('anc-capacity').value, fHours = document.getElementById('anc-fixed-hours').value;
    const openD = document.getElementById('anc-open-date').value, openT = document.getElementById('anc-open-time').value, closeD = document.getElementById('anc-close-date').value, closeT = document.getElementById('anc-close-time').value;
    const jType = document.getElementById('type-piece').checked ? 'Piecework' : 'General';
    if(!t || !d || !s || !e || !loc || !cap) return Swal.fire('ข้อมูลไม่ครบ', 'กรุณากรอกข้อมูลและสถานที่ให้ครบถ้วน', 'warning');
    if(jType === 'Piecework' && !fHours) return Swal.fire('เตือน', 'กรุณาระบุจำนวนชั่วโมงเหมาจ่าย', 'warning');

    Swal.fire({ title: 'กำลังโพสต์ และส่งการแจ้งเตือน...', didOpen: () => Swal.showLoading() });
    try {
        await addDoc(collection(db, "announcements"), { topic: t, desc: desc, workDate: `${d} เวลา ${s} - ${e}`, location: loc, teacherName: window.user.name, teacherEmail: window.user.email, capacity: cap, jobType: jType, fixedHours: fHours, year: window.user.year, isOpen: true, openDate: openD, openTime: openT, closeDate: closeD, closeTime: closeT, createdAt: serverTimestamp() }); 
        
        let typeText = jType === 'Piecework' ? `เหมาจ่าย ${fHours} ชม.` : 'งานทั่วไป (นับตามเวลา)'; let descText = desc ? desc : '-'; let openText = (openD && openT) ? `${openD} เวลา ${openT} น.` : 'ทันที (ระบบเปิดแล้ว)'; let closeText = (closeD && closeT) ? `${closeD} เวลา ${closeT} น.` : 'ไม่มีกำหนด (ปิดเมื่อคนเต็ม)';
        let lineMsg = `🚨 [ทุนทำงานแลกเปลี่ยน Agro PSU]\nมีประกาศรับสมัครงานใหม่! (รอบ ${window.user.year})\n\n📌 งาน: ${t}\n👨‍🏫 ผู้ประกาศ: ${window.user.name}\n👥 รับจำนวน: ${cap} คน\n🧰 รูปแบบ: ${typeText}\n\n📅 วันที่ทำ: ${d}\n⏰ เวลา: ${s} - ${e}\n📍 สถานที่: ${loc}\n⏳ เปิดรับ: ${openText}\n⌛ ปิดรับ: ${closeText}\n\n📝 รายละเอียด: ${descText}\n-----------------------------\n👉 รีบเข้าระบบไปกดรับงานด่วน!\n🌐 ลิงก์ระบบ: https://agro-job-match.web.app`;
        window.sendLineNotifyFB(lineMsg);

        const q = query(collection(db, "users"), where("role", "==", "Student"), where("year", "==", window.user.year)); const snap = await getDocs(q); let studentEmails = []; snap.forEach(doc => studentEmails.push(doc.data().email));
        if(studentEmails.length > 0) {
            let subject = `ประกาศงานใหม่: ${t} (เปิดรับ ${cap} คน) - Agro PSU`;
            let emailBody = `สวัสดี นักศึกษาทุนทำงานแลกเปลี่ยน,\n\nมีประกาศรับสมัครงานใหม่จาก ${window.user.name} เข้ามาในระบบ โดยมีรายละเอียดดังนี้:\n\n=============================\n📌 ชื่องาน: ${t}\n👥 รับจำนวน: ${cap} คน\n🧰 รูปแบบงาน: ${typeText}\n📅 วันที่ปฏิบัติงาน: ${d}\n⏰ เวลา: ${s} - ${e}\n📍 สถานที่: ${loc}\n📝 รายละเอียดเพิ่มเติม: ${descText}\n👨‍🏫 ผู้ประกาศ: ${window.user.name}\n=============================\n\n👉 หากสนใจ สามารถเข้าระบบเพื่อกด "รับงาน" ได้ทันที\n🌐 เข้าสู่ระบบที่นี่: https://agro-job-match.web.app`;
            let emailPromises = studentEmails.map(email => window.sendEmailNotify(email, subject, emailBody)); await Promise.all(emailPromises);
        }

        document.getElementById('anc-topic').value = ''; document.getElementById('anc-date').value = ''; document.getElementById('anc-start').value = ''; document.getElementById('anc-end').value = ''; document.getElementById('anc-loc').value = ''; document.getElementById('anc-desc').value = ''; document.getElementById('anc-capacity').value = '1'; document.getElementById('anc-fixed-hours').value = '';
        Swal.fire('สำเร็จ', 'โพสต์ประกาศงานและส่งแจ้งเตือนเรียบร้อย', 'success'); bootstrap.Modal.getInstance(document.getElementById('announceModal')).hide(); 
    } catch(e) { Swal.fire('ผิดพลาด', e.message, 'error'); }
};

window.deleteAnnounceFB = async function(id) { Swal.fire({ title: 'ยืนยันการลบ?', icon: 'warning', showCancelButton: true }).then(async (result) => { if (result.isConfirmed) { try { await deleteDoc(doc(db, "announcements", id)); Swal.fire('ลบแล้ว', 'ลบประกาศเรียบร้อย', 'success'); } catch (error) { Swal.fire('ผิดพลาด', error.message, 'error'); } } }); };
window.toggleAnnounceStatusFB = async function(id, currentIsOpen) { Swal.fire({ title: 'กำลังเปลี่ยนสถานะ...', didOpen: () => Swal.showLoading() }); try { await updateDoc(doc(db, "announcements", id), { isOpen: !currentIsOpen }); Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'อัปเดตสถานะแล้ว', showConfirmButton: false, timer: 1500 }); } catch(e) { Swal.fire('ผิดพลาด', e.message, 'error'); } };
window.cloneAnnounceFB = async function(id) {
    const i = window.currentAnnouncements.find(x => x.id == id); if(!i) return;
    document.getElementById('anc-topic').value = i.topic + " (Copy)";
    if (i.jobType === 'Piecework') { document.getElementById('type-piece').checked = true; document.getElementById('anc-fixed-hours').value = i.fixedHours; document.getElementById('field-fixed-hours').classList.remove('hidden'); } 
    else { document.getElementById('type-general').checked = true; document.getElementById('field-fixed-hours').classList.add('hidden'); }
    document.getElementById('anc-capacity').value = i.capacity; document.getElementById('anc-loc').value = i.location; document.getElementById('anc-desc').value = i.desc;
    bootstrap.Modal.getOrCreateInstance(document.getElementById('announceModal')).show(); 
}

window.viewApplicantsFB = async function(id) {
    const i = window.currentAnnouncements.find(x => x.id === id); if (!i) return;
    document.getElementById('va-topic').innerText = `📌 ชื่องาน: ${i.topic}`; document.getElementById('va-list').innerHTML = '<div class="text-center py-4"><span class="spinner-border text-info"></span></div>';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('viewApplicantsModal')).show();

    let applicants = i.applicants || [];
    if (applicants.length === 0) { document.getElementById('va-list').innerHTML = '<div class="text-center text-muted py-4 bg-light rounded-3">ยังไม่มีนักศึกษามารับงานนี้</div>'; return; }

    try {
        const q = query(collection(db, "users"), where("role", "==", "Student")); const snap = await getDocs(q); let userMap = {}; snap.forEach(doc => { let u = doc.data(); userMap[u.email] = u; });
        let h = '';
        applicants.forEach((email, index) => {
            let u = userMap[email];
            if (u) { h += `<div class="list-group-item px-0 py-3 border-bottom"><div class="d-flex justify-content-between align-items-center"><div><div class="fw-bold text-dark"><span class="badge bg-light text-dark border me-2">${index+1}</span>${escapeHtml(u.name)}</div><small class="text-muted d-block mt-1"><i class="bi bi-envelope me-1"></i>${escapeHtml(u.email)}</small><small class="text-muted"><i class="bi bi-person-vcard me-1"></i>รหัส: ${escapeHtml(u.studentId || '-')} | <i class="bi bi-telephone-fill text-primary"></i> ${escapeHtml(u.phone || 'ไม่ระบุ')}</small></div><span class="badge bg-success bg-opacity-10 text-success border border-success rounded-pill px-3 py-2"><i class="bi bi-check-circle-fill me-1"></i> รับงานแล้ว</span></div></div>`; } 
            else { h += `<div class="list-group-item px-0 py-2 border-bottom text-muted"><small>${email} (ไม่พบข้อมูลในระบบ)</small></div>`; }
        });
        document.getElementById('va-list').innerHTML = h;
    } catch(e) { document.getElementById('va-list').innerHTML = `<div class="alert alert-danger">เกิดข้อผิดพลาด: ${e.message}</div>`; }
};

// ==========================================
// ส่วนที่ 3: ระบบมอบหมายงานด่วน
// ==========================================
window.openAssignModalFB = function() { document.getElementById('asg-year').value = window.user.year; document.getElementById('asg-search').value = ''; document.getElementById('asg-task').value = ''; document.getElementById('asg-date').value = ''; document.getElementById('asg-start').value = ''; document.getElementById('asg-end').value = ''; document.getElementById('asg-loc').value = ''; bootstrap.Modal.getOrCreateInstance(document.getElementById('assignModal')).show(); };

window.confirmAssignJobFB = async function() {
    const search = document.getElementById('asg-search').value.trim().toLowerCase(), task = document.getElementById('asg-task').value, date = document.getElementById('asg-date').value, start = document.getElementById('asg-start').value, end = document.getElementById('asg-end').value, loc = document.getElementById('asg-loc').value, year = document.getElementById('asg-year').value;
    if(!search || !task || !date || !start || !end || !loc) return Swal.fire('ข้อมูลไม่ครบ', 'กรุณากรอกข้อมูลและสถานที่ให้ครบถ้วน', 'warning');
    
    Swal.fire({ title: 'กำลังดึงข้อมูล...', didOpen: () => Swal.showLoading() });
    let student = null; let q = query(collection(db, "users"), where("role", "==", "Student"), where("email", "==", search)); let snap = await getDocs(q); snap.forEach(doc => student = doc.data());
    if(!student) { q = query(collection(db, "users"), where("role", "==", "Student"), where("studentId", "==", search)); snap = await getDocs(q); snap.forEach(doc => student = doc.data()); }
    if (!student) return Swal.fire('ไม่พบนักศึกษา', 'ไม่พบรหัสนักศึกษา หรือ อีเมลนี้ในระบบ', 'error');

let stuHours = 0; let limit = 40; 
let currentYear = year; // ปีที่แอดมินเลือกจะมอบหมาย

limit = parseFloat(student.limit) || 40; // ดึงลิมิตจากข้อมูลนักศึกษา
window.globalJobs.forEach(j => { 
    if (j.studentEmail === student.email && j.year === currentYear && j.status === 'Completed') stuHours += parseFloat(j.hours||0); 
});

if (stuHours >= limit) return Swal.fire('มอบหมายงานไม่ได้!', `ชั่วโมงทำงานรอบ ${currentYear} เต็มโควตาแล้ว (${stuHours.toFixed(1)}/${limit} ชม.)`, 'error');

    Swal.fire({ title: 'กำลังค้นหาและมอบหมายงาน...', didOpen: () => Swal.showLoading() });
    try {
        await addDoc(collection(db, "jobs"), { studentEmail: student.email, stuName: student.name, studentId: student.studentId || '', major: student.major || '', phone: student.phone || '', year: year, date: date, time: `${start} - ${end}`, status: "Booked", jobType: "General", fixedHours: 0, hours: 0, teacherName: window.user.name, teacherEmail: window.user.email, task: task, location: loc, createdAt: serverTimestamp() });
        let subject = `⚡ มีงานด่วนมอบหมายถึงคุณ! (${task})`; let emailMsg = `สวัสดี ${student.name},\n\n ${window.user.name} ได้ทำการลงเวลามอบหมายงานด่วนให้คุณ โดยมีรายละเอียดดังนี้:\n\n📌 ชื่องาน: ${task}\n📅 วันที่: ${date}\n⏰ เวลา: ${start} - ${end}\n📍 สถานที่: ${loc}\n\n👉 งานนี้ถูกเพิ่มเข้าตาราง "งานของฉัน" ในระบบเรียบร้อยแล้ว กรุณาไปตามนัดหมาย\nเข้าสู่ระบบเพื่อตรวจสอบ:\nhttps://agro-job-match.web.app`;
        window.sendEmailNotify(student.email, subject, emailMsg);
        document.getElementById('asg-search').value = ''; document.getElementById('asg-task').value = ''; document.getElementById('asg-date').value = ''; document.getElementById('asg-start').value = ''; document.getElementById('asg-end').value = ''; document.getElementById('asg-loc').value = '';
        Swal.fire('สำเร็จ', `มอบหมายงานให้ ${student.name} เรียบร้อยแล้ว!`, 'success'); bootstrap.Modal.getInstance(document.getElementById('assignModal')).hide();
    } catch(e) { Swal.fire('ผิดพลาด', e.message, 'error'); }
};