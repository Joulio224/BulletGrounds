// ---------------------------------------------------------------------------
// Groupes : créer un groupe, inviter des amis (demande à accepter), quitter
// ---------------------------------------------------------------------------
// groups/{groupId} { name, ownerId, members: [uid...], memberPseudos: {uid: pseudo},
//                     mode: 'solo'|'team', memberTeams: {uid: 'red'|'blue'|'yellow'|'green'}, createdAt }
//                     bots: { [botId]: { name, level: 'easy'|'normal'|'strong'|'insane' } }  (voir plus bas)
// groupInvites/{inviteId} { groupId, groupName, fromUid, fromPseudo, toUid, toPseudo, status, createdAt }
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
  deleteField,
} from 'firebase/firestore';
import { db } from './firebase.js';

export async function createGroup(name, ownerUid, ownerPseudo) {
  const cleanName = name.trim();
  if (cleanName.length < 2) {
    throw new Error('Le nom du groupe doit faire au moins 2 caractères.');
  }
  const ref = doc(collection(db, 'groups'));
  await setDoc(ref, {
    name: cleanName,
    ownerId: ownerUid,
    members: [ownerUid],
    memberPseudos: { [ownerUid]: ownerPseudo },
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

// callback([{ id, name, ownerId, members, memberPseudos, createdAt }])
export function listenMyGroups(myUid, callback) {
  const q = query(collection(db, 'groups'), where('members', 'array-contains', myUid));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

async function addMemberToGroup(groupId, memberUid, memberPseudo) {
  await updateDoc(doc(db, 'groups', groupId), {
    members: arrayUnion(memberUid),
    [`memberPseudos.${memberUid}`]: memberPseudo,
  });
}

export async function leaveGroup(groupId, myUid) {
  await updateDoc(doc(db, 'groups', groupId), {
    members: arrayRemove(myUid),
  });
}

export async function deleteGroup(groupId) {
  await deleteDoc(doc(db, 'groups', groupId));
}

// ---------------------------------------------------------------------------
// Mode de jeu du groupe : "solo" (par défaut, comportement inchangé — chacun
// peut tirer sur tout le monde) ou "team" (les coéquipiers ne peuvent pas se
// tuer entre eux, voir server.js). Seul le créateur du groupe (ownerId) doit
// pouvoir changer ça — c'est fait respecter côté UI (lobby.js n'affiche les
// contrôles qu'au créateur), PAS par les règles Firestore : comme le reste de
// ce fichier ("entre potes de confiance"), un membre qui bidouille la
// console pourrait techniquement l'appeler lui-même. Pas un souci pour ce
// projet, mais à savoir si un jour tu veux durcir ça.
// ---------------------------------------------------------------------------
export async function setGroupMode(groupId, mode) {
  await updateDoc(doc(db, 'groups', groupId), { mode: mode === 'team' ? 'team' : 'solo' });
}

// Assigne (ou réassigne) un membre à l'une des quatre équipes. Active aussi
// mode:'team' dans le même appel — avant, les deux étaient séparés (bouton
// Mode + pastille par membre), et un groupe pouvait se retrouver à moitié
// configuré : des couleurs choisies mais le mode resté sur "Solo". Dans cet
// état, TOUT LE MONDE repartait en solo (voir lobby.js, teamOf), ce qui a
// fini par le même symptôme qu'un vieux bug côté serveur (tout le monde
// atterrissait dans l'équipe rouge — voir le commentaire au-dessus de
// assignTeam() dans server.js). Assigner une couleur n'a de sens QUE si le
// mode Équipes est actif, donc autant garantir que les deux vont toujours
// ensemble plutôt que de compter sur deux clics distincts dans le bon ordre.
export async function setGroupAdmin(groupId, uid, revoke = false) {
  await updateDoc(doc(db, 'groups', groupId), { adminId: revoke ? deleteField() : uid });
}

// Retire un membre du groupe et nettoie ses données associées.
export async function removeMemberFromGroup(groupId, uid) {
  await updateDoc(doc(db, 'groups', groupId), {
    members: arrayRemove(uid),
    [`memberPseudos.${uid}`]: deleteField(),
    [`memberTeams.${uid}`]: deleteField(),
    ...(uid ? {} : {}),
  });
}

export async function setMemberTeam(groupId, uid, team) {
  if (!['red', 'blue', 'yellow', 'green'].includes(team)) return;
  await updateDoc(doc(db, 'groups', groupId), {
    mode: 'team',
    [`memberTeams.${uid}`]: team,
  });
}

// --- Invitations -------------------------------------------------------------
// Même logique que les demandes d'ami : on ne rejoint plus un groupe direct,
// quelqu'un doit accepter une invitation d'abord.

function inviteDocId(groupId, toUid) {
  return `${groupId}_${toUid}`;
}

export async function sendGroupInvite(groupId, groupName, fromUid, fromPseudo, toUid, toPseudo) {
  if (fromUid === toUid) throw new Error("Tu ne peux pas t'inviter toi-même.");
  await setDoc(doc(db, 'groupInvites', inviteDocId(groupId, toUid)), {
    groupId,
    groupName,
    fromUid,
    fromPseudo,
    toUid,
    toPseudo,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
}

// callback([{ id, groupId, groupName, fromUid, fromPseudo, toUid, toPseudo, status, createdAt }])
export function listenIncomingGroupInvites(myUid, callback) {
  const q = query(
    collection(db, 'groupInvites'),
    where('toUid', '==', myUid),
    where('status', '==', 'pending')
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export async function acceptGroupInvite(invite) {
  await addMemberToGroup(invite.groupId, invite.toUid, invite.toPseudo);
  await deleteDoc(doc(db, 'groupInvites', invite.id));
}

export async function declineGroupInvite(inviteId) {
  await deleteDoc(doc(db, 'groupInvites', inviteId));
}

// --- Invitations envoyées -----------------------------------------------------
// Annuler une invitation = supprimer son document (le destinataire ne la voit plus).
// Les règles autorisent l'émetteur, le destinataire et le créateur / l'admin du groupe.
export async function cancelGroupInvite(inviteId) {
  await deleteDoc(doc(db, 'groupInvites', inviteId));
}

// Invitations que TOI tu as envoyées (tous groupes) : sert à ne pas réinviter quelqu'un
// déjà invité, dans la fenêtre « Ajouter ».
export function listenMySentGroupInvites(myUid, callback) {
  const q = query(collection(db, 'groupInvites'), where('fromUid', '==', myUid));
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => callback([])
  );
}

// Toutes les invitations en attente d'UN groupe (celles du créateur ET des admins), pour les
// paramètres du groupe. Si les règles Firestore pas encore mises à jour refusent cette requête,
// on retombe sur les seules invitations envoyées par toi.
export function listenGroupInvites(groupId, myUid, callback) {
  let fallbackUnsub = null;
  const unsub = onSnapshot(
    query(collection(db, 'groupInvites'), where('groupId', '==', groupId)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => {
      fallbackUnsub = onSnapshot(
        query(collection(db, 'groupInvites'), where('fromUid', '==', myUid)),
        (snap) =>
          callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((i) => i.groupId === groupId)),
        () => callback([])
      );
    }
  );
  return () => {
    unsub();
    fallbackUnsub?.();
  };
}

// --- Bots ---------------------------------------------------------------------
// Un bot est stocké dans groups/{id}.bots.{botId} = { name, level }. Il n'est PAS dans `members`
// (ce sont des comptes) mais, en mode Équipes, il a une équipe comme les autres :
// memberTeams.{botId}. C'est le serveur de jeu (bots.js) qui le fait jouer.
// Seuls le créateur et l'admin du groupe peuvent les gérer (règles Firestore).
export const BOT_LEVELS = [
  { id: 'easy', label: 'Facile', hint: 'Lent, vise mal, réagit tard' },
  { id: 'normal', label: 'Normal', hint: 'Un adversaire correct' },
  { id: 'strong', label: 'Fort', hint: 'Rapide, précis, bouclier' },
  { id: 'insane', label: 'Très fort', hint: 'Redoutable : réflexes, précision, gros stuff' },
];
export const MAX_BOTS_PER_GROUP = 8;
const BOT_NAMES = ['Rex', 'Nova', 'Zed', 'Blitz', 'Echo', 'Viper', 'Onyx', 'Titan', 'Ghost', 'Raven', 'Pixel', 'Storm', 'Jinx', 'Cobra', 'Bolt', 'Lynx'];
const TEAM_IDS = ['red', 'blue', 'yellow', 'green'];
const BOT_COLORS = { easy: '#5f8a4a', normal: '#4f86c6', strong: '#c8641e', insane: '#8a2f2f' };

export function botLevelLabel(level) {
  return BOT_LEVELS.find((l) => l.id === level)?.label || 'Normal';
}

// Skin affiché dans le lobby (même couleur que celui que le serveur donne au bot en jeu).
export function botAppearance(level) {
  const color = BOT_COLORS[level] || BOT_COLORS.normal;
  return {
    topColor: color, bodyColor: color, bottomColor: '#1c1d20', skin: '#b8bcc2',
    hair: 'rase', hairColor: '#1d1f22', headgear: 'casque', headgearColor: '#3b3f46',
  };
}

export function listGroupBots(group) {
  return Object.entries(group?.bots || {})
    .map(([key, cfg]) => ({ key, name: cfg?.name || 'Bot', level: cfg?.level || 'normal' }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export async function addBotToGroup(group, level) {
  if (!BOT_LEVELS.some((l) => l.id === level)) throw new Error('Niveau de bot invalide.');
  const bots = listGroupBots(group);
  if (bots.length >= MAX_BOTS_PER_GROUP) {
    throw new Error(`Maximum ${MAX_BOTS_PER_GROUP} bots par groupe.`);
  }
  const key = `bot_${Math.random().toString(36).slice(2, 8)}`;
  const used = new Set(bots.map((b) => b.name));
  const free = BOT_NAMES.filter((n) => !used.has(n));
  const pool = free.length ? free : BOT_NAMES;
  const name = pool[Math.floor(Math.random() * pool.length)];

  const update = { [`bots.${key}`]: { name, level } };
  if (group.mode === 'team') {
    // Mode Équipes : le bot rejoint l'équipe la moins remplie (modifiable ensuite via son rond)
    const counts = Object.fromEntries(TEAM_IDS.map((t) => [t, 0]));
    Object.values(group.memberTeams || {}).forEach((t) => {
      if (t in counts) counts[t] += 1;
    });
    update[`memberTeams.${key}`] = TEAM_IDS.reduce((least, t) => (counts[t] < counts[least] ? t : least), TEAM_IDS[0]);
  }
  await updateDoc(doc(db, 'groups', group.id), update);
  return key;
}

export async function setBotLevel(groupId, botKey, level) {
  if (!BOT_LEVELS.some((l) => l.id === level)) return;
  await updateDoc(doc(db, 'groups', groupId), { [`bots.${botKey}.level`]: level });
}

export async function removeBotFromGroup(groupId, botKey) {
  await updateDoc(doc(db, 'groups', groupId), {
    [`bots.${botKey}`]: deleteField(),
    [`memberTeams.${botKey}`]: deleteField(),
  });
}
