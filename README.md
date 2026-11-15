# threejs-fps-02
[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/taufik-hidayat/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/taufik-hidayat/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

FOUNDRY is a complete round-based tactical FPS in the browser: you and two bot teammates (EMBER) attack Site A against four defending bots (SLAG) in a dusk industrial foundry. Plant the bomb or eliminate the enemy team, earn money for kills and round wins, and spend it in the buy menu between rounds on rifles, SMGs, a sniper, grenades and armour. First to 5 rounds takes the match.

The game runs offline from static files on vendored three.js 0.187.0 — no build step, no network requests. Bots walk waypoint routes, hold the site, investigate gunfire, and shoot back with human-like inaccuracy. Gunplay rewards stopping to aim: recoil and spread punish firing on the move, headshots deal 4x damage, and aiming down sights tightens your group. All sounds are synthesized with WebAudio; all textures are painted procedurally on canvas.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 in desktop Chrome and click to play.

Controls: WASD move, mouse look, click fire, right mouse aim, R reload, 1–4 weapons, Q/G grenade, E plant the bomb, B buy menu, Ctrl crouch, Space jump.

Entered on [make.fun](https://make.fun/bounty/threejs-fps-02)
