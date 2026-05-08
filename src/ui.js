import { FEET_CATALOG, BOOSTER_DEFS } from './feetdex.js';
import { Audio }        from './audio.js';

// Inline 2D foot silhouette used by the celebration rain. Stored once at
// module scope so spawnFeetRain doesn't rebuild the same string per drop.
const FOOT_SVG = `<svg viewBox="0 0 60 100" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" style="width:100%;height:100%;display:block;">
  <path d="M 30 95 C 12 95, 5 78, 8 58 C 10 44, 14 32, 18 24 L 18 18 C 18 11, 22 7, 28 7 L 32 7 C 38 7, 42 13, 40 19 C 44 25, 50 38, 52 52 C 54 72, 50 95, 30 95 Z" fill="#ffd6b3" stroke="#7a4626" stroke-width="2.2"/>
  <circle cx="28" cy="9"  r="6"   fill="#ffd6b3" stroke="#7a4626" stroke-width="2"/>
  <circle cx="20" cy="13" r="4.4" fill="#ffd6b3" stroke="#7a4626" stroke-width="2"/>
  <circle cx="14" cy="19" r="3.6" fill="#ffd6b3" stroke="#7a4626" stroke-width="2"/>
  <circle cx="10" cy="26" r="3.0" fill="#ffd6b3" stroke="#7a4626" stroke-width="2"/>
  <circle cx="9"  cy="33" r="2.5" fill="#ffd6b3" stroke="#7a4626" stroke-width="2"/>
  <ellipse cx="30" cy="55" rx="9" ry="14" fill="#f5b894" opacity="0.5"/>
</svg>`;

// ── Typewriter voice helpers ──────────────────────────────────────────────────

// Milliseconds per character — slower for ancient/dignified, faster for chaotic
function _typeSpeed(npcId, rarity) {
  if (npcId === 'mythic_patapim') return 14;  // frantic
  if (npcId === 'mythic_clav')    return 18;  // robotic fast
  if (npcId === 'secret_rexey')   return 52;  // slow, deliberate
  if (rarity === 'legendary')     return 36;  // dignified
  if (rarity === 'mythic')        return 20;  // quick-witted
  if (rarity === 'epic')          return 26;
  if (rarity === 'rare')          return 28;
  return 30;                                  // common / none
}

// Fire chatter sound every N voiced characters (skip spaces / punctuation)
function _chatterEvery(npcId) {
  if (npcId === 'mythic_patapim') return 1;   // every char — pure chaos
  if (npcId === 'mythic_clav')    return 1;   // every char — robotic precision
  return 2;                                   // everyone else: every 2 voiced chars
}

// CSS class applied to the dialogue panel for mythic/legendary/secret NPCs
function _voiceClass(npcId, rarity) {
  if (['mythic', 'legendary', 'secret'].includes(rarity))
    return 'dlg-voice-' + (npcId || rarity);
  return '';
}

// ── CSS injection (rarity discovery themes + animations) ──────────────────────

function _injectCSS() {
  if (document.getElementById('ui-injected-css')) return;
  const s = document.createElement('style');
  s.id = 'ui-injected-css';
  s.textContent = `
    /* Discovery rarity backgrounds */
    #discovery-overlay.discover-common    { background:#111111; }
    #discovery-overlay.discover-rare      { background:#0a1f0a; }
    #discovery-overlay.discover-epic      { background:#0d0014; }
    #discovery-overlay.discover-mythic    { background:#1a0500; }
    #discovery-overlay.discover-legendary { background:#000000; }
    #discovery-overlay.discover-secret    { background:#fffde7; }

    /* Foot icon color per rarity */
    #discovery-overlay.discover-common    #discovery-foot { color:#ffffff; }
    #discovery-overlay.discover-rare      #discovery-foot { color:#4caf50; }
    #discovery-overlay.discover-epic      #discovery-foot { color:#ce93d8; }
    #discovery-overlay.discover-mythic    #discovery-foot { color:#ff6d00; }
    #discovery-overlay.discover-legendary #discovery-foot { color:#ffd700; width:100px; height:125px; }
    #discovery-overlay.discover-secret    #discovery-foot { color:#c8a45a; }

    /* Name text color per rarity */
    #discovery-overlay.discover-rare      #discovery-name { color:#c8e6c9; }
    #discovery-overlay.discover-epic      #discovery-name { color:#e1bee7; }
    #discovery-overlay.discover-mythic    #discovery-name { color:#ffe0b2; font-size:24px; letter-spacing:.05em; }
    #discovery-overlay.discover-legendary #discovery-name { color:#ffd700; font-size:26px; font-weight:500; }
    #discovery-overlay.discover-secret    #discovery-name { font-family:Georgia,serif; font-style:italic; color:#5d4037; font-size:20px; }
    #discovery-overlay.discover-secret    #discovery-rarity { font-size:11px; letter-spacing:3px; color:#8d6e63; background:none; border:none; padding:0; }

    /* Applied animations */
    #discovery-overlay.discover-mythic    { animation:disc-shake .3s ease-out; }
    #discovery-overlay.discover-mythic    #discovery-foot { animation:disc-pulse-icon .5s ease-in-out 2; }
    #discovery-overlay.discover-epic      #discovery-foot { animation:disc-spin-once .6s ease-in-out; }
    #discovery-overlay.discover-legendary #discovery-foot { animation:disc-zoom-in .8s ease-out forwards; }
    #discovery-overlay.discover-legendary #discovery-border { animation:disc-gold-border 1s ease-in-out infinite; }
    #discovery-overlay.discover-secret    #discovery-foot  { animation:disc-slow-pulse 2s ease-in-out infinite; }

    /* Keyframes */
    @keyframes disc-flash-in    { 0%,12%{opacity:.9} 100%{opacity:0} }
    @keyframes disc-rare-ring   { 0%{transform:translate(-50%,-50%) scale(.5);opacity:.8} 100%{transform:translate(-50%,-50%) scale(2.5);opacity:0} }
    @keyframes disc-spin-once   { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
    @keyframes disc-shimmer-ltr { from{left:-100%} to{left:200%} }
    @keyframes disc-shake       { 0%,100%{transform:none} 20%{transform:translateX(-4px)} 40%{transform:translateX(4px)} 60%{transform:translateX(-2px)} 80%{transform:translateX(2px)} }
    @keyframes disc-burst       { from{height:0;opacity:.8} to{height:60px;opacity:0} }
    @keyframes disc-pulse-icon  { 0%,100%{transform:scale(1)} 50%{transform:scale(1.15)} }
    @keyframes disc-zoom-in     { from{transform:scale(.7)} to{transform:scale(1)} }
    @keyframes disc-glow-in     { from{opacity:0} to{opacity:1} }
    @keyframes disc-gold-border { 0%,100%{box-shadow:0 0 8px rgba(255,215,0,.3)} 50%{box-shadow:0 0 28px rgba(255,215,0,.8)} }
    @keyframes disc-slow-pulse  { 0%,100%{transform:scale(1)} 50%{transform:scale(1.08)} }
    @keyframes disc-star-orbit  { from{transform:translate(-50%,-50%) rotate(0deg)} to{transform:translate(-50%,-50%) rotate(360deg)} }
    @keyframes disc-secret-flash{ 0%,15%{opacity:1} 100%{opacity:0} }

    /* JS-created helper elements */
    ._disc-flash  { position:absolute;inset:0;background:#fff;pointer-events:none;z-index:2;animation:disc-flash-in .45s ease-out forwards; }
    ._rare-ring   { position:absolute;width:100px;height:100px;border-radius:50%;border:2px solid #4caf50;top:50%;left:50%;transform:translate(-50%,-50%);animation:disc-rare-ring .8s ease-out 2;pointer-events:none; }
    ._shimmer-wave{ position:absolute;left:-100%;height:2px;width:60%;background:rgba(206,147,216,.15);pointer-events:none;animation:disc-shimmer-ltr .7s ease-in-out forwards; }
    ._burst-ray   { position:absolute;width:3px;background:rgba(255,109,0,.3);transform-origin:top center;pointer-events:none; }
    ._legend-glow { position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at center,rgba(255,193,7,.15),transparent 70%);opacity:0;animation:disc-glow-in .8s .3s forwards; }
    ._corner-acc  { position:absolute;width:20px;height:20px;animation:disc-glow-in .4s ease-out forwards; }
    ._secret-flash{ position:fixed;inset:0;background:#fff;pointer-events:none;z-index:9998;animation:disc-secret-flash .65s ease-out forwards; }
    ._star-ring   { position:absolute;width:180px;height:180px;top:50%;left:50%;transform:translate(-50%,-50%);animation:disc-star-orbit 4s linear infinite;pointer-events:none; }
    ._star        { position:absolute;width:8px;height:8px;background:#ffd700;clip-path:polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%); }

    /* FeetDex secret slot shimmer (locked) */
    @keyframes slot-shimmer { 0%,100%{background-position:-200% center} 50%{background-position:200% center} }
    .fdex-slot.secret-shimmer {
      background:linear-gradient(90deg,transparent 0%,rgba(255,215,0,.12) 50%,transparent 100%);
      background-size:200% 100%; animation:slot-shimmer 3s ease-in-out infinite;
    }

    /* ── Dialogue name animations for mythic / legendary / secret ── */
    .dlg-voice-mythic_patapim  #dialogue-npc-name { color:#ffaa00; animation:dlg-bounce  .12s ease-in-out infinite alternate; }
    .dlg-voice-mythic_clav     #dialogue-npc-name { color:#00ffcc; animation:dlg-glitch  .44s steps(2) infinite; }
    .dlg-voice-mythic_messi    #dialogue-npc-name { color:#ffd700; }
    .dlg-voice-legendary_margot  #dialogue-npc-name { color:#ffd700; animation:dlg-shimmer 1.8s ease-in-out infinite; }
    .dlg-voice-legendary_bigfoot #dialogue-npc-name { color:#b09070; animation:dlg-tremor  .9s  ease-in-out infinite; }
    .dlg-voice-secret_rexey    #dialogue-npc-name { color:#c8a45a; font-style:italic; animation:dlg-glow-warm 3s ease-in-out infinite; }
    .dlg-voice-secret_rexey    #dialogue-text     { letter-spacing:.04em; }

    @keyframes dlg-bounce    { to{transform:translateY(-3px)} }
    @keyframes dlg-glitch    { 0%,100%{transform:none;opacity:1} 33%{transform:translateX(2px);opacity:.82} 66%{transform:translateX(-2px);opacity:.94} }
    @keyframes dlg-shimmer   { 0%,100%{text-shadow:0 0 4px rgba(255,215,0,.2)} 50%{text-shadow:0 0 18px rgba(255,215,0,.9),0 0 32px rgba(255,215,0,.35)} }
    @keyframes dlg-tremor    { 0%,100%{transform:none} 25%{transform:translateY(-1px)} 50%{transform:translateY(1px)} 75%{transform:translateY(-.5px)} }
    @keyframes dlg-glow-warm { 0%,100%{text-shadow:0 0 4px rgba(200,164,90,.2)} 50%{text-shadow:0 0 22px rgba(200,164,90,.9)} }
  `;
  document.head.appendChild(s);
}

