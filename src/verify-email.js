// ---------------------------------------------------------------------------
// Écran « Saisis le code reçu par mail » (étape 2 de l'inscription)
// ---------------------------------------------------------------------------
// Affiché par lobby.js APRÈS que le serveur a envoyé le code, et AVANT la création du compte :
// tant que le bon code n'est pas saisi, aucun compte n'existe. Voir auth.js (requestSignupCode /
// createVerifiedAccount) et signup-verification.js côté serveur.
const RESEND_SECONDS = 60;
let root = null;
let countdownTimer = null;

function injectStyle() {
  if (document.getElementById('verify-style')) return;
  const style = document.createElement('style');
  style.id = 'verify-style';
  style.textContent = `
    #verify-screen {
      position: fixed; inset: 0; z-index: 2000; display: flex; align-items: center; justify-content: center;
      background: rgba(8, 10, 16, 0.92); padding: 16px; box-sizing: border-box; color: #eee; font: 15px/1.5 system-ui, sans-serif;
    }
    #verify-screen .vf-box {
      width: min(380px, 100%); box-sizing: border-box; padding: 24px; border-radius: 14px;
      background: #1b1b22; border: 1px solid #333; text-align: center;
    }
    #verify-screen h2 { margin: 0 0 8px; font-size: 1.3rem; }
    #verify-screen p { margin: 0 0 14px; color: #bbb; font-size: 0.9rem; }
    #verify-screen strong { color: #fff; word-break: break-all; }
    #verify-screen input {
      width: 100%; box-sizing: border-box; padding: 12px; font-size: 1.6rem; letter-spacing: 0.5em;
      text-align: center; border-radius: 8px; border: 1px solid #444; background: #101015; color: #fff;
    }
    #verify-screen .vf-row { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
    #verify-screen .vf-msg { min-height: 1.2em; margin: 10px 0 0; font-size: 0.85rem; }
    #verify-screen .vf-msg.err { color: #ff8f8f; }
    #verify-screen .vf-msg.ok { color: #8fe3a0; }
    #verify-screen .vf-link { background: none; border: none; color: #8aa4ff; cursor: pointer; font-size: 0.85rem; padding: 4px; }
    #verify-screen .vf-link:disabled { color: #777; cursor: default; }
  `;
  document.head.appendChild(style);
}

export function hideVerifyScreen() {
  clearInterval(countdownTimer);
  countdownTimer = null;
  root?.remove();
  root = null;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// options : { email, onSubmit(code), onResend() }
//   onSubmit : crée le compte avec ce code (rejette avec un message si le code est refusé)
//   onResend : redemande un code au serveur
// « Modifier mon inscription » referme l'écran : rien n'a été créé, le formulaire est intact.
export function showSignupCodeScreen({ email, onSubmit, onResend }) {
  injectStyle();
  hideVerifyScreen();
  root = el('div');
  root.id = 'verify-screen';
  const box = el('div', 'vf-box');
  root.appendChild(box);
  document.body.appendChild(root);

  box.appendChild(el('h2', '', 'Vérifie ton adresse e-mail'));
  const intro = el('p');
  const strong = el('strong');
  strong.textContent = email;
  intro.append('Un code à 6 chiffres vient d’être envoyé à ', strong, '. Ton compte sera créé quand tu l’auras saisi. Regarde aussi dans les courriers indésirables.');
  box.appendChild(intro);

  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.autocomplete = 'one-time-code';
  input.maxLength = 6;
  input.placeholder = '••••••';
  input.setAttribute('aria-label', 'Code de vérification');
  box.appendChild(input);

  const msg = el('p', 'vf-msg');
  const setMsg = (text, kind = '') => {
    msg.textContent = text;
    msg.className = `vf-msg ${kind}`;
  };
  box.appendChild(msg);

  const submit = el('button', '', 'Créer mon compte');
  submit.type = 'button';
  submit.disabled = true;
  const resend = el('button', 'vf-link', 'Renvoyer le code');
  resend.type = 'button';
  const back = el('button', 'vf-link', 'Modifier mon inscription');
  back.type = 'button';
  const row = el('div', 'vf-row');
  row.append(submit, resend, back);
  box.appendChild(row);

  function startCountdown(seconds = RESEND_SECONDS) {
    clearInterval(countdownTimer);
    let left = seconds;
    resend.disabled = true;
    const tick = () => {
      if (left <= 0) {
        clearInterval(countdownTimer);
        resend.disabled = false;
        resend.textContent = 'Renvoyer le code';
        return;
      }
      resend.textContent = `Renvoyer le code (${left} s)`;
      left -= 1;
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, 6);
    submit.disabled = input.value.length !== 6;
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !submit.disabled) submit.click();
  });
  submit.addEventListener('click', async () => {
    submit.disabled = true;
    setMsg('Création du compte…');
    try {
      await onSubmit(input.value);
      hideVerifyScreen(); // la connexion qui suit ouvre le lobby (lobby.js, onAuthChange)
    } catch (error) {
      setMsg(error.message || 'Impossible de créer le compte.', 'err');
      input.select();
      submit.disabled = input.value.length !== 6;
    }
  });
  resend.addEventListener('click', async () => {
    resend.disabled = true;
    try {
      await onResend();
      setMsg('Nouveau code envoyé.', 'ok');
      startCountdown();
    } catch (error) {
      setMsg(error.message, 'err');
      resend.disabled = false;
    }
  });
  back.addEventListener('click', hideVerifyScreen);

  startCountdown();
  input.focus();
}
