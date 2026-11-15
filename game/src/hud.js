// The DOM HUD: health, armour, ammo, money, timer, team scores, kill feed, bomb status,
// crosshair, hit marker and the buy menu. It never touches the simulation; main.js pushes
// numbers in and reads the play / buy callbacks out. DOM writes are cached so unchanged
// values never touch the layout.
export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammo = $('ammo');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const grenadeLabel = $('grenade-label');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const armorNum = $('armor-num');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const teamScore = $('team-score');
  const roundLabel = $('round-label');
  const bombStatus = $('bomb-status');
  const bombFill = $('bomb-fill');
  const bombText = $('bomb-text');
  const killfeed = $('killfeed');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const vignette = $('damage-vignette');
  const buyMenu = $('buy-menu');
  const buyMoney = $('buy-money');
  const buyItems = $('buy-items');
  const plantHint = $('plant-hint');
  const plantFill = $('plant-fill');

  let hitTimer = 0;
  let bannerTimer = 0;
  let lastMag = -1;
  let lastReserve = -1;
  let lastHealth = -1;
  let lastArmor = -1;
  let lastMoney = -1;
  let lastTimer = '';
  let lastScore = '';
  let lastWeapon = '';

  const COPY = {
    start: {
      title: 'FOUNDRY',
      copy: 'Round-based tactical FPS. Plant the bomb at Site A or eliminate SLAG. First to 5 rounds takes the match.',
      action: 'Click to play',
    },
    paused: {
      title: 'FOUNDRY',
      copy: 'Paused. Click to resume.',
      action: 'Click to resume',
    },
    down: {
      title: 'You are down',
      copy: 'Your team fights on. Watch the round play out.',
      action: 'Keep watching',
    },
  };

  return {
    setHealth(value) {
      const rounded = Math.max(0, Math.round(value));
      if (rounded === lastHealth) return;
      lastHealth = rounded;
      healthFill.style.width = `${rounded}%`;
      healthNum.textContent = String(rounded);
      healthFill.classList.toggle('low', rounded <= 30);
    },
    setArmor(value) {
      const rounded = Math.max(0, Math.round(value));
      if (rounded === lastArmor) return;
      lastArmor = rounded;
      armorNum.textContent = String(rounded);
    },
    setAmmo(mag, reserve) {
      if (mag === lastMag && reserve === lastReserve) return;
      lastMag = mag;
      lastReserve = reserve;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve === 999 ? '∞' : reserve}`;
      ammo.classList.toggle('empty', mag === 0);
    },
    setWeapon(name) {
      if (name === lastWeapon) return;
      lastWeapon = name;
      weaponName.textContent = name;
    },
    setGrenades(frag, smoke, selected) {
      grenadeLabel.textContent = `G: ${selected === 'frag' ? 'Frag' : 'Smoke'} ×${selected === 'frag' ? frag : smoke}  (Q switch)`;
    },
    setMoney(value) {
      if (value === lastMoney) return;
      lastMoney = value;
      moneyValue.textContent = `$${value}`;
    },
    setTimer(text) {
      if (text === lastTimer) return;
      lastTimer = text;
      timerValue.textContent = text;
    },
    setScore(wins, round) {
      const text = `EMBER ${wins.ember} — ${wins.slag} SLAG`;
      if (text === lastScore) return;
      lastScore = text;
      teamScore.textContent = text;
      roundLabel.textContent = `ROUND ${round}`;
    },
    setBomb(status, progress, timer) {
      if (status === 'carried') {
        bombStatus.hidden = true;
        return;
      }
      bombStatus.hidden = false;
      if (status === 'planted') {
        bombText.textContent = `BOMB PLANTED — ${Math.max(0, Math.ceil(timer))}s`;
        bombFill.style.width = `${Math.max(0, Math.min(100, (timer / 35) * 100))}%`;
        bombFill.classList.add('danger');
      } else if (status === 'defused') {
        bombText.textContent = 'BOMB DEFUSED';
        bombFill.style.width = '0%';
      } else {
        bombText.textContent = 'BOMB DETONATED';
        bombFill.style.width = '0%';
      }
    },
    setPlantHint(show, progress) {
      plantHint.hidden = !show;
      if (show) plantFill.style.width = `${Math.round(progress * 100)}%`;
    },
    setCrosshairGap(px) {
      crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.classList.remove('kill');
      }, holdMs);
    },
    damageFlash() {
      vignette.classList.add('on');
      setTimeout(() => vignette.classList.remove('on'), 180);
    },
    killFeed(text) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      line.textContent = text;
      killfeed.prepend(line);
      while (killfeed.children.length > 4) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => {
        if (line.parentNode) line.parentNode.removeChild(line);
      }, 6000);
    },
    showBanner(titleText, subText, ms = 2600) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText;
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        banner.hidden = true;
      }, ms);
    },
    hideBanner() {
      banner.hidden = true;
    },
    showOverlay(mode, data) {
      if (mode === 'matchEnd') {
        title.textContent = data.winner === 'ember' ? 'MATCH WON' : 'MATCH LOST';
        copy.textContent = `Final score EMBER ${data.wins.ember} — ${data.wins.slag} SLAG. ${data.winner === 'ember' ? 'The foundry is yours.' : 'SLAG holds the foundry.'}`;
        play.textContent = 'Play again';
      } else if (mode === 'roundEnd') {
        title.textContent = data.winner === 'ember' ? 'ROUND WON' : 'ROUND LOST';
        copy.textContent = `${data.reason} Score EMBER ${data.wins.ember} — ${data.wins.slag} SLAG.`;
        play.textContent = 'Next round';
      } else {
        const text = COPY[mode];
        title.textContent = text.title;
        copy.textContent = text.copy;
        play.textContent = text.action;
      }
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    showBuyMenu(show, money, owned, grenades) {
      buyMenu.hidden = !show;
      if (!show) return;
      buyMoney.textContent = `$${money}`;
      const rows = [
        { key: '2', id: 'rifle', name: 'VK-47 Foundry — rifle', price: 2700, have: owned.rifle },
        { key: '3', id: 'smg', name: 'Rasp-9 — SMG', price: 1500, have: owned.smg },
        { key: '4', id: 'sniper', name: 'Longshot-8 — sniper', price: 4200, have: owned.sniper },
        { key: '5', id: 'frag', name: 'Furnace Frag — grenade', price: 300, have: grenades.frag > 0, count: grenades.frag },
        { key: '6', id: 'smoke', name: 'Slag Smoke — grenade', price: 300, have: grenades.smoke > 0, count: grenades.smoke },
        { key: '7', id: 'armor', name: 'Foundry Vest — +50 armour', price: 650, have: false },
      ];
      buyItems.innerHTML = '';
      for (const row of rows) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'buy-row';
        button.dataset.buy = row.id;
        const owned = row.have ? 'OWNED' : `$${row.price}`;
        button.innerHTML = `<span class="buy-key">${row.key}</span><span class="buy-name">${row.name}</span><span class="buy-price">${owned}</span>`;
        buyItems.appendChild(button);
      }
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    onBuy(handler) {
      buyItems.addEventListener('click', (event) => {
        const row = event.target.closest('[data-buy]');
        if (row) handler(row.dataset.buy);
      });
    },
  };
}
