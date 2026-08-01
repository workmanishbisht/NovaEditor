/* ==========================================
   Imports
========================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

/* ==========================================
   Config
========================================== */

const firebaseConfig = Object.freeze({
  apiKey: "AIzaSyDH1kD1Mlr7mkv_zMjlQ-FnxWzUx3w7lpQ",
  authDomain: "novaeditor-40d4f.firebaseapp.com",
  projectId: "novaeditor-40d4f",
  storageBucket: "novaeditor-40d4f.firebasestorage.app",
  messagingSenderId: "975807774799",
  appId: "1:975807774799:web:1369d8713b044419f9ea3a",
});

/* ==========================================
   Initialization
========================================== */

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);

const db = getFirestore(app);

const storage = getStorage(app);

/* ==========================================
   Exports
========================================== */

export { app, auth, db, storage };