// ── Dialogue scripts ──────────────────────────────────────────────────────────
// Prompt 08 (FeetDex Master Registry) will provide canonical versions.

// Named mission NPCs — fixed-position grey citizens whose dialogue replaces
// the random NONE_LINES chatter. Half teach a budgeting/business/marketing
// concept; half deliver an NYC fun-fact rooted in business or finance.
// Reaching the last line of any of these triggers a 20g talk-mission reward.
const MISSION_NPC_SCRIPTS = {
  // Times Square — opportunity cost via billboards
  npc_martin_ts: [
    "Hey, new face! Welcome to Times Square. See all those huge glowing billboards?",
    "Each one costs more money for ONE HOUR than my apartment costs for a whole month. Companies fight to put their ad up there.",
    "Here's a lesson about money: if a company spends on a Coca-Cola billboard, that money is gone — they can't also spend it on a Pepsi billboard. Choosing one means saying no to the other.",
    "Saying no to other choices when you pick something is called <b>opportunity cost</b>. Same with your gold — every tool you buy is a tool you can't buy. So pick what helps you most.",
  ],
  // Office worker — gross margin
  npc_grace_office: [
    "Sorry, eating quick — I do bookkeeping for a little shop down the block.",
    "Here's a thing every shop owner has to know: how much it costs you to MAKE something, versus how much you sell it for.",
    "Say you sell a coffee for $5. The beans, cup, and lid cost you $1.50. So you keep $3.50 from that sale. That leftover money is called your <b>profit</b>.",
    "If you only keep a tiny piece of every dollar that comes in, you're barely making money. Watching this number is how shops stay in business.",
  ],
  // Cafe — NYC fun fact: the NYSE opening bell as marketing theatre
  npc_lucy_cafe: [
    "Espresso? You look like you need one.",
    "Cool New York fact: the giant Stock Exchange building has rung a little bell every weekday since 1903 to mark the start of trading.",
    "It's just a bell. But cameras film it every single morning. Celebrities, charities, even cartoon characters have rung it.",
    "Why does it matter? Free attention. Millions of people watch a tiny ceremony and remember the company. That's <b>advertising</b> at its smartest — give people something fun to watch and they'll think of you.",
  ],
  // Diner — break-even point
  npc_hassan_diner: [
    "Welcome, sit anywhere — coffee's on the house, friend.",
    "Thirty-one years I've run this diner. Every morning when I unlock the door, I'm already losing money: rent, electricity, eggs, my cousin's pay.",
    "By eleven A.M., after I sell about fourteen breakfast plates, I've finally earned back what I spent that morning. That magic number — fourteen plates — is called <b>breaking even</b>.",
    "Once you know your number, you stop panicking on slow days. Just count plates. Past fourteen, every one is real money in my pocket.",
  ],
  // Museum — NYC fun fact: Macy's parade as marketing
  npc_mei_museum: [
    "First time here at the museum?",
    "Here's a fun New York story — you know the giant Macy's Thanksgiving Day Parade with the balloons? It started in 1924, but not just for the holiday.",
    "Macy's department store wanted shoppers in their store the next morning. So they put on a free parade — families come watch, kids see all the toys floating by, parents bring the kids back to buy them.",
    "Smart <b>advertising</b> isn't a flashy logo. It's giving people a reason to come visit, year after year, for a hundred years.",
  ],
  // Gallery — branding
  npc_carter_gallery: [
    "Welcome. Here for the art?",
    "Funny thing about paintings — half the price is who PAINTED it, not the painting itself.",
    "Same canvas, same paint, but if a famous name signed it? Ten times the price. People aren't really buying the art. They're buying the right to say they own a famous person's work.",
    "That's what we call a <b>brand</b> — a name people trust enough to pay extra for. Build one, and your work sells before you even finish it.",
  ],
};

const NONE_LINES = [
  "Yo, you got a MetroCard? Mine just ran out.",
  "Watch where you're walkin', this is midtown!",
  "The 6 train is delayed again. Classic.",
  "I've been waiting for this light for four minutes. FOUR.",
  "You hear about the new place on 9th? Line's already around the block.",
  "My bodega guy remembered my order today. Best day of my life.",
  "It's not the heat, it's the humidity. Every time.",
  "Three cabs just drove past me with their lights on. I'm done.",
  "Someone left a full pizza on the subway seat. New York, man.",
  "I walked 40 blocks today. My therapist says I process emotions through movement.",
  "The pigeons here have more confidence than I do and I respect that.",
  "Excuse me — do you know if this is uptown or downtown? I've lived here 12 years.",
  "That hot dog was $6 and worth every penny. Don't judge me.",
  "I saw a raccoon eat an entire slice of pizza on the steps of the Met.",
  "Central Park at 7am hits different. Just me, the joggers, and my regrets.",
];

const COMMON_SCRIPTS = {
  common_samurai: [
    "I have walked from Kyoto to Osaka, from Osaka to San Francisco, and now... Times Square. I do not know why I am here.",
    "The subway map makes no sense. There are no rice paper screens. Everything smells like a pretzel.",
    "I sought the greatest dojo in the world. My GPS led me to a Subway sandwich shop. I ate a footlong. I do not know what I am becoming.",
    "...but my geta still carry the dust of the Tokaido road. They have not forgotten, even if I have.",
  ],
  common_bill: [
    "Oh, hey! Sorry, didn't see you there — I was just reading this incredibly niche blog post about the thermal properties of wool socks.",
    "People always ask if gingers have souls. I say: we have soles. Shoe soles. New Balance 574s specifically.",
    "I tried a spray tan once. My feet turned the color of a sweet potato. My podiatrist thought I had a medical condition.",
    "Anyway, wanna see? They're kind of... a lot. But in a good way, I think.",
  ],
  common_gymrat: [
    "Bro. BRO. Do you even lift? Because I just hit a 405 deadlift and my CNS is fried but I feel INCREDIBLE.",
    "People sleep on foot calluses. That's structural integrity, man. You can't PR without a solid base. The feet ARE the foundation.",
    "I train barefoot sometimes. Coach told me to wear shoes. I said 'Coach, my feet ARE shoes at this point.'",
    "Here, look. Don't touch though. Or do touch, I don't care. I've stopped caring about a lot of things since I started training twice a day.",
  ],
  common_50shades: [
    "I don't believe in color. Color is a distraction. Grey is the only honest shade.",
    "My therapist says I have a 'fixation.' I say I have a 'philosophy.' We agreed to disagree. She was wearing beige. We did not agree to disagree.",
    "These heels are Pantone 18-0306. Pewter. The most underappreciated grey. Not too warm, not too cool. Perfect control.",
    "Look at these heels. Fifty shades, but feet. You understand. Most people don't.",
  ],
  common_happyfeet: [
    "*tap tap tap* ...Oh! Sorry. I can't help it. The rhythm just... comes out.",
    "Everyone told me penguins can't tap dance. Everyone. My dad, the elders, some guy on TripAdvisor. I proved them ALL wrong.",
    "New York is the only city that understood me. You hear the beat in the subway grates? That's my soundtrack now. This city TAPS.",
    "*looks down at feet proudly* ...These brought me here. They'll take me anywhere.",
  ],
};

