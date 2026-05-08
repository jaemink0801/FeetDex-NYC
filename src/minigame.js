// ── Per-mythic NPC RPS data (keyed by feetId) ─────────────────────────────────
const RPS_NPC_DATA = {
  mythic_clav: {
    displayName: 'Clav',
    winLine:  "...GG. Frame data doesn't lie. You outplayed me. The feet are yours.",
    lossLine: "Skill issue. Come back when you've labbed it out.",
  },
  mythic_patapim: {
    displayName: 'Brr Brr Patapim',
    winLine:  "AHHH YOU WON!! PATAPIM ENERGY TRANSFER COMPLETE!! TAKE THE FEET!!",
    lossLine: "NOOOO!! The patapim energy was too strong!! Try again!! TRY AGAIN!!",
  },
  mythic_messi: {
    displayName: 'Leo Messi',
    winLine:  "Good. You have fast hands. The Golden Foot is yours to see.",
    lossLine: "Not today. Train more. Come back.",
  },
};

export function getRPSNpcData(feetId) {
  return RPS_NPC_DATA[feetId] ?? { displayName: '???', winLine: 'You win.', lossLine: 'You lose.' };
}

// ── RPS helpers ───────────────────────────────────────────────────────────────
const CHOICES = ['rock', 'paper', 'scissors'];
const SYMBOLS = { rock: '✊', paper: '✋', scissors: '✌' };
const LABELS  = { rock: 'Rock', paper: 'Paper', scissors: 'Scissors' };

function _resolveRound(player, npc) {
  if (player === npc) return 'tie';
  if ((player === 'rock'     && npc === 'scissors') ||
      (player === 'scissors' && npc === 'paper')    ||
      (player === 'paper'    && npc === 'rock'))     return 'player';
  return 'npc';
}

// ── Active timer handles (cleared on stop) ────────────────────────────────────
let _thinkingInterval = null;
let _roundTimeout     = null;
let _nextRoundTimeout = null;
let _winTimeout       = null;

function _clearTimers() {
  clearInterval(_thinkingInterval);
  clearTimeout(_roundTimeout);
  clearTimeout(_nextRoundTimeout);
  clearTimeout(_winTimeout);
  _thinkingInterval = _roundTimeout = _nextRoundTimeout = _winTimeout = null;
}

// Called from main.js ESC handler — safe to call multiple times.
export function stopRPSChallenge() {
  _clearTimers();
  document.getElementById('minigame-overlay')?.classList.remove('active');
}

