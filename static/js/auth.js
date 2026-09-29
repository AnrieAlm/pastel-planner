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

    this.hideError();
    this.login(email, password);
  },

  // Turns Firebase's error codes into gentle, plain sentences
  friendlyError(error) {
    const messages = {
      'auth/invalid-credential': 'That email and password don\u2019t match. Try again?',
      'auth/wrong-password': 'That email and password don\u2019t match. Try again?',
      'auth/user-not-found': 'We can\u2019t find an account with that email.',
      'auth/invalid-email': 'That email doesn\u2019t look quite right \u2014 double check it.',
      'auth/email-already-in-use': 'There\u2019s already an account with that email. Try signing in instead.',
      'auth/weak-password': 'Password needs to be at least 6 characters.',
      'auth/too-many-requests': 'Lots of tries in a row. Take a breath and try again in a few minutes.',
      'auth/network-request-failed': 'Couldn\u2019t reach the internet. Check your connection and try again.',
      'auth/user-disabled': 'This account has been switched off.',
      'auth/operation-not-allowed': 'New accounts are switched off right now.'
    };
    return messages[error?.code] || 'Something went wrong. Please try again.';
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

  // Signs in or creates the account with Firebase (see js/firebase-login.js),
  // then goes to Today. The server checks the token on the next page load.
  async login(email, password) {
    const submit = document.getElementById('auth-submit');

    if (!window.calyxAuth) {
      this.showError('Still waking things up\u2026 give it a second and try again.');
      return;
    }

    submit.disabled = true;
    submit.textContent = this.isSignUp ? 'Creating account\u2026' : 'Signing in\u2026';

    try {
      if (this.isSignUp) {
        await window.calyxAuth.signUp(email, password);
      } else {
        await window.calyxAuth.signIn(email, password);
      }
      window.location.href = '/';
    } catch (error) {
      this.showError(this.friendlyError(error));
      submit.disabled = false;
      submit.textContent = this.isSignUp ? 'Create account' : 'Sign in';
    }
  }
};
