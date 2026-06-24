// public/js/admin.js
import { app, auth, db } from './firebase.js';
import { signOut, onAuthStateChanged, sendPasswordResetEmail, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { collection, doc, query, where, getDocs, onSnapshot, addDoc, updateDoc, deleteDoc, setDoc, serverTimestamp, orderBy } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";

window.user = null;
window.globalJobs = [];
window.allCycles = [];
let chartHoursObj = null; 
let chartBudgetObj = null;

window.escapeHtml = function(text) { return text ? text.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;") : ""; };

// 1. ตรวจสอบสิทธิ์การเข้าถึงหน้าแอดมิน
onAuthStateChanged(auth, async (fbUser) => {
    if (fbUser) {
        Swal.fire({ title: 'กำลังตรวจสอบสิทธิ์ Admin...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        try {
            const q = query(collection(db, "users"), where("email", "==", fbUser.email), where("role", "==", "Admin"));
            const snap = await getDocs(q);
            
            if (!snap.empty) {
                let profiles = [];
                snap.forEach(d => profiles.push(d.data()));
                window.user = profiles[0];
                
                document.getElementById('uName').innerText = window.user.name;

                // โหลด Cycles อัตโนมัติและผูกกับ Dropdown
                onSnapshot(query(collection(db, "cycles"), orderBy("start", "desc")), (cycleSnap) => {
                    window.allCycles = []; let adminHtml = '';
                    const today = new Date(); today.setHours(0,0,0,0); let autoSelected = false;
                    
                    cycleSnap.forEach(d => {
                        let c = d.data(); 
                        if(!c.name) c.name = d.id.replace(/-/g, '/'); 
                        window.allCycles.push(c);
                        
                        let startDate = new Date(c.start + "T00:00:00"), endDate = new Date(c.end + "T23:59:59");
                        let isCurrent = (today >= startDate && today <= endDate);
                        let label = escapeHtml(c.name) + (c.status !== 'Active' ? ' (ปิดรอบ)' : '');
                        let selectedStr = (c.status === 'Active' && isCurrent && !autoSelected) ? 'selected' : '';
                        if(selectedStr) autoSelected = true;
                        
                        let opt = `<option value="${escapeHtml(c.name)}" ${selectedStr}>${label}</option>`;
                        adminHtml += opt;
                    });
                    
                    if(document.getElementById('dash-cycle-select')) document.getElementById('dash-cycle-select').innerHTML = adminHtml;
                    if(document.getElementById('add-year')) document.getElementById('add-year').innerHTML = adminHtml;
                    if(document.getElementById('edit-usr-year')) document.getElementById('edit-usr-year').innerHTML = adminHtml;
                    
                    let sel = document.getElementById('dash-cycle-select');
                    let currentYear = sel ? sel.value : (window.allCycles.length > 0 ? window.allCycles[0].name : "1/2568");
                    window.user.year = currentYear;

                    window.renderAdminCycles(window.allCycles);
                    window.loadAdminDashboardFB(currentYear);
                });

                Swal.close();
            } else {
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

// UI & Navigation
window.logoutSystemFB = async function() { await signOut(auth); window.location.href = 'index.html'; };
window.switchPage = function(pageId, linkElement) {
    // Admin มีแค่หน้าเดียวอยู่แล้ว ให้เป็นการ Active เมนูก็พอ
    if(linkElement) { 
        document.querySelectorAll('.navbar-nav .nav-link').forEach(el => el.classList.remove('active')); 
        linkElement.classList.add('active'); 
    }
};
window.goHome = function() { 
    // ไม่มีอะไรต้องทำสำหรับ Admin
};

window.onAdminCycleChange = function(newYear) { 
    if(!newYear) return; 
    window.user.year = newYear; 
    window.loadAdminDashboardFB(newYear); 
    window.loadAdminFinanceFB(); 
    window.loadUserTableFB(document.getElementById('userTypeSelector').value); 
};

// ==========================================
// ส่วนที่ 1: Dashboard และ จัดการรอบการทำงาน
// ==========================================
window.loadAdminDashboardFB = function(year) {
    if(!year) year = window.user.year; 
    
    // ดึงงานทั้งหมดของปีนี้เพื่อมาทำสถิติ
    onSnapshot(query(collection(db, "jobs"), where("year", "==", year), orderBy("date", "desc")), (snap) => {
        window.globalJobs = [];
        let tH = 0;
        snap.forEach(doc => { 
            let j = doc.data(); j.id = doc.id; 
            window.globalJobs.push(j); 
            if(j.status === 'Completed') tH += parseFloat(j.hours||0); 
        });
        
        let tP = 0; 
        let c = window.allCycles.find(x => x.name === year); 
        let rPerHour = c && c.ratePerHour ? parseFloat(c.ratePerHour) : 50; 
        tP = tH * rPerHour;
        let maxH = c && c.maxHours ? parseFloat(c.maxHours) : 5000; 
        let maxB = c && c.maxBudget ? parseFloat(c.maxBudget) : 250000;
        
        if(document.getElementById('dash-val-hours')) { 
            document.getElementById('dash-val-hours').innerText = tH.toFixed(2); 
            document.getElementById('dash-max-hours').innerText = maxH.toLocaleString(); 
            document.getElementById('dash-val-paid').innerText = tP.toLocaleString(); 
            document.getElementById('dash-max-budget').innerText = maxB.toLocaleString(); 
        }
        
        // Render Charts
        if(document.querySelector("#chart-hours") && typeof ApexCharts !== 'undefined') { 
            if(chartHoursObj) chartHoursObj.destroy(); 
            chartHoursObj = new ApexCharts(document.querySelector("#chart-hours"), { series: [Math.min((tH/maxH)*100, 100)], chart:{type:'radialBar', height:250}, colors:['#0d6efd']}); 
            chartHoursObj.render(); 
        }
        if(document.querySelector("#chart-budget") && typeof ApexCharts !== 'undefined') { 
            if(chartBudgetObj) chartBudgetObj.destroy(); 
            chartBudgetObj = new ApexCharts(document.querySelector("#chart-budget"), { series: [{name:'ใช้ไป', data:[tP]}, {name:'เหลือ', data:[maxB-tP]}], chart:{type:'bar', height:180, stacked:true}, plotOptions:{bar:{horizontal:true}}, colors:['#198754', '#ffc107']}); 
            chartBudgetObj.render(); 
        }

        renderAdminJobList(window.globalJobs);
    });
};

function renderAdminJobList(list) {
    let h = ''; 
    list.forEach(i => { 
        let badge = i.status=='Completed'?'badge-soft-success':(i.status=='PendingApproval'?'badge-soft-primary':(i.status=='Booked'?'badge-soft-warning':(i.status=='Expired'?'badge-soft-danger':'badge-soft-info'))); 
        let sText = i.status=='PendingApproval'?'รอตรวจ':i.status; 
        h += `<div class="p-3 border-bottom bg-white hover-bg-light"><div class="d-flex justify-content-between align-items-center"><div><span class="badge ${badge} me-2">${sText}</span> <strong class="text-dark">${i.date}</strong> <small class="text-muted ms-2">${i.time}</small></div><div><button onclick="window.confirmDelJobFB('${i.id}')" class="btn btn-sm btn-link text-danger p-0"><i class="bi bi-trash"></i></button></div></div><div class="small mt-2 ps-1"><i class="bi bi-person me-1 text-muted"></i> ${escapeHtml(i.stuName)} ${i.teacherName ? `<span class="text-muted ms-2"><i class="bi bi-arrow-right-short"></i> ${escapeHtml(i.task)} (${escapeHtml(i.teacherName)})</span>` : ''}</div></div>`; 
    });
    if(document.getElementById('adminList')) document.getElementById('adminList').innerHTML = h;
    
    // Top 5 Students
    let sSt = {}; 
    list.forEach(i => { if(i.status == 'Completed') { let n = i.stuName; if(!sSt[n]) sSt[n] = 0; sSt[n] += parseFloat(i.hours)||0; }});
    let t5 = Object.entries(sSt).sort((a,b)=>b[1]-a[1]).slice(0,5); 
    if(document.getElementById('topStudentList')) document.getElementById('topStudentList').innerHTML = t5.map((s,i) => `<li class="list-group-item d-flex justify-content-between border-0 px-3 py-2"><span><span class="badge bg-light text-dark me-2">#${i+1}</span> ${escapeHtml(s[0])}</span><span class="fw-bold text-primary">${s[1].toFixed(1)} ชม.</span></li>`).join('');
}

window.filterAdminJobs = function() { 
    let t = document.getElementById('adminJobSearch').value.toLowerCase(); 
    document.querySelectorAll('#adminList > div').forEach(c => { c.style.display = c.innerText.toLowerCase().includes(t) ? 'block' : 'none'; }); 
};

window.confirmDelJobFB = async function(id) { 
    Swal.fire({title:'ลบรายการ?',icon:'error',showCancelButton:true}).then(async r=>{ 
        if(r.isConfirmed) { try { await deleteDoc(doc(db, "jobs", id)); Swal.fire('ลบแล้ว','','success'); } catch(e) { Swal.fire('ผิดพลาด', e.message, 'error'); } } 
    }); 
};

// จัดการ Cycles
window.renderAdminCycles = function(cycles) { 
    let html = '<ul class="list-group list-group-flush">'; 
    if(!cycles || cycles.length === 0) { html += '<li class="list-group-item text-center text-muted py-4">ยังไม่ได้เพิ่มรอบการทำงาน</li>'; } 
    else { 
        cycles.forEach(c => { 
            let badge = c.status === 'Active' ? 'bg-success' : 'bg-secondary'; 
            html += `<li class="list-group-item d-flex justify-content-between align-items-center"><div><span class="fw-bold">${escapeHtml(c.name)}</span> <br><small class="text-muted"><i class="bi bi-calendar"></i> ${c.start} ถึง ${c.end}</small><br><small class="text-info"><i class="bi bi-target"></i> เป้าหมาย: ${(parseFloat(c.maxHours)||0).toLocaleString()} ชม. / ${(parseFloat(c.maxBudget)||0).toLocaleString()} บ.</small><br><small class="text-danger fw-bold"><i class="bi bi-coin"></i> เรทจ่าย: ${c.ratePerHour || 50} บ./ชม.</small></div><div><span class="badge ${badge} me-2">${c.status}</span><button class="btn btn-sm btn-outline-secondary border-0 me-1" onclick="window.prepareEditCycleFB('${escapeHtml(c.name)}', '${c.start}', '${c.end}', '${c.status}', ${c.maxHours}, ${c.maxBudget}, ${c.ratePerHour || 50})"><i class="bi bi-pencil-square"></i></button><button class="btn btn-sm btn-outline-danger border-0" onclick="window.delCycleFB('${escapeHtml(c.name)}')"><i class="bi bi-trash"></i></button></div></li>`; 
        }); 
    } 
    html += '</ul>'; 
    if(document.getElementById('adminCycleList')) document.getElementById('adminCycleList').innerHTML = html; 
};

window.openEditCycleForDashboard = function() { 
    let sel = document.getElementById('dash-cycle-select'); 
    if(!sel || !sel.value) return Swal.fire('เตือน', 'ไม่พบข้อมูลรอบการทำงาน', 'warning'); 
    let cycleName = sel.value; 
    let c = window.allCycles.find(x => x.name === cycleName); 
    if(c) { window.prepareEditCycleFB(c.name, c.start, c.end, c.status, c.maxHours, c.maxBudget, c.ratePerHour || 50); } 
};

window.prepareEditCycleFB = function(n, s, e, st, mh, mb, rate) { document.getElementById('edit-cyc-originalname').value = n; document.getElementById('edit-cyc-name').value = n; document.getElementById('edit-cyc-start').value = s; document.getElementById('edit-cyc-end').value = e; document.getElementById('edit-cyc-status').value = st; document.getElementById('edit-cyc-maxh').value = mh; document.getElementById('edit-cyc-maxb').value = mb; document.getElementById('edit-cyc-rate').value = rate; bootstrap.Modal.getOrCreateInstance(document.getElementById('editCycleModal')).show(); };
window.confirmAddCycleFB = async function() { const n = document.getElementById('cyc-name').value.trim(), s = document.getElementById('cyc-start').value, e = document.getElementById('cyc-end').value, mh = document.getElementById('cyc-maxh').value, mb = document.getElementById('cyc-maxb').value, rate = document.getElementById('cyc-rate').value; if(!n || !s || !e || !mh || !mb || !rate) return Swal.fire('เตือน', 'กรุณากรอกข้อมูลให้ครบทุกช่อง', 'warning'); Swal.fire({ title: 'กำลังบันทึก...', didOpen: ()=>Swal.showLoading() }); try { const docId = n.replace(/\//g, '-'); await setDoc(doc(db, "cycles", docId), { name: n, start: s, end: e, maxHours: mh, maxBudget: mb, ratePerHour: rate, status: 'Active' }); document.getElementById('cyc-name').value = ''; document.getElementById('cyc-start').value = ''; document.getElementById('cyc-end').value = ''; document.getElementById('cyc-maxh').value = ''; document.getElementById('cyc-maxb').value = ''; document.getElementById('cyc-rate').value = '50'; bootstrap.Modal.getInstance(document.getElementById('cycleModal')).hide(); Swal.fire('สำเร็จ', 'เพิ่มรอบการทำงานแล้ว', 'success'); } catch(e) { Swal.fire('ผิดพลาด', e.message, 'error'); } };
window.confirmEditCycleFB = async function() { const o = document.getElementById('edit-cyc-originalname').value; const docId = o.replace(/\//g, '-'); try { await updateDoc(doc(db, "cycles", docId), { start: document.getElementById('edit-cyc-start').value, end: document.getElementById('edit-cyc-end').value, maxHours: document.getElementById('edit-cyc-maxh').value, maxBudget: document.getElementById('edit-cyc-maxb').value, ratePerHour: document.getElementById('edit-cyc-rate').value, status: document.getElementById('edit-cyc-status').value }); bootstrap.Modal.getInstance(document.getElementById('editCycleModal')).hide(); Swal.fire('สำเร็จ', 'แก้ไขรอบการทำงานแล้ว', 'success'); } catch(e) { Swal.fire('ผิดพลาด', e.message, 'error'); } };
window.delCycleFB = async function(n) { Swal.fire({title:'ลบ?', text:`ยืนยันลบรอบ ${n}`, icon:'warning', showCancelButton:true}).then(async r => { if(r.isConfirmed) { try { const docId = n.replace(/\//g, '-'); await deleteDoc(doc(db, "cycles", docId)); Swal.fire('ลบแล้ว', '', 'success'); } catch(e) { Swal.fire('ผิดพลาด', e.message, 'error'); } } }); };

// ==========================================
// ส่วนที่ 2: ระบบการเงิน (Finance)
// ==========================================
window.loadAdminFinanceFB = function() { 
    let currentYear = (window.user && window.user.year) ? window.user.year : "1/2568";
    onSnapshot(query(collection(db, "withdrawals"), where("year", "==", currentYear), orderBy("timestamp", "desc")), (snap) => { 
        let h = ''; 
        snap.forEach(doc => { 
            let r = doc.data(); r.id = doc.id; 
            let badge = r.status==='รอส่งเอกสาร'?'badge-soft-warning':(r.status==='กำลังดำเนินการ'?'badge-soft-info':'badge-soft-success'); 
            h += `<tr><td class="ps-3"><input type="checkbox" class="finance-check form-check-input" value="${r.id}"></td><td>${r.docNum||'-'}</td><td><span class="fw-bold text-dark">${escapeHtml(r.studentName)}</span><br><small class="text-muted">${escapeHtml(r.studentEmail)}</small></td><td class="fw-bold text-end text-primary">${r.amount.toLocaleString()}</td><td class="text-center"><span class="badge ${badge}">${r.status}</span></td></tr>`; 
        }); 
        if(document.getElementById('admFinanceList')) document.getElementById('admFinanceList').innerHTML = h || '<tr><td colspan="5" class="text-center py-4 text-muted">ไม่มีข้อมูล</td></tr>'; 
    }); 
};

window.exportFinanceToCSV = async function() { 
    Swal.fire({ title: 'กำลังเตรียมไฟล์ Excel...', didOpen: () => Swal.showLoading() }); 
    try { 
        const snap = await getDocs(query(collection(db, "withdrawals"), where("year", "==", window.user.year), orderBy("timestamp", "desc"))); 
        if(snap.empty) return Swal.fire('ไม่มีข้อมูล', 'ไม่มีข้อมูลเบิกจ่ายให้ดาวน์โหลด', 'info'); 
        
        let csvContent = "data:text/csv;charset=utf-8,\uFEFF"; 
        csvContent += "เลขที่เอกสาร,ชื่อ-สกุล,อีเมล,ยอดเงิน (บาท),สถานะ,วันที่เบิก\n"; 
        snap.forEach(doc => { 
            let d = doc.data(); 
            let dateStr = new Date(d.timestamp).toLocaleDateString('th-TH'); 
            csvContent += `"${d.docNum||'-'}","${d.studentName}","${d.studentEmail}",${d.amount},"${d.status}","${dateStr}"\n`; 
        }); 
        
        var encodedUri = encodeURI(csvContent); 
        var link = document.createElement("a"); 
        link.setAttribute("href", encodedUri); 
        link.setAttribute("download", `รายการเบิกจ่าย_${window.user.year.replace(/\//g, '-')}.csv`); 
        document.body.appendChild(link); link.click(); document.body.removeChild(link); 
        Swal.close(); 
    } catch (err) { Swal.fire('ผิดพลาด', err.message, 'error'); } 
}

window.bulkUpdateStatusFB = async function(status) { 
    let ids = Array.from(document.querySelectorAll('.finance-check:checked')).map(c => c.value); 
    if(ids.length === 0) return Swal.fire('แจ้งเตือน', 'กรุณาเลือกรายการ', 'warning'); 
    
    Swal.fire({ title: 'บันทึก...', didOpen: ()=>Swal.showLoading() }); 
    try { 
        for(let id of ids) await updateDoc(doc(db, "withdrawals", id), { status: status }); 
        Swal.fire('สำเร็จ', 'อัปเดตสถานะแล้ว', 'success'); 
        document.getElementById('selectAll').checked = false; 
    } catch(e) { Swal.fire('ผิดพลาด', e.message, 'error'); } 
};
window.toggleAllChecks = function(src) { document.querySelectorAll('.finance-check').forEach(c => c.checked = src.checked); };

// ==========================================
// ส่วนที่ 3: ระบบจัดการผู้ใช้งาน (Users & Search)
// ==========================================
window.loadUserTableFB = async function(type) {
    let currentYear = (window.user && window.user.year) ? window.user.year : "1/2568";
    const roleToSearch = type === 'Students' ? 'Student' : type; 
    let q;
    
    if (roleToSearch === 'Student') { 
        q = query(collection(db, "users"), where("role", "==", "Student"), where("year", "==", currentYear)); 
    } else { 
        q = query(collection(db, "users"), where("role", "==", roleToSearch)); 
    }
    
    const snap = await getDocs(q); let h = '';
    
    snap.forEach(doc => { 
        let r = doc.data(); r.id = doc.id; 
        if(type=='Students') { 
            let stuHours = 0; window.globalJobs.forEach(j => { if (j.studentEmail === r.email && j.status === 'Completed') stuHours += parseFloat(j.hours||0); });
            let lim = parseFloat(r.limit) || 40; let pct = Math.min((stuHours/lim)*100, 100);
            
            h += `<tr><td class="ps-3"><div class="fw-bold text-dark">${escapeHtml(r.name)}</div><small class="text-muted">${escapeHtml(r.studentId)} &bull; ${escapeHtml(r.major)}</small></td><td><span class="badge bg-light text-dark border">${r.year}</span></td><td><div class="d-flex justify-content-between small mb-1"><span><span class="fw-bold text-primary">${stuHours.toFixed(1)}</span> / ${lim} ชม.</span><span>${pct.toFixed(0)}%</span></div><div class="progress" style="height:6px;"><div class="progress-bar ${stuHours>=lim?'bg-danger':'bg-success'}" style="width:${pct}%"></div></div></td><td class="text-center"><button class="btn btn-sm btn-outline-info rounded-circle me-1" onclick="document.getElementById('profileSearchKey').value='${r.email}'; window.searchStudentProfileFB(); bootstrap.Tab.getOrCreateInstance(document.querySelector('[data-bs-target=\\'#adm-profiles\\']')).show();" title="ดูประวัติ"><i class="bi bi-search"></i></button><button class="btn btn-sm btn-outline-secondary rounded-circle me-1" onclick="window.adminResetPasswordFB('${r.email}')" title="ส่งลิงก์รีเซ็ตรหัสผ่าน"><i class="bi bi-key"></i></button><button class="btn btn-sm btn-outline-warning rounded-circle me-1" onclick="window.openEditUserModalFB('${r.id}', '${escapeHtml(r.name)}', '${escapeHtml(r.studentId||'')}', '${escapeHtml(r.major||'')}', '${r.limit||40}', '${r.year}', '${r.role}', '${escapeHtml(r.phone||'')}')" title="แก้ไขข้อมูล"><i class="bi bi-pencil-square"></i></button><button class="btn btn-sm btn-outline-danger rounded-circle" onclick="window.deleteUserFB('${r.id}')" title="ลบ"><i class="bi bi-trash"></i></button></td></tr>`; 
        } else { 
            h += `<tr><td class="ps-3"><div class="fw-bold text-dark">${escapeHtml(r.name)}</div></td><td>-</td><td><small class="text-muted">${escapeHtml(r.email)}</small></td><td class="text-center"><button class="btn btn-sm btn-outline-secondary rounded-circle me-1" onclick="window.adminResetPasswordFB('${r.email}')" title="ส่งลิงก์รีเซ็ตรหัสผ่าน"><i class="bi bi-key"></i></button><button class="btn btn-sm btn-outline-warning rounded-circle me-1" onclick="window.openEditUserModalFB('${r.id}', '${escapeHtml(r.name)}', '', '', '', '', '${r.role}', '${escapeHtml(r.phone||'')}')" title="แก้ไขข้อมูล"><i class="bi bi-pencil-square"></i></button><button class="btn btn-sm btn-outline-danger rounded-circle" onclick="window.deleteUserFB('${r.id}')"><i class="bi bi-trash"></i></button></td></tr>`; 
        } 
    });
    if(document.querySelector('#userTable tbody')) document.querySelector('#userTable tbody').innerHTML = h || '<tr><td colspan="4" class="text-center text-muted py-4">ไม่พบข้อมูล</td></tr>';
};

window.openAddUserModalFB = function() { 
    let t = document.getElementById('userTypeSelector').value; 
    document.getElementById('add-type').value = t; 
    document.getElementById('add-phone').value = ''; 
    if(t == 'Students'){ 
        document.getElementById('field-id').classList.remove('hidden'); 
        document.getElementById('field-limit').classList.remove('hidden'); 
        document.getElementById('field-major').classList.remove('hidden'); 
        document.getElementById('field-year').classList.remove('hidden'); 
        document.getElementById('field-phone').classList.remove('hidden'); 
    } else { 
        document.getElementById('field-id').classList.add('hidden'); 
        document.getElementById('field-limit').classList.add('hidden'); 
        document.getElementById('field-major').classList.add('hidden'); 
        document.getElementById('field-year').classList.add('hidden'); 
        document.getElementById('field-phone').classList.add('hidden'); 
    } 
    bootstrap.Modal.getOrCreateInstance(document.getElementById('addUserModal')).show(); 
};

window.confirmAddUserFB = async function() {
    // โค้ดสร้าง User ด้วย Secondary App (ป้องกันการล็อกเอาท์แอดมินตอนสร้าง)
    const t = document.getElementById('add-type').value, email = document.getElementById('add-email').value.trim().toLowerCase(), name = document.getElementById('add-name').value.trim(), year = document.getElementById('add-year').value, limit = document.getElementById('add-limit').value, major = document.getElementById('add-major').value, id = document.getElementById('add-id').value.trim(), phone = document.getElementById('add-phone').value.trim();
    if(!email || !name) return Swal.fire('เตือน', 'กรุณากรอกอีเมลและชื่อ-สกุล', 'warning');
    if(t === 'Students' && (!id || !major || !limit || !year)) return Swal.fire('เตือน', 'กรุณากรอกข้อมูลนักศึกษาให้ครบทุกช่อง', 'warning');

    const realRole = t === 'Students' ? 'Student' : t;
    Swal.fire({ title: 'กำลังสร้างบัญชี...', didOpen: ()=>Swal.showLoading() });
    
    try { 
        if (realRole === 'Student') { 
            const qCheck = query(collection(db, "users"), where("email", "==", email), where("year", "==", year)); 
            const snapCheck = await getDocs(qCheck); 
            if(!snapCheck.empty) return Swal.fire('แจ้งเตือน', `อีเมลนี้มีชื่ออยู่ในรอบ ${year} แล้ว`, 'warning'); 
        }
        
        // Secondary App
        try { 
            // ต้องนำ config มาวางตรงนี้อีกทีสำหรับการสร้าง Secondary App
            const firebaseConfig = app.options; 
            const secondaryApp = initializeApp(firebaseConfig, "SecondaryApp" + Date.now()); 
            const secondaryAuth = getAuth(secondaryApp); 
            await createUserWithEmailAndPassword(secondaryAuth, email, "Agro123456"); 
            await signOut(secondaryAuth); 
        } catch (authErr) { 
            if (authErr.code !== 'auth/email-already-in-use') { 
                console.error(authErr); return Swal.fire('ผิดพลาด', 'ไม่สามารถสร้างรหัสผ่านได้: ' + authErr.message, 'error'); 
            } 
        }

        if (realRole === 'Student') { 
            await addDoc(collection(db, "users"), { email: email, name: name, role: realRole, year: year, limit: limit||40, major: major||'', studentId: id||'', phone: phone||'' }); 
        } else { 
            await setDoc(doc(db, "users", email), { email: email, name: name, role: realRole, year: year||'', limit: limit||40, major: major||'', studentId: id||'', phone: phone||'' }); 
        }
        
        document.getElementById('add-email').value = ''; document.getElementById('add-name').value = ''; document.getElementById('add-id').value = ''; document.getElementById('add-limit').value = ''; document.getElementById('add-phone').value = ''; document.getElementById('add-major').selectedIndex = 0;
        Swal.fire('สำเร็จ', `เพิ่มรายชื่อ${realRole === 'Student' ? `สำหรับรอบ ${year}` : ''} และตั้งรหัสผ่านเรียบร้อย`, 'success'); 
        bootstrap.Modal.getInstance(document.getElementById('addUserModal')).hide(); 
        window.loadUserTableFB(t);
    } catch(err) { Swal.fire('ผิดพลาด', err.message, 'error'); }
};

window.deleteUserFB = async function(id) { Swal.fire({title:'ลบ?',icon:'warning',showCancelButton:true}).then(async r=>{ if(r.isConfirmed){ try { await deleteDoc(doc(db, "users", id)); window.loadUserTableFB(document.getElementById('userTypeSelector').value); Swal.fire('สำเร็จ', 'ลบผู้ใช้เรียบร้อย', 'success'); } catch(e) { Swal.fire('ผิดพลาด', e.message, 'error'); } } }); };

window.openEditUserModalFB = function(id, name, studentId, major, limit, year, role, phone) {
    document.getElementById('edit-usr-id').value = id; document.getElementById('edit-usr-role').value = role; document.getElementById('edit-usr-name').value = name;
    let yearHtml = document.getElementById('add-year').innerHTML; document.getElementById('edit-usr-year').innerHTML = yearHtml;
    if (role === 'Student') {
        document.getElementById('edit-field-id').classList.remove('hidden'); document.getElementById('edit-field-limit').classList.remove('hidden'); document.getElementById('edit-field-major').classList.remove('hidden'); document.getElementById('edit-field-year').classList.remove('hidden'); document.getElementById('edit-field-phone').classList.remove('hidden');
        document.getElementById('edit-usr-studentid').value = studentId; document.getElementById('edit-usr-major').value = major; document.getElementById('edit-usr-limit').value = limit; document.getElementById('edit-usr-year').value = year; document.getElementById('edit-usr-phone').value = phone || '';
    } else {
        document.getElementById('edit-field-id').classList.add('hidden'); document.getElementById('edit-field-limit').classList.add('hidden'); document.getElementById('edit-field-major').classList.add('hidden'); document.getElementById('edit-field-year').classList.add('hidden'); document.getElementById('edit-field-phone').classList.remove('hidden'); document.getElementById('edit-usr-phone').value = phone || '';
    }
    bootstrap.Modal.getOrCreateInstance(document.getElementById('editUserModal')).show();
};

window.confirmSaveEditUserFB = async function() {
    const id = document.getElementById('edit-usr-id').value, role = document.getElementById('edit-usr-role').value, name = document.getElementById('edit-usr-name').value.trim();
    if(!name) return Swal.fire('เตือน', 'กรุณากรอกชื่อ-สกุล', 'warning');
    let updateData = { name: name };
    if(role === 'Student') {
        updateData.studentId = document.getElementById('edit-usr-studentid').value.trim(); updateData.major = document.getElementById('edit-usr-major').value; updateData.limit = document.getElementById('edit-usr-limit').value; updateData.year = document.getElementById('edit-usr-year').value; updateData.phone = document.getElementById('edit-usr-phone').value.trim();
        if(!updateData.studentId || !updateData.major || !updateData.limit || !updateData.year) return Swal.fire('เตือน', 'กรุณากรอกข้อมูลนักศึกษาให้ครบทุกช่อง', 'warning');
    } else { updateData.phone = document.getElementById('edit-usr-phone').value.trim(); }

    Swal.fire({ title: 'กำลังบันทึกข้อมูล...', didOpen: ()=>Swal.showLoading() });
    try { await updateDoc(doc(db, "users", id), updateData); Swal.fire('สำเร็จ', 'แก้ไขข้อมูลผู้ใช้เรียบร้อย', 'success'); bootstrap.Modal.getInstance(document.getElementById('editUserModal')).hide(); window.loadUserTableFB(document.getElementById('userTypeSelector').value); } catch(e) { Swal.fire('ผิดพลาด', e.message, 'error'); }
};

window.adminResetPasswordFB = async function(userEmail) {
    Swal.fire({ title: 'รีเซ็ตรหัสผ่าน?', text: `ระบบจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ ไปที่อีเมล: ${userEmail} ยืนยันหรือไม่?`, icon: 'question', showCancelButton: true, confirmButtonText: 'ใช่, ส่งลิงก์เลย', confirmButtonColor: '#0d6efd' }).then(async (result) => {
        if (result.isConfirmed) {
            Swal.fire({ title: 'กำลังส่งลิงก์...', didOpen: () => Swal.showLoading() });
            try { await sendPasswordResetEmail(auth, userEmail); Swal.fire('สำเร็จ!', `ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่ ${userEmail} เรียบร้อยแล้ว`, 'success'); } 
            catch(e) { Swal.fire('เกิดข้อผิดพลาด', e.message, 'error'); }
        }
    });
};

// ==========================================
// อัปเดตฟังก์ชัน ค้นหาโปรไฟล์ (แก้ปัญหาโหลดค้าง + จัดเรียงวันที่ด้วย JS)
// ==========================================
window.searchStudentProfileFB = async function() {
    let k = document.getElementById('profileSearchKey').value.trim(); 
    if(!k) return;
    
    // แสดงตัวโหลด
    document.getElementById('profileResult').innerHTML='<div class="text-center py-4"><span class="spinner-border text-primary"></span><p class="text-muted mt-2">กำลังค้นหา...</p></div>';
    
    try {
        // 1. ค้นหาข้อมูล User
        let q; 
        if(k.includes('@')) { 
            q = query(collection(db, "users"), where("email", "==", k), where("role", "==", "Student")); 
        } else { 
            q = query(collection(db, "users"), where("studentId", "==", k), where("role", "==", "Student")); 
        }
        
        const snap = await getDocs(q); 
        let u = null; 
        snap.forEach(doc => { u = doc.data(); });
        
        if(!u) return document.getElementById('profileResult').innerHTML = `<div class="alert alert-warning border-0 shadow-sm">ไม่พบข้อมูล (ลองตรวจสอบอีเมลหรือรหัสนักศึกษาอีกครั้ง)</div>`;
        
        // 2. ดึงงานทั้งหมดของนักศึกษา (ถอด orderBy ออกเพื่อแก้ปัญหาโหลดค้างเรื่อง Index)
       const jSnap = await getDocs(query(collection(db, "jobs"), 
    where("studentEmail", "==", u.email), 
    where("year", "==", document.getElementById('dash-cycle-select').value) // หรือ window.user.year
));
        // เอาข้อมูลใส่ Array ก่อนเพื่อเอามาเรียงลำดับ
        let jobsArray = [];
        jSnap.forEach(doc => {
            let j = doc.data();
            j.id = doc.id;
            jobsArray.push(j);
        });

        // เรียงลำดับวันที่ใหม่สุดขึ้นก่อน (Descending) ด้วย JavaScript
        jobsArray.sort((a, b) => new Date(b.date) - new Date(a.date));

        let tJ = 0, cJ = 0, tH = 0, hist = '';
        
        // 3. วนลูปแสดงผล
        jobsArray.forEach(j => { 
            tJ++; 
            if(j.status === 'Completed'){ 
                cJ++; tH += parseFloat(j.hours||0); 
                let ratingHtml = ''; 
                if(j.rating) { 
                    ratingHtml = `<div class="mt-2 p-2 bg-warning bg-opacity-10 rounded small border-start border-3 border-warning"><span class="text-warning fw-bold"><i class="bi bi-star-fill"></i> ${j.rating}/5</span>${j.review ? `<div class="text-muted fst-italic mt-1" style="font-size: 0.8rem;">"${escapeHtml(j.review)}"</div>` : ''}</div>`; 
                }
                hist += `
                <div class="card p-3 border-0 shadow-sm mb-2">
                    <div class="d-flex justify-content-between align-items-start">
                        <div>
                            <strong class="text-dark">${escapeHtml(j.task)}</strong>
                            <span class="badge bg-light text-dark border ms-2">${j.status}</span>
                        </div>
                        <div>
                            <button class="btn btn-sm btn-outline-warning p-1 me-1" onclick="window.openEditHistoryFB('${j.id}', '${escapeHtml(j.task)}', '${j.date}', ${j.hours}, ${j.withdrawn || false}, '${u.email}')" title="แก้ไข"><i class="bi bi-pencil"></i></button>
                            <button class="btn btn-sm btn-outline-danger p-1" onclick="window.adminDeleteJobFB('${j.id}', '${u.email}')" title="ลบข้อมูล"><i class="bi bi-trash"></i></button>
                        </div>
                    </div>
                    <small class="text-muted"><i class="bi bi-calendar me-1"></i>${j.date} &bull; <span class="text-primary fw-bold">${j.hours} ชม.</span></small>
                    ${ratingHtml}
                </div>`; 
            } 
        });
        
        // ประกอบร่าง HTML
        let h = `
        <div class="card mb-4 border-0 shadow-sm">
            <div class="card-body text-center pt-4">
                <div class="mb-3"><div class="avatar-circle bg-light d-inline-block p-3 rounded-circle"><i class="bi bi-person-fill fs-1 text-secondary"></i></div></div>
                <h5 class="fw-bold mb-0">${escapeHtml(u.name)}</h5>
                <p class="text-muted small">${u.studentId||'-'} | <i class="bi bi-telephone"></i> ${escapeHtml(u.phone||'ไม่ระบุ')}</p>
                <div class="row mt-4">
                    <div class="col border-end"><h3>${tJ}</h3><small class="text-muted">งานทั้งหมด</small></div>
                    <div class="col border-end text-success"><h3>${cJ}</h3><small>เสร็จสิ้น</small></div>
                    <div class="col text-primary"><h3>${tH.toFixed(1)}</h3><small>ชม. สะสม</small></div>
                </div>
            </div>
        </div>
        <h6 class="fw-bold text-muted ps-2 mb-3">ประวัติล่าสุด (ที่เสร็จสิ้น)</h6>
        <div class="d-grid gap-2">${hist||'<div class="text-center text-muted">ยังไม่มีประวัติ</div>'}</div>`; 
        
        document.getElementById('profileResult').innerHTML = h;

    } catch (error) {
        console.error("Search Error: ", error);
        document.getElementById('profileResult').innerHTML = `<div class="alert alert-danger border-0 shadow-sm">เกิดข้อผิดพลาดในการดึงข้อมูล: ${error.message}</div>`;
    }
};

// ==========================================
// ฟังก์ชันสำหรับ Admin แก้ไข / ลบ งานในประวัติ
// ==========================================

// เปิดหน้าต่างแก้ไข
window.openEditHistoryFB = function(id, task, date, hours, withdrawn, studentEmail) {
    document.getElementById('edit-hist-id').value = id;
    document.getElementById('edit-hist-email').value = studentEmail;
    document.getElementById('edit-hist-task').value = task;
    document.getElementById('edit-hist-date').value = date;
    document.getElementById('edit-hist-hours').value = hours;
    document.getElementById('edit-hist-withdrawn').checked = (withdrawn === true || withdrawn === "true");
    bootstrap.Modal.getOrCreateInstance(document.getElementById('editHistoryModal')).show();
};

// ยืนยันการแก้ไขบันทึก
window.confirmEditHistoryJobFB = async function() {
    const id = document.getElementById('edit-hist-id').value;
    const studentEmail = document.getElementById('edit-hist-email').value;
    const task = document.getElementById('edit-hist-task').value;
    const date = document.getElementById('edit-hist-date').value;
    const hours = document.getElementById('edit-hist-hours').value;
    const withdrawn = document.getElementById('edit-hist-withdrawn').checked;

    if(!task || !date || !hours) return Swal.fire('แจ้งเตือน', 'กรุณากรอกข้อมูลให้ครบถ้วน', 'warning');

    Swal.fire({ title: 'กำลังบันทึก...', didOpen: () => Swal.showLoading() });
    try {
        await updateDoc(doc(db, "jobs", id), {
            task: task,
            date: date,
            hours: parseFloat(hours),
            withdrawn: withdrawn
        });
        
        bootstrap.Modal.getInstance(document.getElementById('editHistoryModal')).hide();
        Swal.fire('สำเร็จ', 'แก้ไขข้อมูลประวัติงานเรียบร้อย', 'success');
        
        // รีเฟรชโปรไฟล์นักศึกษา
        document.getElementById('profileSearchKey').value = studentEmail;
        window.searchStudentProfileFB();
        // รีเฟรชตารางหน้าผู้ใช้งาน
        if (typeof window.loadUserTableFB === 'function') window.loadUserTableFB(document.getElementById('userTypeSelector').value);
        if (typeof window.loadAdminDashboardFB === 'function') window.loadAdminDashboardFB(window.user.year);
    } catch(e) { Swal.fire('ผิดพลาด', e.message, 'error'); }
};

// ลบประวัติงาน
window.adminDeleteJobFB = async function(jobId, studentEmail) {
    Swal.fire({
        title: 'ยืนยันลบประวัติงาน?',
        text: "หากลบแล้ว ชั่วโมงสะสมและยอดรวมของนักศึกษาคนนี้จะลดลง ยืนยันหรือไม่?",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'ใช่, ลบข้อมูล'
    }).then(async (result) => {
        if (result.isConfirmed) {
            Swal.fire({ title: 'กำลังลบ...', didOpen: () => Swal.showLoading() });
            try {
                await deleteDoc(doc(db, "jobs", jobId));
                Swal.fire('สำเร็จ', 'ลบประวัติงานเรียบร้อยแล้ว', 'success');
                
                // รีเฟรชโปรไฟล์นักศึกษา
                document.getElementById('profileSearchKey').value = studentEmail;
                window.searchStudentProfileFB();
                // รีเฟรชตาราง
                if (typeof window.loadUserTableFB === 'function') window.loadUserTableFB(document.getElementById('userTypeSelector').value);
                if (typeof window.loadAdminDashboardFB === 'function') window.loadAdminDashboardFB(window.user.year);
            } catch(e) { Swal.fire('ผิดพลาด', e.message, 'error'); }
        }
    });
};

// ==========================================
// ส่วนที่ 4: การเพิ่มงานย้อนหลัง (Add History)
// ==========================================
window.openAddHistoryModalFB = function() {
    document.getElementById('hist-search').value = '';
    document.getElementById('hist-task').value = '';
    document.getElementById('hist-teacher').value = '';
    document.getElementById('hist-date').value = '';
    document.getElementById('hist-start').value = '';
    document.getElementById('hist-end').value = '';
    document.getElementById('hist-hours').value = '';
    document.getElementById('hist-year').value = window.user.year || "1/2568";
    document.getElementById('hist-withdrawn').checked = false; 
    bootstrap.Modal.getOrCreateInstance(document.getElementById('addHistoryModal')).show();
};

window.calcHistHours = function() {
    let s = document.getElementById('hist-start').value;
    let e = document.getElementById('hist-end').value;
    if(s && e) {
        let sm = parseInt(s.split(':')[0])*60 + parseInt(s.split(':')[1]);
        let em = parseInt(e.split(':')[0])*60 + parseInt(e.split(':')[1]);
        if(em > sm) document.getElementById('hist-hours').value = ((em - sm) / 60).toFixed(2);
    }
};

window.confirmAddHistoryJobFB = async function() {
    const search = document.getElementById('hist-search').value.trim().toLowerCase();
    const task = document.getElementById('hist-task').value;
    const teacher = document.getElementById('hist-teacher').value;
    const date = document.getElementById('hist-date').value;
    const start = document.getElementById('hist-start').value;
    const end = document.getElementById('hist-end').value;
    const hours = document.getElementById('hist-hours').value;
    const year = document.getElementById('hist-year').value;
    const withdrawn = document.getElementById('hist-withdrawn').checked;

    if(!search || !task || !teacher || !date || !start || !end || !hours || !year) {
        return Swal.fire('ข้อมูลไม่ครบ', 'กรุณากรอกข้อมูลให้ครบถ้วน', 'warning');
    }

    Swal.fire({ title: 'กำลังตรวจสอบข้อมูล...', didOpen: () => Swal.showLoading() });
    
    let student = null; 
    let q = query(collection(db, "users"), where("role", "==", "Student"), where("email", "==", search)); 
    let snap = await getDocs(q); 
    snap.forEach(doc => student = doc.data());
    
    if(!student) { 
        q = query(collection(db, "users"), where("role", "==", "Student"), where("studentId", "==", search)); 
        snap = await getDocs(q); 
        snap.forEach(doc => student = doc.data()); 
    }
    if (!student) return Swal.fire('ไม่พบนักศึกษา', 'ไม่พบรหัสนักศึกษา หรือ อีเมลนี้ในระบบ', 'error');

    Swal.fire({ title: 'กำลังบันทึกงานย้อนหลัง...', didOpen: () => Swal.showLoading() });
    try {
        await addDoc(collection(db, "jobs"), { 
            studentEmail: student.email, 
            stuName: student.name, 
            studentId: student.studentId || '', 
            major: student.major || '', 
            phone: student.phone || '', 
            year: year, 
            date: date, 
            time: `${start} - ${end}`, 
            timeReal: `${start} - ${end}`, 
            status: "Completed", 
            jobType: "General", 
            hours: parseFloat(hours), 
            teacherName: teacher, 
            teacherEmail: "-", 
            task: task + " (ย้อนหลัง)", 
            location: "-", 
            withdrawn: withdrawn, 
            rating: 5, 
            createdAt: serverTimestamp() 
        });
        
        Swal.fire('สำเร็จ', `เพิ่มประวัติงานให้ ${student.name} เรียบร้อยแล้ว!`, 'success'); 
        bootstrap.Modal.getInstance(document.getElementById('addHistoryModal')).hide();
        
        if (typeof window.loadUserTableFB === 'function') window.loadUserTableFB(document.getElementById('userTypeSelector').value);
        if (typeof window.loadAdminDashboardFB === 'function') window.loadAdminDashboardFB(window.user.year);
    } catch(e) { Swal.fire('ผิดพลาด', e.message, 'error'); }
    };

    // ==========================================
// ส่วนเพิ่มเติม: ระบบคำนวณงบประมาณอัตโนมัติ (รอบการทำงาน)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // 1. สำหรับฟอร์ม "เพิ่ม" รอบการทำงาน
    const addMaxH = document.getElementById('cyc-maxh'); // ช่องจำนวนชั่วโมง
    const addRate = document.getElementById('cyc-rate'); // ช่องเรทราคา
    const addMaxB = document.getElementById('cyc-maxb'); // ช่องงบประมาณรวม

    const calcAddBudget = () => {
        let h = parseFloat(addMaxH.value) || 0;
        let r = parseFloat(addRate.value) || 0;
        // ถ้ามีการกรอกตัวเลข จะคูณแล้วใส่ในช่องงบประมาณทันที
        if (h > 0 || r > 0) addMaxB.value = h * r;
    };

    if (addMaxH) addMaxH.addEventListener('input', calcAddBudget);
    if (addRate) addRate.addEventListener('input', calcAddBudget);

    // 2. สำหรับฟอร์ม "แก้ไข" รอบการทำงาน
    const editMaxH = document.getElementById('edit-cyc-maxh');
    const editRate = document.getElementById('edit-cyc-rate');
    const editMaxB = document.getElementById('edit-cyc-maxb');

    const calcEditBudget = () => {
        let h = parseFloat(editMaxH.value) || 0;
        let r = parseFloat(editRate.value) || 0;
        if (h > 0 || r > 0) editMaxB.value = h * r;
    };

    if (editMaxH) editMaxH.addEventListener('input', calcEditBudget);
    if (editRate) editRate.addEventListener('input', calcEditBudget);
});