const RARE_SCRIPTS = {
  rare_trex: [
    "HELLO. I AM NORMAL PERSON. I AM DEFINITELY NOT A DINOSAUR. Please stop looking at my feet.",
    "I work in finance. I take the subway. I eat at Shake Shack. Normal human activities. I enjoy all of them with my normal human feet.",
    "...The tie was my idea. It says 'professional.' My therapist says it says 'compensating.' She is not wrong.",
    "...Fine. FINE. Look at them. But I'm still a person. Fiscally responsible and everything.",
  ],
  rare_gramma: [
    "Oh sweetheart! Are you lost? You look lost. Or hungry. You look like you could use a snack. I have oatmeal raisin.",
    "I've lived in this city 74 years. Used to walk everywhere in heels. Now I wouldn't trade these slippers for anything. My feet have earned their rest.",
    "My granddaughter says orthopaedic slippers aren't fashionable. I said, 'Baby girl, I MADE fashion. Fashion retired. I'm still here.'",
    "Look at these things. Soft as clouds. I embroidered the daisies myself. These feet raised four children and outlasted three mayors.",
  ],
  rare_colonel: [
    "Son, I was 65 years old when I franchised my first restaurant. 65. You know what most people do at 65? They retire. I built an empire.",
    "People ask me: Colonel, what's the secret? I say the secret is in the pressure. The pressure cooker. The pressure of never giving up.",
    "I drove across this country in a car, selling my recipe out of the trunk. Rejected 1,009 times. 1,009! And I kept going. My feet carried me every step.",
    "These shoes have walked more miles than most folks drive. And they're still shining. Finger lickin' good? These feet are toe lickin' good, son.",
  ],
  rare_cheerleader: [
    "V-I-C-T-O-R-Y! That's — wait, sorry. Habit. Hi! I'm Brianna. I've been cheering since I could walk. Literally.",
    "People think cheerleading is just jumping around. It's gymnastics, it's dance, it's SPORT. My left foot has been taped since sophomore year and it has NEVER let me down.",
    "Coach always said: your foundation is your feet. Strong feet, strong cheer. I've taken that into every part of my life. Job interview? Strong feet. First date? Strong feet.",
    "Okay but seriously look at my sneakers. Do you see the arch support on these things? I EARNED this arch support.",
  ],
};

const EPIC_SCRIPTS = {
  epic_lebron: [
    "Ay, what's good. You play? No? That's cool, that's cool. Not everyone's built for the game. But everybody's built for SOMETHING.",
    "My feet have carried me from Akron to four championships. People talk about the hands, the handles, the IQ — but the FEET? The feet don't lie. You can see it in the wear patterns.",
    "I eat right, I sleep right, I recover right. My body is my business. I spend over a million dollars a year maintaining it. My feet get the same treatment as everything else. More, actually.",
    "Size 15. People always gotta look. Go ahead. I've made peace with the attention.",
  ],
  epic_sonion: [
    "Ah. You found me. Most people look right through me, which is technically accurate on Tuesdays.",
    "My name? It's exactly what it sounds like once you've heard it enough times. The feet are a whole other conversation. Are you ready for that conversation?",
    "I've been called 'an experience,' 'a walking EULA,' and once, memorably, 'the reason I updated my priors.' I take all of these as compliments.",
    "These feet have walked between things. Not through them — BETWEEN them. The shoes are just where they rest when I'm being observed.",
  ],
  epic_sydney: [
    "Hi! I'm just a regular person. Just a totally normal person walking around New York. Definitely not anyone you'd recognize. Please don't photograph me.",
    "My job? I, um. I do things. Professionally. Physical things. For a production. A production I can't name. The NDA is very thorough.",
    "I will say this: the person I work for has great taste in footwear. Very particular about it. So naturally, as her... colleague... I have also developed great taste.",
    "These boots? They've fallen from things. Heights I'm not allowed to specify. But they've always landed right.",
  ],
};

const MYTHIC_SCRIPTS = {
  mythic_clav: [
    "Oh, you want to SEE the feet? Bold. Most people aren't ready for feet that optimized. The frame data alone requires a 10-page spreadsheet.",
    "These have a 0.003 second faster ground contact time than standard human feet. I modded the insoles. I wrote the insoles. The insoles run Debian.",
    "You think you deserve to see Framemog Feet? Let's find out. I don't hand out access to just anyone. This requires a hands-on review.",
    "Put up your fists. If you can land a clean combo on me, I'll show you the feet. No mercy mode. Engage.",
  ],
  mythic_patapim: [
    "BRR BRR! Hello hello hello! You found me! Most people walk past! I am RIGHT HERE though! RIGHT HERE THE WHOLE TIME!",
    "My feet are VERY fast. They are always going somewhere even when I am standing still. Can you FEEL it? The patapim energy?",
    "You want to see my feet? You have to EARN the patapim energy! No words! No scrambling! BRR BRR FISTS! BRR BRR FISTS!",
    "I CHASE! I SWING! YOU DODGE! KNOCK ME DOWN AND PATAPIM POWER IS YOURS!",
  ],
  mythic_messi: [
    "Hola. No, I'm not doing selfies today. ...Okay, maybe one selfie. Just one.",
    "People always ask about the left foot. Yes. It is special. I don't fully understand it either. It does what I ask. Usually more.",
    "To see the Golden Foot, you must earn it. With your hands. With your footwork. The way the game was meant to be played.",
    "Vamos. Hands up. If you can put me on the ground, the Golden Foot is yours.",
  ],
};

// Short 2-line script shown when legendary feet are already collected
function _getLegendaryCollectedLines(name) {
  const lines = {
    'Margot Robbie': [
      "You again. Still thinking about the Manolos?",
      "They're not going anywhere. Neither am I. Stay curious.",
    ],
    'Bigfoot (Gary)': [
      "Back again. I respect the dedication.",
      "I'm just Gary. You know where to find me.",
    ],
  };
  return lines[name] ?? ["You've already seen what I've got.", "Take care."];
}

function _getLegendaryLines(name, count) {
  const scripts = {
    'Margot Robbie': [
      [
        "Oh — hi there. You're staring at the shoes. Everyone does eventually.",
        "These Manolos have walked every red carpet you've heard of. They're not just shoes — they're trophies.",
        "If you want them, you're going to have to take them. Hands up.",
      ],
      [
        "Back for round two. I respect that.",
        "I went easy last time. I won't again.",
        "Show me what you've learned.",
      ],
      [
        "Three rounds. The last one decides who walks away with the Manolos.",
        "Bring everything you've got. I'm bringing mine.",
        "Let's go.",
      ],
    ],
    'Bigfoot (Gary)': [
      [
        "...Oh. You can see me. Most people can't. Or won't.",
        "Custom size 22, broken in over a hundred trails. I'm not parting with them quietly.",
        "Put your hands up. Let's settle it the old way.",
      ],
      [
        "You came back. I figured you would.",
        "Last round didn't go great for me. Won't be the same this time.",
        "Hands up.",
      ],
      [
        "Third time's the last time. Win this one and the size 22s are yours.",
        "I'll be honest — I almost respect you. Almost.",
        "Let's go.",
      ],
    ],
  };
  return scripts[name]?.[count] ?? ["..."];
}

