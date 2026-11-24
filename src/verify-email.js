// ---------------------------------------------------------------------------
// Écran « Vérifie ton adresse e-mail » (code à 6 chiffres reçu par mail)
// ---------------------------------------------------------------------------
// Affiché par lobby.js tant que le serveur dit que le compte n'est pas vérifié. Il recouvre
// l'écran de connexion et le lobby. Voir auth.js (appels serveur) et email-verification.js
// côté serveur (génération, envoi, limites d'essais).
import { requestVerificationCode, submitVerificationCode, cancelUnverifiedSignup } from './auth.js';

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
      background: #0f1015; padding: 16px; box-sizing: border-box; color: #eee; font: 15px/1.5 system-ui, sans-serif;
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

// options : { user, onVerified, onSignOut, statusError?, onRetry? }
//   statusError : le serveur n'a pas pu dire si le compte est vérifié -> écran d'erreur avec « Réessayer »
export function showVerifyScreen({ user, onVerified, onSignOut, statusError = null, onRetry = null }) {
  injectStyle();
  hideVerifyScreen();
  root = el('div');
  root.id = 'verify-screen';
  const box = el('div', 'vf-box');
  root.appendChild(box);
  document.body.appendChild(root);

  const msg = el('p', 'vf-msg');
  const setMsg = (text, kind = '') => {
    msg.textContent = text;
    msg.className = `vf-msg ${kind}`;
  };
  const signOutButton = el('button', 'vf-link', 'Se déconnecter');
  signOutButton.type = 'button';
  signOutButton.addEventListener('click', () => {
    hideVerifyScreen();
    onSignOut?.();
  });

  if (statusError) {
    box.append(el('h2', '', 'Connexion au serveur impossible'), el('p', '', statusError), msg);
    const row = el('div', 'vf-row');
    const retry = el('button', '', 'Réessayer');
    retry.type = 'button';
    retry.addEventListener('click', () => {
      hideVerifyScreen();
      onRetry?.();
    });
    row.append(retry, signOutButton);
    box.appendChild(row);
    return;
  }

  box.append(el('h2', '', 'Vérifie ton adresse e-mail'));
  const intro = el('p');
  intro.append('Un code à 6 chiffres a été envoyé à ', Object.assign(el('strong'), { textContent: user.email || 'ton adresse' }), '. Regarde aussi dans les courriers indésirables.');
  box.appendChild(intro);

  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.autocomplete = 'one-time-code';
  input.maxLength = 6;
  input.placeholder = '••••••';
  input.setAttribute('aria-label', 'Code de vérification');
  box.appendChild(input);
  box.appendChild(msg);

  const submit = el('button', '', 'Valider');
  submit.type = 'button';
  submit.disabled = true;
  const resend = el('button', 'vf-link', 'Renvoyer le code');
  resend.type = 'button';
  const wrongAddress = el('button', 'vf-link', 'Mauvaise adresse ? Recommencer l’inscription');
  wrongAddress.type = 'button';
  const row = el('div', 'vf-row');
  row.append(submit, resend, wrongAddress, signOutButton);
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

  async function sendCode({ automatic = false } = {}) {
    resend.disabled = true;
    try {
      await requestVerificationCode();
      setMsg('Code envoyé.', 'ok');
      startCountdown();
    } catch (error) {
      if (automatic && error.status === 429) {
        // Un code vient déjà d'être envoyé (reconnexion rapide) : rien d'inquiétant
        setMsg('Un code t’a déjà été envoyé récemment.', 'ok');
        startCountdown(30);
      } else {
        setMsg(error.message, 'err');
        resend.disabled = false;
      }
    }
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
    setMsg('Vérification…');
    try {
      await submitVerificationCode(input.value);
      hideVerifyScreen();
      onVerified?.();
    } catch (error) {
      setMsg(error.message, 'err');
      input.select();
      submit.disabled = input.value.length !== 6;
    }
  });
  resend.addEventListener('click', () => sendCode());
  wrongAddress.addEventListener('click', async () => {
    if (!window.confirm('Supprimer ce compte non vérifié pour recommencer avec la bonne adresse ?')) return;
    wrongAddress.disabled = true;
    try {
      await cancelUnverifiedSignup(); // déconnecte aussi : lobby.js revient à l'écran de connexion
      hideVerifyScreen();
    } catch (error) {
      setMsg(error.message, 'err');
      wrongAddress.disabled = false;
    }
  });

  input.focus();
  sendCode({ automatic: true });
}
