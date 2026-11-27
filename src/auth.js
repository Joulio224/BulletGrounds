// ---------------------------------------------------------------------------
// Comptes joueurs (Firebase Auth par email/mot de passe + doc Firestore)
// ---------------------------------------------------------------------------
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebase.js';

// callback(user | null) — appelé immédiatement puis à chaque changement d'état
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

// Inscription en deux temps (le compte n'existe PAS avant la saisie du bon code reçu par mail) :
//   1. checkSignupForm + requestSignupCode : vérifie le formulaire puis demande au serveur
//      d'envoyer un code à l'adresse. Rien n'est créé nulle part.
//   2. createVerifiedAccount : envoie le code ; si le serveur l'accepte (usage unique), il crée
//      le compte et le profil, puis on se connecte normalement.
// Tout est géré par mini-warzone-server (voir signup-verification.js).
export function checkSignupForm(email, password, pseudo) {
  const cleanPseudo = String(pseudo || '').trim();
  if (cleanPseudo.length < 3) throw new Error('Le pseudo doit faire au moins 3 caractères.');
  if (cleanPseudo.length > 20) throw new Error('Le pseudo doit faire moins de 20 caractères.');
  if (!String(email || '').trim()) throw new Error('Adresse e-mail requise.');
  if (String(password || '').length < 6) throw new Error('Mot de passe trop court (6 caractères minimum).');
}

export function requestSignupCode(email) {
  return postJson('/auth/signup/request-code', { email: String(email).trim() });
}

export async function createVerifiedAccount({ email, password, pseudo, code }) {
  await postJson('/auth/signup/confirm', {
    email: String(email).trim(),
    password,
    pseudo: String(pseudo).trim(),
    code: String(code).trim(),
  });
  return signIn(String(email).trim(), password); // le compte existe : connexion normale
}

export async function signIn(email, password) {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  await setDoc(doc(db, 'users', credential.user.uid), {
    lastSeenAt: serverTimestamp(),
  }, { merge: true });
  return credential.user;
}

export async function deleteAccountUser(password) {
  const user = auth.currentUser;
  if (!user) throw new Error('Aucun compte connecté.');
  if (!user.email) throw new Error('Ce compte ne possède pas d’adresse email compatible avec cette confirmation.');

  try {
    const credential = EmailAuthProvider.credential(user.email, password);
    await reauthenticateWithCredential(user, credential);
  } catch (error) {
    if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
      throw new Error('Mot de passe incorrect.');
    }
    if (error.code === 'auth/too-many-requests') {
      throw new Error('Trop de tentatives. Réessaie plus tard.');
    }
    throw error;
  }

  const serverUrl = import.meta.env.VITE_REALTIME_SERVER_URL || 'http://localhost:3001';
  const token = await user.getIdToken(true);
  const response = await fetch(`${serverUrl.replace(/\/$/, '')}/account/delete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  let result = {};
  try { result = await response.json(); } catch {}
  if (!response.ok || result.success !== true) {
    throw new Error(result.error || 'Impossible de supprimer le compte.');
  }

  // Nettoyage des préférences locales associées à cette installation.
  for (const key of ['mw_appearance', 'mw_keybinds', 'mw_settings', `mw_chat_read_${user.uid}`]) {
    localStorage.removeItem(key);
  }

  await signOut(auth);
}

export async function signOutUser() {
  await signOut(auth);
}

// Traduit les codes d'erreur Firebase en messages compréhensibles pour un lycéen
export function friendlyAuthError(error) {
  const map = {
    'auth/email-already-in-use': 'Ce compte existe déjà — connecte-toi plutôt.',
    'auth/invalid-email': 'Adresse email invalide.',
    'auth/weak-password': 'Mot de passe trop court (6 caractères minimum).',
    'auth/invalid-credential': 'Email ou mot de passe incorrect.',
    'auth/wrong-password': 'Email ou mot de passe incorrect.',
    'auth/user-not-found': 'Aucun compte avec cet email.',
    'auth/too-many-requests': 'Trop de tentatives — réessaie dans un moment.',
  };
  return map[error.code] || error.message;
}

// --- Appels au serveur de jeu (inscription) ------------------------------------------
function serverBase() {
  return (import.meta.env.VITE_REALTIME_SERVER_URL || 'http://localhost:3001').replace(/\/$/, '');
}

async function postJson(path, body) {
  let response;
  try {
    response = await fetch(`${serverBase()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Serveur injoignable. Vérifie ta connexion puis réessaie.');
  }
  let data = {};
  try { data = await response.json(); } catch { /* corps vide */ }
  if (!response.ok) {
    const error = new Error(data.error || 'Erreur du serveur.');
    error.status = response.status;
    throw error;
  }
  return data;
}