function _getSecretLines() {
  return [
    "Ah. You found the alley. Most don't. You weren't looking for me specifically, were you? No. You were just curious. That's exactly right.",
    "I've been here since before the city. I'll be here after. The feet are the oldest part of a person. They carry everything the mind has already forgotten.",
    "Every blister tells you where you've pushed too hard. Every callus tells you where you kept going. The arch tells you who raised you. The toes tell you where you're going.",
    "You've collected quite a few feet. I've been watching your progress. Not in a strange way. In the way that oceans watch ships.",
    "These? These feet have walked the ancient roads. They've been dust and bone and healed again. They carry no brand. They answer to no cobbler.",
    "Look. Take your time. There is nothing that cannot be helped by looking more carefully at what carries you.",
  ];
}

// ── Sound stub — Prompt 07 replaces this body ─────────────────────────────────

export function playDiscoverySound(rarity) {
  console.log(`PLAY SOUND: ${rarity}`);
}

// ── Rarity badge helpers ──────────────────────────────────────────────────────

const BADGE_LABELS = { none:'NONE', common:'COMMON', rare:'RARE', epic:'EPIC', mythic:'MYTHIC', legendary:'LEGENDARY', secret:'???' };

function _setBadge(el, rarity) {
  el.textContent = BADGE_LABELS[rarity] || rarity.toUpperCase();
  el.className   = `dialogue-rarity-badge badge-${rarity}`;
}

// ── UI class ──────────────────────────────────────────────────────────────────

export class UI {
  constructor() {
    _injectCSS();

    // Cache DOM references
    this._el = {
      collection:    document.getElementById('hud-collection'),
      interact:      document.getElementById('hud-interact'),
      lockOverlay:   document.getElementById('lock-overlay'),
      dialoguePanel: document.getElementById('dialogue-panel'),
      dlgName:       document.getElementById('dialogue-npc-name'),
      dlgBadge:      document.getElementById('dialogue-rarity-badge'),
      dlgEncounter:  document.getElementById('dialogue-encounter'),
      dlgText:       document.getElementById('dialogue-text'),
      dlgHint:       document.getElementById('dialogue-hint'),
      discoveryOvl:  document.getElementById('discovery-overlay'),
      discRarity:    document.getElementById('discovery-rarity'),
      discTitle:     document.getElementById('discovery-title'),
      discName:      document.getElementById('discovery-name'),
      discSub:       document.getElementById('discovery-sub'),
      feetdexScreen: document.getElementById('feetdex-screen'),
      feetdexGrid:   document.getElementById('feetdex-grid'),
      fdexCount:     document.getElementById('fdex-count'),
      fdexClose:     document.getElementById('fdex-close-btn'),
      pauseMenu:     document.getElementById('pause-menu'),
      pauseCount:    document.getElementById('pause-count'),
      pauseResume:   document.getElementById('pause-resume'),
      pauseFeetdex:  document.getElementById('pause-feetdex'),
      pauseReset:    document.getElementById('pause-reset'),
      volSlider:     document.getElementById('vol-slider'),
      winScreen:     document.getElementById('win-screen'),
      winList:       document.getElementById('win-list'),
      winPlayAgain:  document.getElementById('win-play-again'),
      winCloseBtn:   document.getElementById('win-close-btn'),
    };

    // Dialogue state
    this._dlgNPC          = null;
    this._dlgLines        = [];
    this._dlgIdx          = 0;
    this._isTyping        = false;
    this._typeTimer       = null;
    this._currentLine     = '';
    this._voiceClassActive = null;

    // Discovery state
    this._pendingEntry = null;

    // Callbacks wired by main.js after construction
    this.onResume        = null; // () => void
    this.onOpenFeetDex   = null; // () => void
    this.onResetProgress = null; // () => void
    this.onVolume        = null; // (val:number) => void
    this.onPlayAgain     = null; // () => void
    this.onWinClose      = null; // () => void

    this._wireButtons();
  }

  // ── HUD ───────────────────────────────────────────────────────────────────

  updateCollection(count, total) {
    this._el.collection.textContent = `Feet collected: ${count} / ${total}`;
  }

  // amount = current balance; nextTarget optional { name, diff } showing the
  // cheapest unowned booster's gap (or 0 if affordable).
  updateGold(amount, nextTarget) {
    const el = document.getElementById('hud-gold');
    if (!el) return;
    if (!nextTarget) {
      el.textContent = `Gold: ${amount} ⛂`;
    } else if (nextTarget.diff <= 0) {
      el.textContent = `Gold: ${amount} ⛂  (can afford: ${nextTarget.name})`;
    } else {
      el.textContent = `Gold: ${amount} ⛂  (next: ${nextTarget.name} +${nextTarget.diff})`;
    }
  }

  // ── Tutorial pointing hand ──────────────────────────────────────────────
  // A single oversized 👇 emoji that follows the active tutorial step's
  // target. main.js drives positioning each frame; this method is just the
  // dumb DOM accessor.

  // mode: 'above' (default) — hand sits above (x,y) and points DOWN (👇).
  //       'below' — hand sits below (x,y) and points UP (👆). Use for
  //                 targets near the top of the viewport (minimap).
  setHandScreenPos(x, y, mode = 'above') {
    const el = document.getElementById('tutorial-hand');
    if (!el) return;
    el.style.left = `${x}px`;
    el.style.top  = `${y}px`;
    el.classList.toggle('hand-below', mode === 'below');
    el.textContent = (mode === 'below') ? '👆' : '👇';
    el.classList.add('active');
  }

  hideHand() {
    const el = document.getElementById('tutorial-hand');
    if (el) el.classList.remove('active');
  }

  // ── Tutorial UI ───────────────────────────────────────────────────────────

  renderTutorial(steps, currentStepIdx, completed, active) {
    const wrap = document.getElementById('tutorial-checklist');
    const rows = document.getElementById('tut-rows');
    if (!wrap || !rows) return;
    if (!active) { wrap.classList.remove('active'); return; }
    wrap.classList.add('active');
    rows.innerHTML = steps.map((s, i) => {
      const done = completed.has(s.id);
      const cls  = done ? 'done' : (i === currentStepIdx ? 'current' : '');
      const box  = done ? '☑' : '☐';
      return `<div class="tut-row ${cls}"><span class="tut-box">${box}</span><span>${s.label}</span></div>`;
    }).join('');
  }

  // Tutorial arrow — visible while pointing at the ESB during step 0.
  // dirDeg is rotation in screen-degrees relative to the player's facing.
  updateTutorialArrow(visible, dirDeg) {
    const el = document.getElementById('tutorial-arrow');
    if (!el) return;
    if (!visible) { el.classList.remove('active'); return; }
    el.classList.add('active');
    const svg = el.querySelector('svg');
    if (svg) svg.style.transform = `rotate(${dirDeg}deg)`;
  }

  // Spawn `count` falling 2D feet (inline SVG) for celebrations. The emoji
  // 🦶 / 👟 rendered inconsistently across systems, so this draws an actual
  // foot silhouette every browser will render the same way. A rain/shower
  // sound plays alongside the fall.
  spawnFeetRain(count = 30) {
    const wrap = document.getElementById('feet-rain');
    if (!wrap) return;
    Audio.rainShower?.(3.6);
    for (let i = 0; i < count; i++) {
      const sz = 28 + Math.random() * 32;
      const drop = document.createElement('div');
      drop.className = 'foot-drop';
      drop.style.left  = `${Math.random() * 100}vw`;
      drop.style.width = `${sz * 0.7}px`;
      drop.style.height = `${sz}px`;
      drop.style.animationDelay = `${Math.random() * 0.8}s`;
      drop.style.animationDuration = `${2.8 + Math.random() * 1.6}s`;
      // Mirror half of them to vary the silhouette (left vs right foot)
      drop.innerHTML = (i % 2)
        ? FOOT_SVG.replace('<svg ', '<svg style="transform:scaleX(-1)" ')
        : FOOT_SVG;
      wrap.appendChild(drop);
      setTimeout(() => drop.remove(), 5000);
    }
  }

  showTutorialComplete() {
    const el = document.getElementById('tutorial-complete');
    if (!el) return;
    el.classList.add('active');
    this.spawnFeetRain(40);
    setTimeout(() => el.classList.remove('active'), 4200);
  }

  // ── Missions UI ───────────────────────────────────────────────────────────

  renderMissions(missions) {
    const wrap = document.getElementById('missions-corner');
    const rows = document.getElementById('mission-rows');
    if (!wrap || !rows) return;
    if (!missions || missions.length === 0) { wrap.classList.remove('active'); return; }
    wrap.classList.add('active');
    rows.innerHTML = missions.map(m => {
      const reward = (m.reward === 'mystery') ? '?' : `${m.reward}⛂`;
      return `<div class="mission-row" data-mid="${m.id}">` +
             `  <span class="m-box">☐</span>` +
             `  <span class="m-text">${m.label}</span>` +
             `  <span class="m-reward">${reward}</span>` +
             `</div>`;
    }).join('');
  }

