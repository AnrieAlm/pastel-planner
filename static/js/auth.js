/**
 * Calyx Planner — Auth Screen
 */
const Auth = {
  isSignUp: false,

  init() {
    const form = document.getElementById('auth-form');
    const toggle = document.getElementById('auth-toggle-link');
    const submit = document.getElementById('auth-submit');

    if (!form) return;

    toggle?.addEventListener('click', (e) => {
      e.preventDefault();
      this.isSignUp = !this.isSignUp;
      submit.textContent = this.isSignUp ? 'Create account' : 'Sign in';
      toggle.textContent = this.isSignUp ? 'Sign in' : 'Create account';
      this.hideError();
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.attemptLogin();
    });
  },

  attemptLogin() {
    const email = document.getElementById('auth-email')?.value.trim();
    const password = document.getElementById('auth-password')?.value;

    if (!email || !password) {
      this.showError('Enter both your email and password to continue.');
      return;
    }
    if (!email.includes('@')) {
      this.showError('That email doesn\'t look quite right — double check it.');
      return;
    }
    if (password.length < 6) {
      this.showError('Password needs to be at least 6 characters.');
      return;
    }

    // Real auth (Firebase) plugs in here later — for now, this is the
    // mock-data version, so any valid-looking input logs you in.
    this.hideError();
    this.login();
  },

  showError(message) {
    let errorEl = document.querySelector('.auth-error');
    if (!errorEl) {
      // fall back gracefully if the markup hasn't been updated yet
      alert(message);
      return;
    }
    errorEl.textContent = message;
    errorEl.classList.add('visible');
    errorEl.setAttribute('role', 'alert');
  },

  hideError() {
    const errorEl = document.querySelector('.auth-error');
    errorEl?.classList.remove('visible');
  },

  login() {
    // Stage 2 replaces this with Firebase sign-in
    window.location.href = '/';
  }
};