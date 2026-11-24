// ---------------------------------------------------------------------------
// Bouton « + » du groupe : ajouter un bot ou inviter des joueurs
// ---------------------------------------------------------------------------
// Le rond « + » se place à côté des ronds des membres (voir lobby.js). Au clic, une fenêtre
// propose « Bot » ou « Joueur » :
//   Bot    → choix du niveau (facile / normal / fort / très fort) → le bot est ajouté au groupe
//            (réservé au créateur et à l'admin du groupe).
//   Joueur → on coche un ou plusieurs amis, puis « Ajouter » leur envoie une invitation à
//            rejoindre le groupe. Les invitations en attente se voient (et s'annulent) dans les
//            paramètres du groupe (voir group-settings.js).
import {
  BOT_LEVELS,
  MAX_BOTS_PER_GROUP,
  addBotToGroup,
  listGroupBots,
  sendGroupInvite,
} from './groups.js';

let styleInjected = false;
function injectStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .member-add-circle {
      width: 44px; height: 44px; padding: 0; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 1.6rem; line-height: 1; font-weight: 300;
      background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.85);
      border: 2px dashed rgba(255,255,255,0.35); cursor: pointer;
    }
    .member-add-circle:hover { background: rgba(255,255,255,0.14); border-color: #fff; }
    .member-bot-label { font-size: 0.55rem; letter-spacing: 0.06em; color: #7fd1ff; font-weight: 800; }
    .bot-level-picker { display: flex; gap: 3px; }
    .bot-level-btn {
      padding: 3px 6px; font-size: 0.65rem; border-radius: 6px;
      background: rgba(255,255,255,0.08); color: #fff; border: 1px solid transparent; cursor: pointer;
    }
    .bot-level-btn.selected { background: #e63946; }
    #ga-backdrop {
      position: fixed; inset: 0; z-index: 1600; display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.6); padding: 16px; box-sizing: border-box;
    }
    #ga-modal {
      width: min(400px, 100%); max-height: 90vh; overflow: auto; box-sizing: border-box;
      background: #1b1b22; color: #eee; border: 1px solid #333; border-radius: 12px; padding: 20px;
      font: 15px/1.5 system-ui, sans-serif; text-align: left;
    }
    #ga-modal h3 { margin: 0 0 4px; font-size: 1.15rem; }
    #ga-modal .ga-sub { margin: 0 0 14px; color: #aaa; font-size: 0.85rem; }
    #ga-modal .ga-choices { display: grid; gap: 8px; }
    #ga-modal .ga-choice {
      display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left;
      padding: 12px 14px; border-radius: 10px; cursor: pointer;
      background: rgba(255,255,255,0.07); color: #fff; border: 1px solid rgba(255,255,255,0.15);
    }
    #ga-modal .ga-choice:hover:not(:disabled) { background: rgba(255,255,255,0.14); }
    #ga-modal .ga-choice:disabled { opacity: 0.45; cursor: not-allowed; }
    #ga-modal .ga-choice small { color: #aaa; font-size: 0.78rem; }
    #ga-modal .ga-list { display: grid; gap: 6px; margin: 0 0 4px; padding: 0; list-style: none; }
    #ga-modal .ga-list label {
      display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px;
      background: rgba(255,255,255,0.06); cursor: pointer;
    }
    #ga-modal .ga-list input { width: 18px; height: 18px; }
    #ga-modal .ga-empty { color: #aaa; font-size: 0.85rem; margin: 6px 0; }
    #ga-modal .ga-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
    #ga-modal .ga-error { color: #ff8f8f; font-size: 0.85rem; min-height: 1em; margin: 8px 0 0; }
  `;
  document.head.appendChild(style);
}

let backdropEl = null;
function closeModal() {
  backdropEl?.remove();
  backdropEl = null;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function openModal() {
  injectStyle();
  closeModal();
  backdropEl = el('div');
  backdropEl.id = 'ga-backdrop';
  const modal = el('div');
  modal.id = 'ga-modal';
  backdropEl.appendChild(modal);
  backdropEl.addEventListener('click', (event) => {
    if (event.target === backdropEl) closeModal();
  });
  document.body.appendChild(backdropEl);
  return modal;
}

// getContext() est relu à chaque étape : amis / invitations / groupe peuvent changer pendant
// que la fenêtre est ouverte.
//   getContext() → { group, canManage, friends: [{uid, pseudo}], pendingInviteUids: Set, me: {uid, pseudo} }
function showChoice(modal, getContext) {
  const { group, canManage } = getContext();
  modal.innerHTML = '';
  modal.appendChild(el('h3', '', 'Ajouter au groupe'));
  modal.appendChild(el('p', 'ga-sub', `Groupe « ${group.name} »`));

  const choices = el('div', 'ga-choices');
  const botCount = listGroupBots(group).length;
  const botFull = botCount >= MAX_BOTS_PER_GROUP;

  const botButton = el('button', 'ga-choice');
  botButton.type = 'button';
  botButton.append(
    el('strong', '', '🤖 Bot'),
    el(
      'small',
      '',
      !canManage
        ? 'Réservé au créateur et à l’admin du groupe'
        : botFull
          ? `Maximum ${MAX_BOTS_PER_GROUP} bots atteint`
          : 'Un adversaire contrôlé par le jeu, au niveau de ton choix'
    )
  );
  botButton.disabled = !canManage || botFull;
  botButton.addEventListener('click', () => showBotLevels(modal, getContext));

  const playerButton = el('button', 'ga-choice');
  playerButton.type = 'button';
  playerButton.append(el('strong', '', '👤 Joueur'), el('small', '', 'Envoie une demande pour rejoindre le groupe'));
  playerButton.addEventListener('click', () => showPlayers(modal, getContext));

  choices.append(botButton, playerButton);
  modal.appendChild(choices);

  const actions = el('div', 'ga-actions');
  const cancel = el('button', 'secondary', 'Fermer');
  cancel.type = 'button';
  cancel.addEventListener('click', closeModal);
  actions.appendChild(cancel);
  modal.appendChild(actions);
}

function showBotLevels(modal, getContext) {
  const { group } = getContext();
  modal.innerHTML = '';
  modal.appendChild(el('h3', '', 'Niveau du bot'));
  modal.appendChild(el('p', 'ga-sub', 'Choisis sa difficulté. Tu pourras la changer ensuite.'));
  const errorEl = el('p', 'ga-error');

  const choices = el('div', 'ga-choices');
  BOT_LEVELS.forEach((level) => {
    const button = el('button', 'ga-choice');
    button.type = 'button';
    button.append(el('strong', '', level.label), el('small', '', level.hint));
    button.addEventListener('click', async () => {
      choices.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      try {
        // On relit le groupe au moment du clic (mode / équipes / nombre de bots à jour)
        await addBotToGroup(getContext().group, level.id);
        closeModal();
      } catch (error) {
        errorEl.textContent = error.message || 'Impossible d’ajouter le bot.';
        choices.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      }
    });
    choices.appendChild(button);
  });
  modal.append(choices, errorEl);

  const actions = el('div', 'ga-actions');
  const back = el('button', 'secondary', 'Retour');
  back.type = 'button';
  back.addEventListener('click', () => showChoice(modal, getContext));
  actions.appendChild(back);
  modal.appendChild(actions);
  void group;
}

function showPlayers(modal, getContext) {
  const { group, friends, pendingInviteUids } = getContext();
  modal.innerHTML = '';
  modal.appendChild(el('h3', '', 'Inviter des joueurs'));
  modal.appendChild(el('p', 'ga-sub', 'Coche un ou plusieurs amis, puis clique sur Ajouter.'));
  const errorEl = el('p', 'ga-error');

  const available = friends.filter((f) => !group.members.includes(f.uid));
  const list = el('ul', 'ga-list');
  const checked = new Set();
  const addButton = el('button', '', 'Ajouter');
  addButton.type = 'button';
  addButton.disabled = true;

  if (available.length === 0) {
    modal.appendChild(el('p', 'ga-empty', 'Aucun ami à inviter : ils sont tous déjà dans le groupe.'));
  } else {
    available.forEach((friend) => {
      const li = el('li');
      const label = el('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      const already = pendingInviteUids.has(friend.uid);
      box.disabled = already;
      const name = el('span', '', already ? `${friend.pseudo} — déjà invité` : friend.pseudo);
      if (already) name.style.opacity = '0.6';
      box.addEventListener('change', () => {
        if (box.checked) checked.add(friend.uid);
        else checked.delete(friend.uid);
        addButton.disabled = checked.size === 0;
        addButton.textContent = checked.size > 1 ? `Ajouter (${checked.size})` : 'Ajouter';
      });
      label.append(box, name);
      li.appendChild(label);
      list.appendChild(li);
    });
    modal.appendChild(list);
  }
  modal.appendChild(errorEl);

  addButton.addEventListener('click', async () => {
    const { group: freshGroup, me } = getContext();
    const targets = available.filter((f) => checked.has(f.uid));
    if (targets.length === 0) return;
    addButton.disabled = true;
    const results = await Promise.allSettled(
      targets.map((f) => sendGroupInvite(freshGroup.id, freshGroup.name, me.uid, me.pseudo, f.uid, f.pseudo))
    );
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length === 0) {
      closeModal();
    } else {
      errorEl.textContent = failed[0].reason?.message || 'Certaines invitations n’ont pas pu être envoyées.';
      addButton.disabled = false;
    }
  });

  const actions = el('div', 'ga-actions');
  const back = el('button', 'secondary', canChooseBot(getContext) ? 'Retour' : 'Fermer');
  back.type = 'button';
  back.addEventListener('click', () => (canChooseBot(getContext) ? showChoice(modal, getContext) : closeModal()));
  actions.append(back, addButton);
  modal.appendChild(actions);
}

function canChooseBot(getContext) {
  return getContext().canManage;
}

// Le rond « + » à placer après les ronds des membres.
export function createAddMemberButton(getContext) {
  injectStyle();
  const wrapper = el('div', 'member-card');
  const button = el('button', 'member-add-circle', '+');
  button.type = 'button';
  button.title = 'Ajouter un bot ou un joueur';
  button.setAttribute('aria-label', 'Ajouter un bot ou un joueur');
  button.addEventListener('click', () => {
    const modal = openModal();
    // Les non-gestionnaires n'ont que « Joueur » : on va directement à la liste d'amis.
    if (getContext().canManage) showChoice(modal, getContext);
    else showPlayers(modal, getContext);
  });
  wrapper.appendChild(button);
  const label = el('div', 'member-name', 'Ajouter');
  wrapper.appendChild(label);
  return wrapper;
}

export { injectStyle as injectGroupAddStyle };