  // Briefly mark a mission row as complete (green check, scale pulse), then
  // re-render so the next mission can take its slot. Returns a Promise that
  // resolves once the celebration timing is done.
  markMissionComplete(missionId, onAfter) {
    const row = document.querySelector(`#mission-rows [data-mid="${missionId}"]`);
    if (!row) { onAfter?.(); return; }
    row.classList.add('complete');
    const box = row.querySelector('.m-box');
    if (box) box.textContent = '☑';
    this.spawnFeetRain(15);
    setTimeout(() => onAfter?.(), 900);
  }

  // Floating "+N gold" or "-N gold" toast — drifts up and fades.
  showGoldToast(amount) {
    const el = document.getElementById('gold-toast');
    if (!el) return;
    const sign = amount >= 0 ? '+' : '';
    el.textContent = `${sign}${amount} ⛂`;
    el.style.color = amount >= 0 ? '#FFD700' : '#ff5555';
    el.classList.remove('fly');
    // Force reflow so the next class add re-runs the transition
    void el.offsetWidth;
    el.classList.add('fly');
    setTimeout(() => el.classList.remove('fly'), 1300);
  }

  // ── Morton's Shop ─────────────────────────────────────────────────────────

  // Renders the booster cards. `feetdex` is needed for current gold + owned set.
  // `boosterDefs` is the array from feetdex.js. `onBuy(id)` is called on a
  // valid purchase. `mortonLine` is the flavor text shown beneath the cards.
  openShop(feetdex, boosterDefs, onBuy, mortonLine, highlightId = null) {
    const overlay = document.getElementById('morton-shop');
    const cards   = document.getElementById('ms-cards');
    const goldEl  = document.getElementById('ms-gold-display');
    const lineEl  = document.getElementById('ms-morton-line');
    if (!overlay || !cards) return;

    const ICONS = { sprint_feet:'👟', metrocard:'🚇', radar:'📡', compass:'🧭', armor:'🛡', sword:'⚔', ancient_tracker:'⭐' };
    const render = () => {
      goldEl.textContent = `Your gold: ${feetdex.gold} ⛂`;
      cards.innerHTML = '';
      for (const b of boosterDefs) {
        const owned   = feetdex.hasBooster(b.id);
        const canBuy  = !owned && feetdex.gold >= b.price;
        const need    = !owned && !canBuy ? b.price - feetdex.gold : 0;
        const card    = document.createElement('div');
        const hi      = (b.id === highlightId) ? ' ms-highlight' : '';
        card.className = 'ms-card' + (owned ? ' owned' : '') + hi;
        card.innerHTML = `
          <div class="ms-icon">${ICONS[b.id] ?? '?'}</div>
          <div class="ms-name">${b.name}</div>
          <div class="ms-desc">${b.desc}</div>
          <div class="ms-price">${b.price} ⛂</div>
          <button class="ms-buy ${owned ? 'owned' : (canBuy ? '' : 'cant')}">
            ${owned ? 'OWNED' : (canBuy ? 'BUY' : `NEED ${need} MORE`)}
          </button>`;
        const btn = card.querySelector('.ms-buy');
        if (canBuy) btn.addEventListener('click', () => { onBuy(b.id); render(); });
        cards.appendChild(card);
      }
    };
    render();
    if (lineEl) lineEl.textContent = mortonLine ?? '';
    overlay.classList.add('active');
  }

  setShopLine(text) {
    const lineEl = document.getElementById('ms-morton-line');
    if (lineEl) lineEl.textContent = text ?? '';
  }

  closeShop() {
    const overlay = document.getElementById('morton-shop');
    if (overlay) overlay.classList.remove('active');
  }

  get isShopOpen() {
    return document.getElementById('morton-shop')?.classList.contains('active') ?? false;
  }

  // ── Fleet Feet (cosmetic shop) ────────────────────────────────────────────

  openFleetFeetShop(feetdex, catalog, prices, onBuy, onEquip, onUnequip, vanceLine) {
    const overlay = document.getElementById('fleet-feet');
    const cards   = document.getElementById('ff-cards');
    const goldEl  = document.getElementById('ff-gold-display');
    const lineEl  = document.getElementById('ff-vance-line');
    if (!overlay || !cards) return;

    const RARITY_COLORS = {
      common:'#6699cc', rare:'#55aa55', epic:'#aa55cc',
      mythic:'#ff7733', legendary:'#ffd700', secret:'#c8a45a',
    };

    this._fleetRender = () => {
      goldEl.textContent = `Your gold: ${feetdex.gold} ⛂`;
      cards.innerHTML = '';

      // Sort: collected first, then by rarity (common→secret), then by name
      const RARITY_ORDER = ['common','rare','epic','mythic','legendary','secret'];
      const sorted = [...catalog].sort((a, b) => {
        const ac = feetdex.has(a.id) ? 0 : 1;
        const bc = feetdex.has(b.id) ? 0 : 1;
        if (ac !== bc) return ac - bc;
        return RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity);
      });

      for (const e of sorted) {
        const collected = feetdex.has(e.id);
        const owned     = feetdex.hasCosmetic(e.id);
        const equipped  = feetdex.equippedCosmetic === e.id;
        const price     = prices[e.rarity] ?? 0;
        const canBuy    = collected && !owned && feetdex.gold >= price;
        const need      = collected && !owned && !canBuy ? price - feetdex.gold : 0;
        const card      = document.createElement('div');
        const lockedCls = !collected ? ' locked' : '';
        const equipCls  = equipped ? ' equipped' : '';
        card.className  = 'ff-card' + lockedCls + (owned ? ' owned' : '') + equipCls;
        card.innerHTML = `
          <div class="ff-rarity" style="color:${RARITY_COLORS[e.rarity]}">${e.rarity.toUpperCase()}</div>
          <div class="ff-icon" style="color:${RARITY_COLORS[e.rarity]}">${collected ? '👟' : '🔒'}</div>
          <div class="ff-name">${collected ? e.name : '???'}</div>
          <div class="ff-price">${price} ⛂</div>
          <div class="ff-btn-row"></div>`;
        const btnRow = card.querySelector('.ff-btn-row');
        if (!collected) {
          btnRow.innerHTML = `<button class="ff-btn cant">FIND IT FIRST</button>`;
        } else if (!owned) {
          const lbl = canBuy ? 'BUY' : `NEED ${need} MORE`;
          const cls = canBuy ? '' : 'cant';
          const btn = document.createElement('button');
          btn.className = 'ff-btn ' + cls;
          btn.textContent = lbl;
          if (canBuy) btn.addEventListener('click', () => onBuy(e.id));
          btnRow.appendChild(btn);
        } else if (equipped) {
          const btn = document.createElement('button');
          btn.className = 'ff-btn equipped';
          btn.textContent = 'EQUIPPED — UNEQUIP';
          btn.addEventListener('click', () => onUnequip());
          btnRow.appendChild(btn);
        } else {
          const btn = document.createElement('button');
          btn.className = 'ff-btn owned';
          btn.textContent = 'EQUIP';
          btn.addEventListener('click', () => onEquip(e.id));
          btnRow.appendChild(btn);
        }
        cards.appendChild(card);
      }
    };

