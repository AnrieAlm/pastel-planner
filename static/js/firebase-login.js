// firebase-login.js - Firebase sign-in for Calyx Planner.
// This is a "module" script: the import lines below load the Firebase tools from Google.
// It runs on EVERY page so the "token" cookie is always fresh.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  deleteUser,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

// This config is public by design (it only says WHICH Firebase project to talk to).
// The secret service-account key never goes in this file.
const firebaseConfig = {
  apiKey: "AIzaSyBC6S9WAW3_cxYWjpRCuKWqJtc3_pT1MYU",
  authDomain: "pastel-planner-6a858.firebaseapp.com",
  projectId: "pastel-planner-6a858",
  storageBucket: "pastel-planner-6a858.firebasestorage.app",
  messagingSenderId: "917808144194",
  appId: "1:917808144194:web:70908a675f8b803076f2db",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Saves the login token in a cookie so the server can read it on every page request
function setTokenCookie(token) {
  document.cookie = "token=" + token + ";path=/;SameSite=Lax;Secure";
}

// Removes the cookie (max-age=0 means "expire immediately")
function clearTokenCookie() {
  document.cookie = "token=;path=/;max-age=0;SameSite=Lax;Secure";
}

// Shows a message in the login card's message area (if this page has one)
function showLoginMessage(text) {
  const box = document.querySelector(".auth-error");
  if (!box) return;
  box.textContent = text;
  box.classList.add("visible");
}

const loginContainer = document.getElementById("auth-container");
const isLoginPage = !!loginContainer;
const loginReason = loginContainer ? loginContainer.dataset.reason : "";

// On the login page: if Firebase still remembers you, skip the form and go to Today.
// The timestamp check stops an endless loop if the server keeps refusing the token.
function goToTodayOnce() {
  const last = Number(sessionStorage.getItem("calyxAutoLoginAt") || 0);
  if (Date.now() - last < 15000) {
    showLoginMessage("We couldn't sign you in automatically. Please log in again.");
    return;
  }
  sessionStorage.setItem("calyxAutoLoginAt", String(Date.now()));
  window.location.href = "/";
}

// Firebase tokens last 1 hour. This runs at login AND every time Firebase refreshes the
// token, so the cookie never goes stale while the app is open.
onIdTokenChanged(auth, async (user) => {
  if (!user) {
    clearTokenCookie();
    return;
  }

  // The server said this account is not allowed: sign out so we do not loop
  if (isLoginPage && loginReason === "denied") {
    clearTokenCookie();
    await signOut(auth);
    showLoginMessage("This account doesn't have access to Calyx Planner yet.");
    return;
  }

  const token = await user.getIdToken();
  setTokenCookie(token);

  if (isLoginPage) {
    goToTodayOnce();
  }
});

// Small tools the other scripts (auth.js, settings.js) can call.
// Each one waits for the cookie to be saved before the page moves on.
window.calyxAuth = {
  async signIn(email, password) {
    const result = await signInWithEmailAndPassword(auth, email, password);
    setTokenCookie(await result.user.getIdToken());
  },

  async signUp(email, password) {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    setTokenCookie(await result.user.getIdToken());
  },

  // Deletes the Firebase login of whoever is signed in (Firebase may refuse if the sign-in is old)
  async deleteAccountUser() {
    if (auth.currentUser) {
      await deleteUser(auth.currentUser);
    }
    clearTokenCookie();
  },

  async signOutUser() {
    clearTokenCookie();
    await signOut(auth);
  },
};
