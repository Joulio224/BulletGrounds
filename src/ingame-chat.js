// ---------------------------------------------------------------------------
// Messagerie en partie : bouton « Messages » dans le menu Échap
// ---------------------------------------------------------------------------
// On réutilise exactement la messagerie du lobby (messages.js) : au clic, on DÉPLACE son
// bloc (liste des conversations + fil) dans une fenêtre par-dessus le menu, puis on le
// remet dans l'onglet Messages du lobby à la fermeture. Les conversations, le « non lu » et
// l'envoi sont donc les mêmes partout.
//
// Taper dans la fenêtre ne doit JAMAIS déclencher les touches du jeu (M = carte, B = boutique,
// ZQSD...) : on arrête la propagation des touches, sauf Échap, qui ferme la fenêtre.
export function initInGameChat({ setMessagesVisible } = {}) {
  const menuEl = document.getElementById('menu');
  const layout = document.querySelector('#lobby-tab-messages .messages-layout');
  const lobbyTab = document.getElementById('lobby-tab-messages');
  if (!menuEl || !layout || !lobbyTab) return { setUnread() {}, close() {}, isOpen: () => false };

  const style = document.createElement('style');
  style.textContent = `
    #ingame-chat {
      position: fixed; inset: 0; z-index: 1700; display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.65); padding: 16px; box-sizing: border-box;
    }
    #ingame-chat[hidden] { display: none; }
    #ingame-chat .igc-box {
      width: min(900px, 100%); max-height: calc(100vh - 32px); overflow: auto; box-sizing: border-box;
      background: #1b1b22; color: #eee; border: 1px solid #333; border-radius: 12px; padding: 16px 18px;
      font: 15px/1.5 system-ui, sans-serif; text-align: left;
    }
    #ingame-chat .igc-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    #ingame-chat .igc-head h2 { margin: 0; font-size: 1.15rem; }
    #ingame-chat .igc-hint { color: #aaa; font-size: 0.8rem; margin: 0 0 10px; }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'ingame-chat';
  root.hidden = true;
  const box = document.createElement('div');
  box.className = 'igc-box';
  const head = document.createElement('div');
  head.className = 'igc-head';
  const title = document.createElement('h2');
  title.textContent = '💬 Messages';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'secondary';
  closeButton.textContent = 'Fermer';
  head.append(title, closeButton);
  const hint = document.createElement('p');
  hint.className = 'igc-hint';
  hint.textContent = 'Échap pour fermer et revenir au menu.';
  const body = document.createElement('div');
  box.append(head, hint, body);
  root.appendChild(box);
  document.body.appendChild(root);

  // keyup n'est PAS bloqué : une touche enfoncée avant l'ouverture (ZQSD, Maj...) doit pouvoir être
  // relâchée côté jeu, sinon le personnage resterait « bloqué en train de marcher » à la reprise.
  ['keydown', 'keypress'].forEach((type) => {
    root.addEventListener(type, (e) => {
      if (e.key !== 'Escape') e.stopPropagation();
    });
  });

  // Bouton dans le menu, juste avant « Quitter la partie »
  const button = document.createElement('button');
  button.id = 'messages-menu-button';
  button.type = 'button';
  button.append('Messages ');
  const badge = document.createElement('span');
  badge.className = 'nav-badge';
  badge.style.cssText = 'display:inline-flex;margin-left:6px;vertical-align:middle';
  badge.hidden = true;
  button.appendChild(badge);
  const quit = document.getElementById('quit-button');
  if (quit) menuEl.insertBefore(button, quit);
  else menuEl.appendChild(button);

  let open = false;
  function openChat() {
    if (open) return;
    open = true;
    body.appendChild(layout); // le bloc de messages.js passe du lobby à cette fenêtre
    root.hidden = false;
    setMessagesVisible?.(true);
    document.getElementById('thread-input')?.focus();
  }
  function closeChat() {
    if (!open) return;
    open = false;
    setMessagesVisible?.(false);
    root.hidden = true;
    lobbyTab.appendChild(layout); // retour dans l'onglet Messages du lobby
  }

  button.addEventListener('click', openChat);
  closeButton.addEventListener('click', closeChat);
  root.addEventListener('click', (event) => {
    if (event.target === root) closeChat();
  });
  document.addEventListener('keydown', (event) => {
    if (open && event.code === 'Escape') closeChat();
  });

  return {
    setUnread(count) {
      badge.hidden = count === 0;
      badge.textContent = String(count);
    },
    close: closeChat,
    isOpen: () => open,
  };
}
