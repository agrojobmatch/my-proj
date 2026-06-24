// public/js/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, setPersistence, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = { 
  apiKey: "AIzaSyDxRcx_d09cNlob2RjAo1JRMV9xM6BwBPw", 
  authDomain: "agro-job-math.firebaseapp.com", 
  projectId: "agro-job-math", 
  storageBucket: "agro-job-math.firebasestorage.app", 
  messagingSenderId: "707029220907", 
  appId: "1:707029220907:web:ff3eb9c6732a89363c746e" 
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ตั้งค่าให้จำการล็อกอินแค่ใน Session
setPersistence(auth, browserSessionPersistence).catch((error) => { 
  console.error("Auth Persistence Error:", error); 
});

export { app, auth, db };