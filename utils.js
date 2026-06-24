// public/js/utils.js

/**
 * ป้องกันช่องโหว่ XSS (Cross-Site Scripting) และแก้ปัญหา HTML พัง
 * โดยแปลงอักขระพิเศษให้เป็น HTML Entities
 */
export function escapeHtml(text) {
    return text ? text.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;") : "";
}

/**
 * ฟังก์ชันสำหรับส่งอีเมลและการแจ้งเตือน (LINE Notify) ผ่าน Google Apps Script
 * @param {string} emailTo - อีเมลผู้รับ
 * @param {string} subject - หัวข้ออีเมล/การแจ้งเตือน
 * @param {string} message - ข้อความรายละเอียด
 */
export async function sendEmailNotify(emailTo, subject, message) {
    // เปลี่ยน URL ด้านล่างนี้หากมีการอัปเดต Google Apps Script ใหม่
    const gasURL = "https://script.google.com/macros/s/AKfycbxU3PrHjFtc3kZo3_9ThP1LbrlqRGJkEC3pYnBhx7UNFZOUocQ0SYxUgDBGcmsIXUN9tQ/exec"; 
    
    try {
        await fetch(gasURL, { 
            method: 'POST', 
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }, 
            body: JSON.stringify({ 
                to: emailTo, 
                subject: subject, 
                message: message 
            }) 
        });
        console.log("Notification sent successfully.");
    } catch (error) {
        console.error("Error sending notification:", error);
    }
}

/**
 * ฟังก์ชันคำนวณระยะเวลาการทำงาน (จากเวลาเริ่ม ถึง เวลาจบ) ออกมาเป็นชั่วโมง
 * @param {string} startTime - เวลาเริ่มต้น (เช่น "08:30")
 * @param {string} endTime - เวลาสิ้นสุด (เช่น "12:00")
 * @returns {number} จำนวนชั่วโมงที่คำนวณได้ (ทศนิยม 1 ตำแหน่ง)
 */
export function calculateHours(startTime, endTime) {
    if (!startTime || !endTime) return 0;
    
    let startParts = startTime.split(':');
    let endParts = endTime.split(':');
    
    let startMins = (parseInt(startParts[0]) * 60) + parseInt(startParts[1]);
    let endMins = (parseInt(endParts[0]) * 60) + parseInt(endParts[1]);
    
    let diffMins = endMins - startMins;
    
    if (diffMins > 0) {
        return parseFloat((diffMins / 60).toFixed(1));
    }
    return 0;
}