import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
    apiKey: "AIzaSyB4AMaQ2cAEj8zVkLpIOSIiW9CV_wzP7BQ",
    authDomain: "bkk-apple-tradein.firebaseapp.com",
    databaseURL: "https://bkk-apple-tradein-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "bkk-apple-tradein",
    storageBucket: "bkk-apple-tradein.firebasestorage.app",
    messagingSenderId: "786220636196",
    appId: "1:786220636196:web:91c95c2f9265d5f66ba0b1"
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);
export const storage = getStorage(app);