// ── Main exported entry point ─────────────────────────────────────────────────
// npcData: { name, winLine, lossLine }
export function startRPSChallenge(npcData, onWin, onLose) {
  let playerScore  = 0;
  let npcScore     = 0;
  let roundDisplay = 1; // increments only on non-tie rounds

  _clearTimers();

  // ── Build overlay HTML ─────────────────────────────────────────────────────
  const header  = document.getElementById('minigame-header');
  const content = document.getElementById('minigame-content');

  header.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;
      width:100%;max-width:560px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:19px;font-weight:bold;">${npcData.name}</span>
        <span style="background:#F0997B;color:#1a0a00;font-size:10px;font-weight:bold;
          letter-spacing:2px;padding:3px 8px;border-radius:3px;text-transform:uppercase;">
          Mythic Challenge
        </span>
      </div>
      <span id="rps-round-label" style="font-size:13px;opacity:.55;">Round 1 / 3</span>
    </div>
    <div id="rps-thinking" style="font-size:12px;color:#F0997B;margin-top:6px;min-height:16px;"></div>`;

  content.innerHTML = `
    <div style="text-align:center;font-size:18px;margin-bottom:20px;">
      You: <span id="rps-pscore">0</span>
      &nbsp;—&nbsp;
      <span id="rps-nname">${npcData.name}</span>: <span id="rps-nscore">0</span>
    </div>
    <div class="rps-choices" id="rps-choices">
      <button class="rps-btn" data-choice="rock">✊<br><span style="font-size:12px">Rock</span></button>
      <button class="rps-btn" data-choice="paper">✋<br><span style="font-size:12px">Paper</span></button>
      <button class="rps-btn" data-choice="scissors">✌<br><span style="font-size:12px">Scissors</span></button>
    </div>
    <div class="rps-result" id="rps-result"></div>
    <div id="rps-endscreen" style="display:none;text-align:center;padding:20px 0;"></div>`;

  document.getElementById('mg-close-hint').textContent = 'ESC — forfeit challenge';
  document.getElementById('minigame-overlay').classList.add('active');

  // ── Helpers ────────────────────────────────────────────────────────────────
  function _setButtonsDisabled(disabled) {
    document.querySelectorAll('.rps-btn').forEach(b => {
      b.disabled    = disabled;
      b.style.opacity = disabled ? '0.35' : '1';
      b.style.cursor  = disabled ? 'default' : 'pointer';
    });
  }

  function _startThinking() {
    const el = document.getElementById('rps-thinking');
    if (!el) return;
    let dots = 0;
    el.textContent = 'thinking.';
    _thinkingInterval = setInterval(() => {
      dots = (dots + 1) % 3;
      el.textContent = 'thinking' + '.'.repeat(dots + 1);
    }, 400);
  }

  function _stopThinking() {
    clearInterval(_thinkingInterval);
    _thinkingInterval = null;
    const el = document.getElementById('rps-thinking');
    if (el) el.textContent = '';
  }

  function _updateBoard() {
    const ps = document.getElementById('rps-pscore');
    const ns = document.getElementById('rps-nscore');
    const rl = document.getElementById('rps-round-label');
    if (ps) ps.textContent = playerScore;
    if (ns) ns.textContent = npcScore;
    if (rl) rl.textContent = `Round ${Math.min(roundDisplay, 3)} / 3`;
  }

  function _showEndScreen(playerWon) {
    document.getElementById('rps-choices').style.display   = 'none';
    const result  = document.getElementById('rps-result');
    const thinking = document.getElementById('rps-thinking');
    if (result)   result.textContent  = '';
    if (thinking) thinking.textContent = '';

    const end = document.getElementById('rps-endscreen');
    if (playerWon) {
      end.innerHTML = `
        <div style="font-size:32px;font-weight:bold;color:#44ff88;margin-bottom:12px;">
          You win!
        </div>
        <div style="font-size:13px;opacity:.75;max-width:400px;margin:0 auto;">
          ${npcData.winLine}
        </div>`;
      end.style.display = 'block';
      _winTimeout = setTimeout(() => {
        stopRPSChallenge();
        onWin();
      }, 1500);
    } else {
      end.innerHTML = `
        <div style="font-size:32px;font-weight:bold;color:#ff5555;margin-bottom:12px;">
          You lose.
        </div>
        <div style="font-size:13px;opacity:.75;max-width:400px;margin:0 auto;margin-bottom:22px;">
          ${npcData.lossLine}
        </div>
        <button class="ws-btn" id="rps-close-btn">Close</button>`;
      end.style.display = 'block';
      document.getElementById('rps-close-btn').onclick = () => {
        stopRPSChallenge();
        onLose();
      };
    }
  }

  function _resolveAndDisplay(playerChoice) {
    const npcChoice = CHOICES[Math.floor(Math.random() * 3)];
    _stopThinking();

    const outcome = _resolveRound(playerChoice, npcChoice);

    const resultEl = document.getElementById('rps-result');
    if (resultEl) {
      let outcomeText, outcomeColor;
      if (outcome === 'tie') {
        outcomeText = 'Tie — replay!'; outcomeColor = '#aaaaaa';
      } else if (outcome === 'player') {
        outcomeText = 'You win the round!'; outcomeColor = '#44ff88';
      } else {
        outcomeText = 'NPC wins the round!'; outcomeColor = '#ff5555';
      }
      resultEl.innerHTML =
        `<span style="opacity:.7">You: ${SYMBOLS[playerChoice]} ${LABELS[playerChoice]}</span>` +
        `&nbsp;&nbsp;<span style="color:${outcomeColor};font-weight:bold">${outcomeText}</span>&nbsp;&nbsp;` +
        `<span style="opacity:.7">${npcData.name}: ${SYMBOLS[npcChoice]} ${LABELS[npcChoice]}</span>`;
    }

    if (outcome === 'player') playerScore++;
    else if (outcome === 'npc') npcScore++;
    if (outcome !== 'tie') roundDisplay++;

    _updateBoard();

    const matchOver = playerScore >= 2 || npcScore >= 2;
    _nextRoundTimeout = setTimeout(() => {
      if (matchOver) {
        _showEndScreen(playerScore >= 2);
      } else {
        if (resultEl) resultEl.textContent = '';
        _setButtonsDisabled(false);
      }
    }, 1200);
  }

  function _onPlayerChoice(choice) {
    _setButtonsDisabled(true);
    _startThinking();
    _roundTimeout = setTimeout(() => _resolveAndDisplay(choice), 900);
  }

  // Attach click listeners to the freshly-injected buttons
  document.querySelectorAll('.rps-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!btn.disabled) _onPlayerChoice(btn.dataset.choice);
    });
  });
}
