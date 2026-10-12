const form = document.getElementById('loginForm');
const btn = document.getElementById('loginBtn');
const errorMsg = document.getElementById('errorMsg');

const EYE_ON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

const togglePass = document.getElementById('togglePass');
togglePass.innerHTML = EYE_OFF;
togglePass.addEventListener('click', () => {
  const inp = document.getElementById('password');
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  togglePass.innerHTML = show ? EYE_ON : EYE_OFF;
  inp.focus();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  btn.disabled = true;
  btn.textContent = 'جاري تسجيل الدخول...';
  errorMsg.style.display = 'none';
  try {
    const data = await API.post('/api/login', {
      username: document.getElementById('username').value.trim(),
      password: document.getElementById('password').value,
    });
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    window.location.href = '/app.html';
  } catch (err) {
    errorMsg.textContent = err.message;
    errorMsg.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'تسجيل الدخول';
  }
});