    this._fleetRender();
    if (lineEl) lineEl.textContent = vanceLine ?? '';
    overlay.classList.add('active');
  }

  setFleetLine(text) {
    const lineEl = document.getElementById('ff-vance-line');
    if (lineEl) lineEl.textContent = text ?? '';
  }

  refreshFleetFeetShop() {
    if (this._fleetRender) this._fleetRender();
  }

  closeFleetFeetShop() {
    const overlay = document.getElementById('fleet-feet');
    if (overlay) overlay.classList.remove('active');
  }

  get isFleetShopOpen() {
    return document.getElementById('fleet-feet')?.classList.contains('active') ?? false;
  }

  // Tracker compass — shown only when Ancient Tracker booster is owned and
  // The Ancient One is uncollected. Updates each frame from main.js.
  updateTrackerCompass(visible, distanceMeters, dirDeg) {
    const el = document.getElementById('tracker-compass');
    if (!el) return;
    if (!visible) { el.classList.remove('active'); return; }
    el.classList.add('active');
    const txt = el.querySelector('#tracker-compass-text');
    if (txt) txt.textContent = `★ FOLLOW THE STAR — ${Math.round(distanceMeters)}m`;
    const svg = el.querySelector('svg');
    if (svg) svg.style.transform = `rotate(${dirDeg}deg)`;
  }

  // Compass-booster pointer — separate element, top-left of screen.
  // distanceMeters may be null/undefined (vague mode — show "?" instead of m).
  updateCompassPointer(visible, label, distanceMeters, dirDeg) {
    const el = document.getElementById('compass-pointer');
    if (!el) return;
    if (!visible) { el.classList.remove('active'); return; }
    el.classList.add('active');
    const txt = el.querySelector('#compass-pointer-text');
    if (txt) {
      txt.textContent = (distanceMeters == null)
        ? `${label} — ???`
        : `${label} — ${Math.round(distanceMeters)}m`;
    }
    const svg = el.querySelector('svg');
    if (svg) svg.style.transform = `rotate(${dirDeg}deg)`;
  }

  // Generic tip popup. theme = 'default' (white/menu), 'mythic' (orange),
  // or 'legendary' (gold). Default if omitted. Dismissed by main.js on E.
  showTip(title, body, theme = 'default') {
    const el    = document.getElementById('generic-tip');
    const tEl   = document.getElementById('tip-title');
    const bEl   = document.getElementById('tip-body');
    if (!el) return;
    el.classList.remove('theme-mythic', 'theme-legendary', 'theme-feetgod');
    if (theme === 'mythic')    el.classList.add('theme-mythic');
    if (theme === 'legendary') el.classList.add('theme-legendary');
    if (theme === 'feetgod')   el.classList.add('theme-feetgod');
    if (tEl) tEl.textContent = title;
    if (bEl) bEl.innerHTML   = body;
    el.classList.add('active');
  }
  hideTip() {
    const el = document.getElementById('generic-tip');
    if (el) el.classList.remove('active');
  }
  get isTipOpen() {
    return document.getElementById('generic-tip')?.classList.contains('active') ?? false;
  }

  // ── Feet God dialogue ─────────────────────────────────────────────────────
  // A divine voice — booming, gold-vignetted, typewriter-driven. Uses the
  // same press-E-to-continue rhythm as character dialogue so the player
  // immediately recognizes it as "someone is talking to you", not a UI tip.

  openFeetGodDialogue(text) {
    const overlay = document.getElementById('feetgod-overlay');
    const txtEl   = document.getElementById('feetgod-text');
    if (!overlay || !txtEl) return;
    overlay.classList.add('active');

    this._fgFullText = text;
    this._fgIsTyping = true;
    txtEl.innerHTML  = '';

    // Typewriter — character by character, with a per-syllable rumble
    // every few chars.
    const SPEED_MS  = 28;
    const RUMBLE_EVERY = 4;
    let i = 0;
    Audio.feetGodBoom();
    if (this._fgTimer) clearInterval(this._fgTimer);
    this._fgTimer = setInterval(() => {
      if (i >= text.length) {
        clearInterval(this._fgTimer);
        this._fgTimer = null;
        this._fgIsTyping = false;
        return;
      }
      i++;
      txtEl.innerHTML = text.slice(0, i);
      // Skip rumble inside HTML tags so the audio doesn't fire 5x for "<br/>"
      const justAdded = text[i - 1];
      if (justAdded && /[A-Za-z0-9]/.test(justAdded) && (i % RUMBLE_EVERY === 0)) {
        Audio.feetGodSyllable();
      }
    }, SPEED_MS);
  }

  // Press-E behavior. Returns 'typing' (skipped typewriter), 'done' (closed).
  advanceFeetGodDialogue() {
    const overlay = document.getElementById('feetgod-overlay');
    const txtEl   = document.getElementById('feetgod-text');
    if (!overlay || !overlay.classList.contains('active')) return 'idle';
    if (this._fgIsTyping) {
      // Snap to end
      if (this._fgTimer) clearInterval(this._fgTimer);
      this._fgTimer = null;
      this._fgIsTyping = false;
      if (txtEl && this._fgFullText) txtEl.innerHTML = this._fgFullText;
      return 'typing';
    }
    overlay.classList.remove('active');
    return 'done';
  }

  get isFeetGodDialogueOpen() {
    return document.getElementById('feetgod-overlay')?.classList.contains('active') ?? false;
  }

  // Battle countdown — pulses 3 → 2 → 1 → FIGHT! Caller tells us which number
  // (or "FIGHT!") to display each step.
  showCountdown(text) {
    const el  = document.getElementById('countdown-overlay');
    const num = document.getElementById('countdown-num');
    if (!el || !num) return;
    el.classList.add('active');
    num.textContent = text;
    num.classList.toggle('go', text === 'FIGHT!');
    // Re-trigger the CSS animation
    num.style.animation = 'none';
    void num.offsetWidth;
    num.style.animation = '';
  }
  hideCountdown() {
    document.getElementById('countdown-overlay')?.classList.remove('active');
  }

  // Compass destination picker — list of every enterable building. onPick is
  // called with the chosen building's { name, wx, wz } when the player clicks.
  openCompassPicker(buildingLabels, onPick) {
    const overlay = document.getElementById('compass-picker');
    const grid    = document.getElementById('cp-grid');
    if (!overlay || !grid) return;
    grid.innerHTML = '';
    for (const lbl of buildingLabels) {
      const btn = document.createElement('button');
      btn.className   = 'cp-btn';
      btn.textContent = lbl.name;
      btn.addEventListener('click', () => { onPick(lbl); });
      grid.appendChild(btn);
    }
    overlay.classList.add('active');
  }
  closeCompassPicker() {
    document.getElementById('compass-picker')?.classList.remove('active');
  }
  get isCompassPickerOpen() {
    return document.getElementById('compass-picker')?.classList.contains('active') ?? false;
  }

  setInteractHint(text) {
    this._el.interact.textContent = text;
    this._el.interact.style.opacity = '1';
  }

  clearInteractHint() {
    this._el.interact.textContent = '[E] Interact';
    this._el.interact.style.opacity = '0.7';
  }

  // ── Lock overlay ──────────────────────────────────────────────────────────

  showLockOverlay() { this._el.lockOverlay.style.display = 'flex'; }
  hideLockOverlay() { this._el.lockOverlay.style.display = 'none'; }

  // ── Dialogue ──────────────────────────────────────────────────────────────

  /**
   * Open dialogue for an NPC.
   * legendaryCount: how many prior encounters (0/1/2) — only used for legendary rarity.
   */
  openDialogue(npc, legendaryCount = 0) {
    this._dlgNPC   = npc;
    this._dlgIdx   = 0;
    this._dlgLines = this._getLines(npc, legendaryCount);

    this._el.dlgName.textContent    = npc.name;
    _setBadge(this._el.dlgBadge, npc.rarity);
    this._el.dlgEncounter.textContent = npc.rarity === 'legendary'
      ? (['1st meeting', '2nd meeting', '3rd meeting'][legendaryCount] ?? '') : '';
    this._el.dlgHint.textContent    = '[E] Continue';

    // Voice class — animates name label for mythic/legendary/secret
    if (this._voiceClassActive) this._el.dialoguePanel.classList.remove(this._voiceClassActive);
    this._voiceClassActive = _voiceClass(npc.feetId, npc.rarity);
    if (this._voiceClassActive) this._el.dialoguePanel.classList.add(this._voiceClassActive);

    this._el.dialoguePanel.classList.add('active');
    this._typeLine(this._dlgLines[0]);

    // Start per-NPC voice and animation
    npc.startVoice?.(this._dlgLines[0]);
    npc.startAnimation?.();
  }

  /**
   * Called when E is pressed while dialogue is open.
   * Returns:
   *   'typing'         — skipped typewriter; wait for another E
   *   'next'           — advanced to next line
   *   'done'           — all lines, no feet (none rarity or legendary incomplete)
   *   'discover'       — all lines done, common/rare/epic → show discovery overlay
   *   'challenge'      — mythic last line done → launch minigame
   *   'legendary_done' — legendary dialogue complete (encounter registered externally)
   */
  advanceDialogue() {
    if (this._isTyping) {
      this._skipTyping();
      return 'typing';
    }

    this._dlgIdx++;

    if (this._dlgIdx < this._dlgLines.length) {
      this._typeLine(this._dlgLines[this._dlgIdx]);
      this._dlgNPC?.nextVoiceLine?.(this._dlgLines[this._dlgIdx]);
      const isLast = (this._dlgIdx === this._dlgLines.length - 1);
      if (isLast) {
        const r = this._dlgNPC.rarity;
        if      (r === 'mythic')    this._el.dlgHint.textContent = '[E] Accept Challenge';
        else if (r === 'none' || r === 'legendary')
                                    this._el.dlgHint.textContent = '[E] Close';
      }
      return 'next';
    }

    // Past the last line — resolve outcome
    const r = this._dlgNPC?.rarity;  // capture before closeDialogue nulls _dlgNPC
    this.closeDialogue();
    if (r === 'mythic')                             return 'challenge';
    if (['common','rare','epic','secret'].includes(r)) return 'discover';
    if (r === 'legendary')                          return 'legendary_done';
    return 'done';
  }

  closeDialogue() {
    this._clearTyping();
    // Stop NPC voice and animation
    this._dlgNPC?.stopVoice?.();
    this._dlgNPC?.stopAnimation?.();
    if (this._voiceClassActive) {
      this._el.dialoguePanel.classList.remove(this._voiceClassActive);
      this._voiceClassActive = null;
    }
    this._el.dialoguePanel.classList.remove('active');
    this._dlgNPC = null;
  }

  get isDialogueOpen() { return this._el.dialoguePanel.classList.contains('active'); }

  // ── Discovery overlay ─────────────────────────────────────────────────────

  /**
   * Show the rarity-appropriate full-screen discovery overlay.
   * feetEntry: object from FEET_CATALOG  |  npc: the NPC whose feet were found
   */
  showDiscovery(feetEntry, npc) {
    this._pendingEntry = feetEntry;
    const rarity  = feetEntry.rarity;
    const overlay = this._el.discoveryOvl;

    // Clear previous rarity class
    overlay.className = overlay.className.replace(/\bdiscover-\S+/g, '').trim();
    overlay.classList.add('discover-' + rarity);

    // Set content
    this._el.discRarity.textContent = rarity === 'secret'
      ? '??? SECRET FOUND ???'
      : (BADGE_LABELS[rarity] ?? rarity.toUpperCase());
    this._el.discRarity.className   = 'r-' + rarity;
    this._el.discTitle.textContent  = rarity === 'legendary' ? 'LEGENDARY FEET DISCOVERED!'
                                    : rarity === 'secret'    ? ''
                                    : 'DISCOVERED!';
    this._el.discName.textContent   = feetEntry.name;
    this._el.discSub.textContent    = (rarity === 'legendary' || rarity === 'secret')
      ? 'Only seen by those who look twice... three times.'
      : `Spotted on: ${npc.name}`;

    // Clean up leftovers from previous show, then inject new effects
    overlay.querySelectorAll('._disc-fx').forEach(el => el.remove());
    this._addDiscoveryFX(rarity, overlay);

    overlay.classList.add('active');
    playDiscoverySound(rarity);
  }

  /**
   * Called on E press while discovery overlay is open.
   * Returns the feet entry so main.js can call feetdex.collect(id).
   */
  confirmDiscovery() {
    const entry = this._pendingEntry;
    this._pendingEntry = null;
    const overlay = this._el.discoveryOvl;
    overlay.querySelectorAll('._disc-fx').forEach(el => el.remove());
    overlay.classList.remove('active');
    overlay.className = overlay.className.replace(/\bdiscover-\S+/g, '').trim();
    return entry;
  }

  get isDiscoveryOpen() { return this._el.discoveryOvl.classList.contains('active'); }

  // ── FeetDex screen ────────────────────────────────────────────────────────

  openFeetDex(feetdex) {
    this._buildGrid(feetdex);
    this._el.feetdexScreen.classList.add('active');
  }

  closeFeetDex() { this._el.feetdexScreen.classList.remove('active'); }

  get isFeetDexOpen() { return this._el.feetdexScreen.classList.contains('active'); }

  // ── Pause menu ────────────────────────────────────────────────────────────

  openPause(feetdex) {
    this._el.pauseCount.textContent = `Feet collected: ${feetdex.count} / ${feetdex.total}`;
    this._el.pauseMenu.classList.add('active');
  }

  closePause() { this._el.pauseMenu.classList.remove('active'); }

  get isPauseOpen() { return this._el.pauseMenu.classList.contains('active'); }

  // ── Win screen ────────────────────────────────────────────────────────────

  showWinScreen(feetdex) {
    const list = this._el.winList;
    list.innerHTML = '';

    // ── Budgeting portfolio — earned vs. spent breakdown + feedback ────────
    const earned = feetdex.totalEarned;
    const tools  = feetdex.totalSpentTools;
    const skins  = feetdex.totalSpentSkins;
    const saved  = feetdex.gold;
    const totalSpent = tools + skins;
    const ownedBoosters = feetdex.boosters.size;
    const totalBoosters = BOOSTER_DEFS.length;
    const ownedSkins = feetdex.cosmetics.size;

    // Pick the dominant spending pattern and write feedback prose around it.
    // The advice is the *educational* part — name what they did, then say
    // what a better budgeter would have considered.
    const verdicts = [];
    if (ownedBoosters === totalBoosters) {
      verdicts.push({ tone:'good', msg:`Bought every tool (${ownedBoosters}/${totalBoosters}) — that's the optimal budget for this run. Compounding works.` });
    } else if (ownedBoosters >= Math.ceil(totalBoosters * 0.6)) {
      verdicts.push({ tone:'good', msg:`Solid tool kit (${ownedBoosters}/${totalBoosters} boosters). You spent on what made you faster instead of what made you look good.` });
    } else if (ownedBoosters <= 1 && earned >= 100) {
      verdicts.push({ tone:'bad',  msg:`Only ${ownedBoosters}/${totalBoosters} boosters owned. You earned ${earned}⛂ and let it sit — leaving tools on the shelf is a hidden cost.` });
    } else {
      verdicts.push({ tone:'warn', msg:`Bought ${ownedBoosters}/${totalBoosters} boosters. Halfway investing means halfway compounding — next run, lock in the cheap ones first.` });
    }

    if (skins > tools && tools < 100) {
      verdicts.push({ tone:'bad',  msg:`Spent more on skins (${skins}⛂) than tools (${tools}⛂). Drip is fun, but tools pay you back in time saved.` });
    } else if (skins > 0 && tools >= 200) {
      verdicts.push({ tone:'good', msg:`Treated yourself (${skins}⛂ on skins) AFTER funding the tools (${tools}⛂). Textbook discretionary-after-essentials.` });
    } else if (ownedSkins === 0 && saved >= 50 && ownedBoosters === totalBoosters) {
      verdicts.push({ tone:'warn', msg:`Skipped every cosmetic. Sometimes the right choice — but money you'll never spend is also wasted opportunity.` });
    }

    if (saved >= earned * 0.4 && earned >= 200) {
      verdicts.push({ tone:'warn', msg:`Hoarded ${saved}⛂ (${Math.round(saved / earned * 100)}% of total income). Cash sitting still earns nothing — invest or enjoy it.` });
    } else if (saved <= earned * 0.05 && totalSpent > 0) {
      verdicts.push({ tone:'good', msg:`Almost zero left over. Tight budgeting — every coin pulled its weight.` });
    }

    const vClass = (tone) => tone === 'good' ? 'v-good' : tone === 'bad' ? 'v-bad' : 'v-warn';
    const portfolioHTML = `
      <div id="win-portfolio">
        <h3>BUDGET PORTFOLIO</h3>
        <div class="wp-row"><span>Total earned</span><span class="wp-num">${earned} ⛂</span></div>
        <div class="wp-row"><span>Spent on tools (Morton's)</span><span class="wp-num">${tools} ⛂</span></div>
        <div class="wp-row"><span>Spent on skins (Fleet Feet)</span><span class="wp-num">${skins} ⛂</span></div>
        <div class="wp-row wp-saved"><span>Cash on hand</span><span class="wp-num">${saved} ⛂</span></div>
        <div class="wp-bar">
          <div class="wp-seg wp-seg-tools" style="flex:${tools}"></div>
          <div class="wp-seg wp-seg-skins" style="flex:${skins}"></div>
          <div class="wp-seg wp-seg-saved" style="flex:${saved}"></div>
        </div>
        <div class="wp-legend">
          <span><span class="wp-dot wp-dot-tools"></span>tools</span>
          <span><span class="wp-dot wp-dot-skins"></span>skins</span>
          <span><span class="wp-dot wp-dot-saved"></span>saved</span>
        </div>
        <div class="wp-verdicts">
          ${verdicts.map(v => `<div class="wp-verdict ${vClass(v.tone)}">${v.msg}</div>`).join('')}
        </div>
      </div>`;
    // Clear any prior portfolio from a previous run, then inject fresh one
    // before the list of collected feet.
    const oldPortfolio = document.getElementById('win-portfolio');
    if (oldPortfolio) oldPortfolio.remove();
    list.insertAdjacentHTML('beforebegin', portfolioHTML);

    for (const e of feetdex.getAll()) {
      if (!e.collected) continue;
      const d = document.createElement('div');
      d.className = 'win-entry';
      d.innerHTML = `<div class="w-rarity r-${e.rarity}">${e.rarity.toUpperCase()}</div>
                     <div class="w-name">${e.name}</div>`;
      list.appendChild(d);
    }
    this._el.winScreen.classList.add('active');
  }

  // ── Private: typewriter ───────────────────────────────────────────────────

  _typeLine(text) {
    this._clearTyping();
    this._currentLine = text;
    this._isTyping    = true;
    this._el.dlgText.textContent = '';
    let i = 0;
    const npcId  = this._dlgNPC?.feetId ?? '';
    const rarity = this._dlgNPC?.rarity ?? 'none';
    const speed  = _typeSpeed(npcId, rarity);
    this._typeTimer = setInterval(() => {
      this._el.dlgText.textContent += text[i++];
      if (i >= text.length) this._clearTyping();
    }, speed);
  }

  _skipTyping() {
    this._clearTyping();
    this._el.dlgText.textContent = this._currentLine;
  }

  _clearTyping() {
    if (this._typeTimer) { clearInterval(this._typeTimer); this._typeTimer = null; }
    this._isTyping = false;
  }

  // ── Private: dialogue script lookup ──────────────────────────────────────

  _getLines(npc, legendaryCount) {
    // Named mission NPCs override the random NONE chatter — they have
    // scripted dialogue teaching budgeting/business concepts or NYC fun
    // facts. The mission system trades 20g for finishing one of these.
    if (npc.feetId && MISSION_NPC_SCRIPTS[npc.feetId]) {
      return MISSION_NPC_SCRIPTS[npc.feetId];
    }
    switch (npc.rarity) {
      case 'none':      return [NONE_LINES[Math.floor(Math.random() * NONE_LINES.length)]];
      case 'common':    return COMMON_SCRIPTS[npc.feetId] ?? ["Nice kicks.", "Can't go wrong with the classics."];
      case 'rare':      return RARE_SCRIPTS[npc.feetId]   ?? ["Let me tell you about these.", "Real craftsmanship.", "Worth every penny."];
      case 'epic':      return EPIC_SCRIPTS[npc.feetId]   ?? ["You have taste.", "Not off the shelf.", "Long story.", "You wouldn't believe me."];
      case 'mythic':    return MYTHIC_SCRIPTS[npc.feetId] ?? MYTHIC_SCRIPTS['m1'];
      case 'legendary':
        if (npc.feetCollected) return _getLegendaryCollectedLines(npc.name);
        return _getLegendaryLines(npc.name, legendaryCount); // 0-indexed: 0=1st, 1=2nd, 2=3rd
      case 'secret':    return _getSecretLines();
      default:          return ["..."];
    }
  }

  // ── Private: rarity discovery effects (JS-generated elements) ────────────

  _addDiscoveryFX(rarity, overlay) {
    const mk  = (cls) => { const d = document.createElement('div'); d.className = cls + ' _disc-fx'; return d; };
    const add = (el)  => { overlay.appendChild(el); return el; };

    if (rarity === 'common') {
      add(mk('_disc-flash'));
    }

    if (rarity === 'rare') {
      add(mk('_rare-ring'));
    }

    if (rarity === 'epic') {
      for (let i = 0; i < 3; i++) {
        const wave = mk('_shimmer-wave');
        wave.style.top            = `${25 + i * 25}%`;
        wave.style.animationDelay = `${i * 0.15}s`;
        add(wave);
      }
    }

    if (rarity === 'mythic') {
      for (let i = 0; i < 8; i++) {
        const ray = mk('_burst-ray');
        Object.assign(ray.style, {
          left:            'calc(50% - 1.5px)',
          top:             '50%',
          height:          '0',
          transformOrigin: 'top center',
          transform:       `rotate(${i * 45}deg)`,
          animation:       `disc-burst .4s ${i * 0.03}s ease-out forwards`,
        });
        add(ray);
      }
    }

    if (rarity === 'legendary') {
      add(mk('_legend-glow'));
      const corners = [
        { top:'8%',    left:'8%',  borderTop:'2px solid #ffd700', borderLeft:'2px solid #ffd700' },
        { top:'8%',    right:'8%', borderTop:'2px solid #ffd700', borderRight:'2px solid #ffd700' },
        { bottom:'8%', left:'8%',  borderBottom:'2px solid #ffd700', borderLeft:'2px solid #ffd700' },
        { bottom:'8%', right:'8%', borderBottom:'2px solid #ffd700', borderRight:'2px solid #ffd700' },
      ];
      for (const c of corners) {
        const acc = document.createElement('div');
        acc.className = '_corner-acc _disc-fx';
        Object.assign(acc.style, { position:'absolute', ...c });
        overlay.appendChild(acc);
      }
    }

    if (rarity === 'secret') {
      // Full-screen white flash (body-level, outside the overlay)
      const flash = document.createElement('div');
      flash.className = '_secret-flash';
      document.body.appendChild(flash);
      setTimeout(() => flash.remove(), 800);

      // Orbiting star ring
      const ring = mk('_star-ring');
      const R = 75;
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
        const star  = document.createElement('div');
        star.className = '_star';
        star.style.left = `${R + R * Math.cos(angle) - 4}px`;
        star.style.top  = `${R + R * Math.sin(angle) - 4}px`;
        ring.appendChild(star);
      }
      add(ring);
    }
  }

  // ── Private: FeetDex grid builder ─────────────────────────────────────────

  _buildGrid(feetdex) {
    const grid = this._el.feetdexGrid;
    grid.innerHTML = '';
    this._el.fdexCount.textContent = `${feetdex.count} / ${feetdex.total}`;

    for (const entry of feetdex.getAll()) {
      const slot = document.createElement('div');
      slot.className = 'fdex-slot'
        + (entry.rarity === 'legendary' || entry.id === 's1' ? ' legendary-slot' : '')
        + (entry.collected ? ' unlocked' : '');

      if (entry.id === 's1' && !entry.collected) slot.classList.add('secret-shimmer');

      if (entry.collected) {
        slot.innerHTML = `
          <svg viewBox="0 0 100 120" fill="currentColor" class="r-${entry.rarity}">
            <rect x="16" y="30" width="68" height="65" rx="18"/>
            <ellipse cx="50" cy="92" rx="34" ry="20"/>
            <circle cx="22" cy="28" r="11"/><circle cx="37" cy="20" r="13"/>
            <circle cx="53" cy="17" r="12"/><circle cx="68" cy="21" r="10"/>
            <circle cx="79" cy="30" r="9"/>
          </svg>
          <div class="slot-rarity r-${entry.rarity}">${entry.rarity.toUpperCase()}</div>
          <div class="slot-name">${entry.name}</div>`;
      } else {
        slot.innerHTML = `<div class="slot-lock">&#128247;</div><div class="slot-name">???</div>`;
      }
      grid.appendChild(slot);
    }
  }

  // ── Private: button wiring ────────────────────────────────────────────────

  _wireButtons() {
    this._el.pauseResume.addEventListener('click', () => {
      this.closePause();
      this.onResume?.();
    });
    this._el.pauseFeetdex.addEventListener('click', () => {
      this.closePause();
      this.onOpenFeetDex?.();
    });
    this._el.pauseReset.addEventListener('click', () => {
      if (confirm('Reset all progress? This cannot be undone.')) this.onResetProgress?.();
    });
    this._el.volSlider.addEventListener('input', e => this.onVolume?.(parseFloat(e.target.value)));
    this._el.fdexClose.addEventListener('click', () => this.closeFeetDex());
    this._el.winPlayAgain.addEventListener('click', () => {
      this._el.winScreen.classList.remove('active');
      this.onPlayAgain?.();
    });
    this._el.winCloseBtn.addEventListener('click', () => {
      this._el.winScreen.classList.remove('active');
      this.onWinClose?.();
    });
  }
}

// ── Confetti (win screen) ─────────────────────────────────────────────────────

function _startConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  const ctx    = canvas.getContext('2d');
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;

  const COLS = ['#ffd700','#ff6d00','#4caf50','#ce93d8','#5577aa','#ff00cc'];
  const pcs  = Array.from({ length: 130 }, () => ({
    x: Math.random() * canvas.width,
    y: -Math.random() * canvas.height * 0.6,
    w: 6 + Math.random() * 8, h: 5 + Math.random() * 7,
    vy: 2 + Math.random() * 3, vx: (Math.random() - 0.5) * 1.5,
    r: Math.random() * Math.PI * 2, dr: (Math.random() - 0.5) * 0.1,
    col: COLS[Math.floor(Math.random() * COLS.length)],
  }));

  (function frame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = 0;
    for (const p of pcs) {
      p.x += p.vx; p.y += p.vy; p.r += p.dr;
      if (p.y < canvas.height + 20) alive++;
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.fillStyle = p.col;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (alive > 0) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  })();
}
