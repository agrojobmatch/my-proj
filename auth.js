import { app, auth, db } from './firebase.js';
import { signInWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { collection, query, where, getDocs, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// ประกาศตัวแปรเก็บสถานะแท็บการล็อกอิน
window.currentUserTypeTab = 'Student';

document.addEventListener('DOMContentLoaded', () => {
    const studentTab = document.getElementById('student-tab');
    const teacherTab = document.getElementById('teacher-tab');
    
    if(studentTab) {
        studentTab.addEventListener('click', () => { window.currentUserTypeTab = 'Student'; });
    }
    if(teacherTab) {
        teacherTab.addEventListener('click', () => { window.currentUserTypeTab = 'Teacher'; });
    }
});

// 1. ดึงปีการศึกษามาแสดงที่หน้า Login
onSnapshot(query(collection(db, "cycles"), orderBy("start", "desc")), (snap) => {
    let html = '';
    const today = new Date(); today.setHours(0,0,0,0);
    let autoSelected = false;
    
    snap.forEach(d => {
        let c = d.data(); 
        if(!c.name) c.name = d.id.replace(/-/g, '/'); 
        
        let startDate = (c.start && typeof c.start.toDate === 'function') ? c.start.toDate() : new Date(c.start + "T00:00:00");
        let endDate = (c.end && typeof c.end.toDate === 'function') ? c.end.toDate() : new Date(c.end + "T23:59:59");
        
        let isCurrent = (today >= startDate && today <= endDate);
        let isStatusActive = c.status && c.status.toLowerCase() === 'active';
        
        let label = c.name + (!isStatusActive ? ' (ปิดรอบ)' : '');
        let selectedStr = (isStatusActive && isCurrent && !autoSelected) ? 'selected' : '';
        if(selectedStr) autoSelected = true;
        
        html += `<option value="${c.name}" ${selectedStr}>${label}</option>`;
    });
    
    if(document.getElementById('login-cycle-select')) {
        document.getElementById('login-cycle-select').innerHTML = html;
    }
});

// 2. เช็คสิทธิ์และตรวจสอบข้อมูลใน Database
onAuthStateChanged(auth, async (fbUser) => {
    if (fbUser) {
        Swal.fire({ title: 'กำลังโหลดข้อมูล...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        
        try {
            const cyclesSnap = await getDocs(collection(db, "cycles"));
            let currentCycle = null;
            const today = new Date(); today.setHours(0, 0, 0, 0);
            
            // หาว่าวันนี้อยู่ในช่วงวันไหนของแต่ละ Cycle
            cyclesSnap.forEach(d => {
                let c = d.data();
                let start = new Date(c.start + "T00:00:00");
                let end = new Date(c.end + "T23:59:59");
                
                if (today >= start && today <= end && c.status === 'Active') {
                    currentCycle = c.name;
                }
            });

            // ถ้าไม่พบรอบที่ Active อยู่ ให้เลือก "รอบล่าสุด" แทน
            if (!currentCycle && cyclesSnap.size > 0) {
                const sorted = Array.from(cyclesSnap.docs)
                    .map(d => ({ ...d.data(), id: d.id }))
                    .sort((a, b) => new Date(b.start) - new Date(a.start));
                currentCycle = sorted[0].name;
            }

            // ค้นหาข้อมูลผู้ใช้ โดยเจาะจง email และ "รอบปัจจุบัน"
            const studentQuery = query(
                collection(db, "users"), 
                where("email", "==", fbUser.email), 
                where("role", "==", "Student"),
                where("year", "==", currentCycle)
            );
            const studentSnap = await getDocs(studentQuery);

            if (studentSnap.empty) {
                // เช็คว่าเป็นบุคลากร/แอดมินไหม
                const staffQuery = query(collection(db, "users"), where("email", "==", fbUser.email));
                const staffSnap = await getDocs(staffQuery);
                
                if (!staffSnap.empty) {
                    let profiles = [];
                    staffSnap.forEach(d => profiles.push(d.data()));
                    let isStaffOrAdmin = profiles.find(u => u.role !== 'Student');
                    let userRole = isStaffOrAdmin ? isStaffOrAdmin.role : 'Student';

                    Swal.close(); 
                    if (userRole === 'Teacher' || userRole === 'Staff') {
                        window.location.href = 'teacher.html';
                    } else if (userRole === 'Admin') {
                        window.location.href = 'admin.html';
                    }
                } else {
                    Swal.close(); 
                    Swal.fire('ไม่มีสิทธิ์เข้าถึง', 'ไม่พบรายชื่อของคุณในรอบปัจจุบัน กรุณาติดต่อแอดมิน', 'error');
                    auth.signOut(); 
                }
            } else {
                Swal.close(); 
                window.location.href = 'student.html';
            }
        } catch(err) {
            Swal.close();
            Swal.fire('เกิดข้อผิดพลาด', 'ดึงข้อมูลไม่สำเร็จ: ' + err.message, 'error');
            auth.signOut();
        }
    }
});

// 3. ฟังก์ชันเข้าสู่ระบบ
window.loginFB = async function() {
    let errorDiv = document.getElementById('login-error-msg');
    if(errorDiv) errorDiv.style.display = 'none';

    let type = window.currentUserTypeTab || 'Student';
    let email = "", pass = "", loginBtn = null;
    
    if (type === 'Student') { 
        email = document.getElementById('email-stu').value.trim().toLowerCase(); 
        pass = document.getElementById('pass-stu').value.trim(); 
        loginBtn = document.querySelector('#login-student button');
    } else { 
        email = document.getElementById('email-adm').value.trim().toLowerCase(); 
        pass = document.getElementById('pass-adm').value.trim(); 
        loginBtn = document.querySelector('#login-admin button');
    }
    
    if (!email || !pass) {
        return Swal.fire('แจ้งเตือน', 'กรุณากรอกอีเมลและรหัสผ่านให้ครบถ้วน', 'warning');
    }

    if (!email.endsWith('@psu.ac.th')) { 
        return Swal.fire('ผิดพลาด', 'กรุณาใช้อีเมล @psu.ac.th ในการเข้าสู่ระบบเท่านั้น', 'error'); 
    }

    let originalBtnText = "";
    if (loginBtn) {
        originalBtnText = loginBtn.innerText;
        loginBtn.disabled = true;
        loginBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>กำลังเข้าสู่ระบบ...';
    }
    
    try {
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (err) { 
        let errorMessage = "เกิดข้อผิดพลาดในการเข้าสู่ระบบ";
        if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') {
            errorMessage = 'อีเมลหรือรหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง';
        } else if (err.code === 'auth/too-many-requests') {
            errorMessage = 'คุณใส่รหัสผิดหลายครั้งเกินไป บัญชีถูกล็อกชั่วคราว';
        } else {
            errorMessage = err.message; 
        }

        if(errorDiv) {
            errorDiv.innerText = errorMessage;
            errorDiv.style.display = 'block';
        }

        if (loginBtn) {
            loginBtn.disabled = false;
            loginBtn.innerHTML = originalBtnText;
        }
    }
};

// 4. ฟังก์ชันสลับตาดูรหัสผ่าน
window.togglePasswordFB = function(inputId, iconId) {
    let x = document.getElementById(inputId);
    let icon = document.getElementById(iconId);
    if (x.type === "password") {
        x.type = "text";
        icon.classList.remove("bi-eye-slash");
        icon.classList.add("bi-eye", "text-primary");
    } else {
        x.type = "password";
        icon.classList.remove("bi-eye", "text-primary");
        icon.classList.add("bi-eye-slash");
    }
};

// 5. ลืมรหัสผ่าน
window.forgotPasswordFB = async function() {
    const { value: email } = await Swal.fire({ 
        title: 'รีเซ็ตรหัสผ่าน', 
        input: 'email', 
        inputLabel: 'ใส่อีเมล @psu.ac.th ของคุณ', 
        inputPlaceholder: 'username@psu.ac.th', 
        showCancelButton: true, 
        confirmButtonText: 'ส่งลิงก์', 
        confirmButtonColor: '#0d6efd' 
    });
    
    if (email) {
        Swal.fire({ title: 'กำลังส่งลิงก์...', didOpen: () => Swal.showLoading() });
        try { 
            await sendPasswordResetEmail(auth, email); 
            Swal.fire('สำเร็จ!', 'ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่อีเมลของคุณแล้ว', 'success'); 
        } catch(e) { 
            Swal.fire('เกิดข้อผิดพลาด', 'ไม่พบอีเมลนี้ในระบบ หรือเกิดข้อผิดพลาด', 'error'); 
        }
    }
};