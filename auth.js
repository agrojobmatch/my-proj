import { app, auth, db } from './firebase.js';
import { signInWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { collection, query, where, getDocs, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// 1. ดึงปีการศึกษามาแสดงที่หน้า Login
// ✅ ปรับปรุง: รอให้ HTML โหลดเสร็จก่อนค่อยดึงข้อมูลมาใส่ ป้องกันหา Element ไม่เจอ
document.addEventListener("DOMContentLoaded", () => {
    onSnapshot(query(collection(db, "cycles"), orderBy("start", "desc")), (snap) => {
        let html = '';
        const today = new Date(); 
        today.setHours(0,0,0,0);
        let autoSelected = false;
        
        snap.forEach(d => {
            let c = d.data(); 
            if(!c.name) c.name = d.id.replace(/-/g, '/'); 
            
            let startDate = new Date(c.start + "T00:00:00"), endDate = new Date(c.end + "T23:59:59");
            let isCurrent = (today >= startDate && today <= endDate);
            let label = c.name + (c.status !== 'Active' ? ' (ปิดรอบ)' : '');
            let selectedStr = (c.status === 'Active' && isCurrent && !autoSelected) ? 'selected' : '';
            if(selectedStr) autoSelected = true;
            
            html += `<option value="${c.name}" ${selectedStr}>${label}</option>`;
        });
        
        const loginYearSelect = document.getElementById('loginYear');
        if(loginYearSelect) loginYearSelect.innerHTML = html || '<option value="1/2568">1/2568</option>';
    });
});

// 2. เช็คสิทธิ์และตรวจสอบข้อมูลใน Database
onAuthStateChanged(auth, async (fbUser) => {
    if (fbUser) {
        // ✅ ปรับปรุง: ตรวจสอบว่าตอนนี้อยู่หน้า Login (index.html) หรือไม่ 
        // ป้องกัน Infinite Loop ถ้าเผลอโหลดสคริปต์นี้ในหน้าอื่น
        const currentPath = window.location.pathname;
        const isLoginPage = currentPath.endsWith('index.html') || currentPath === '/' || currentPath.endsWith('/Agro-job-match/');
        
        if (!isLoginPage) return; // ถ้าไม่ได้อยู่หน้าล็อกอิน ให้หยุดการทำงาน ไม่ต้อง Redirect ใหม่

        Swal.fire({ title: 'กำลังโหลดข้อมูล...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        
        try {
            // ✅ อัปเดต: ค้นหาข้อมูลนักศึกษาของรอบปัจจุบัน (รองรับ Schema ใหม่ที่แยกตามปี)
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
            
            // ถ้าไม่อยู่ในช่วงเวลาของรอบไหนเลย ให้ดึงรอบล่าสุดมาใช้
            if (!currentCycle && cyclesSnap.size > 0) {
                const sorted = Array.from(cyclesSnap.docs)
                    .map(d => ({ ...d.data(), id: d.id }))
                    .sort((a, b) => new Date(b.start) - new Date(a.start));
                if (sorted.length > 0) currentCycle = sorted[0].name;
            }

            // ✅ ค้นหาข้อมูลนักศึกษาจาก email + currentCycle
            const studentQuery = query(
                collection(db, "users"), 
                where("email", "==", fbUser.email), 
                where("role", "==", "Student"),
                where("year", "==", currentCycle)
            );
            const studentSnap = await getDocs(studentQuery);

            // ถ้าไม่มีข้อมูลนักศึกษาในรอบนี้ ให้ค้นหาเผื่อว่าเป็น Admin/Teacher/Staff
            if (studentSnap.empty) {
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
                    Swal.fire('ไม่มีสิทธิ์เข้าถึง', 'ไม่พบอีเมลของคุณในระบบทุนทำงานรอบนี้ กรุณาติดต่อแอดมิน', 'error');
                    auth.signOut(); 
                }
            } else {
                // ✅ เป็นนักศึกษาและมีข้อมูลในรอบปัจจุบัน ส่งไปหน้า student.html
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

// 3. ฟังก์ชันเข้าสู่ระบบ (กดปุ่ม Login)
// ✅ ปรับปรุง: รับค่า paramType เข้ามาเพื่อลดการพึ่งพาตัวแปร Global (window.currentUserTypeTab)
window.loginFB = async function(paramType) {
    let errorDiv = document.getElementById('login-error-msg');
    if(errorDiv) errorDiv.style.display = 'none';

    let type = paramType || window.currentUserTypeTab || 'Student';
    let email = "", pass = "";
    let loginBtn = null;
    let originalBtnText = "";

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
        } else if (err.code === 'auth/invalid-email') {
            errorMessage = 'รูปแบบอีเมลไม่ถูกต้อง';
        } else if (err.code === 'auth/too-many-requests') {
            errorMessage = 'คุณใส่รหัสผิดหลายครั้งเกินไป บัญชีถูกล็อกชั่วคราว กรุณารอสักครู่';
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
            Swal.fire('สำเร็จ!', 'ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่อีเมลของคุณแล้ว\n(อย่าลืมเช็คในกล่องจดหมายขยะ/Junk)', 'success'); 
        } catch(e) { 
            let errMsg = 'ไม่พบอีเมลนี้ในระบบ หรือเกิดข้อผิดพลาดบางอย่าง';
            if (e.code === 'auth/invalid-email') errMsg = 'รูปแบบอีเมลไม่ถูกต้อง';
            else if (e.code === 'auth/user-not-found') errMsg = 'ไม่พบอีเมลนี้ในระบบ กรุณาติดต่อแอดมิน';
            Swal.fire('เกิดข้อผิดพลาด', errMsg, 'error'); 
        }
    }
};