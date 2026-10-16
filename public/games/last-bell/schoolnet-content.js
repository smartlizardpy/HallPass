// LAST BELL - everything the SCHOOLNET computers say, plus the friends' easter eggs. Edit freely.
// Owned by the main agent. Real people appear only as written here (see the README's credits):
// Mr Ahmet Hoca (Computing, Robotics mentor), Mr Ahmet Başkan (a parent), Mr Hasan P. (Politics),
// and the students. Keep it friendly: none of them is part of the dark side of the school.
//
// Placeholders in mail bodies are filled in per run by computers.js:
//   {leakName} {leakUser} {leakPass}  another computer's owner and login (Mr Ahmet Hoca's "leak")
//   {psRoom}      where the confiscated PlayStation is      {room000Hint}  where Room 000's door appears
//   {graffitiRoom} where the glow-paint tag is               {rounds}       the caretaker's next stops

export const STUDENTS = ['Ozan', 'Egemen', 'Ateş', 'Sohan', 'Stewart', 'Charlotte', 'Kaan', 'Kaan'];

// Computer owners, in the order they are handed out (library computers always go to the librarian).
export const STAFF = {
  hoca: { name: 'Mr Ahmet Hoca', role: 'Computing', user: 'ahmet.hoca', words: ['robot', 'arduino', 'python', 'turtle'] },
  hasan: { name: 'Mr Hasan P.', role: 'Politics', user: 'hasan.p', words: ['debate', 'ballot', 'chat', 'stream'] },
  librarian: { name: 'Ms Lennox', role: 'Library', user: 'lennox', words: ['shhh', 'overdue', 'quiet', 'books'] },
  extra: [
    { name: 'Mrs Holloway', role: 'English', user: 'holloway', words: ['macbeth', 'poetry', 'grammar'] },
    { name: 'Mr Brandt', role: 'Maths', user: 'brandt', words: ['algebra', 'fractions', 'pi'] },
    { name: 'Ms Doyle', role: 'Geography', user: 'doyle', words: ['volcano', 'atlas', 'rivers'] },
  ],
};
export const PASS_DIGITS = ['33', '83', '00', '13', '42', '99'];

// What a broadcast says (the subtitle; the recording is announcement_caretaker.mp3, see the cast sheet).
export const BROADCAST = {
  announcement: 'Would the caretaker please attend to a spillage in the main hall. Thank you.',
};

export const SESSION_SECONDS = 45;
export const WIFI_BONUS = 20; // Mia's promise: every session after voting for her is this much longer
export const MAX_TRIES = 3;

export const APPS = [
  { id: 'cameras', key: '1', name: 'Security cameras', desc: 'See the corridors. He shows up on camera.' },
  { id: 'announce', key: '2', name: 'Announcements', desc: 'Play a message or a song somewhere else. He goes to check. Once per computer.' },
  { id: 'inventory', key: '3', name: 'Maintenance', desc: 'Where the school keeps things.' },
  { id: 'election', key: '4', name: 'Student council election', desc: "Vote. The winner's promise comes true." },
  { id: 'mail', key: '5', name: 'Mail', desc: 'Staff mail. People overshare.' },
];

// What each candidate's promise does once you vote for them (ballot + results text).
export const PROMISES = {
  mia: { perk: 'wifi', effect: 'Every computer session lasts 20 seconds longer.' },
  chloe: { perk: 'vending', effect: 'The vending machine in reception works again: one free can, full stamina.' },
  tovbe: { perk: 'doner', effect: 'A döner shop opens in the school: a free döner, full stamina and 20 s of unlimited sprint. Follow the glowing signs.' },
};

// "Live coverage with Mr Hasan P." on the results screen (school-election jokes only).
export const COVERAGE = {
  intro: 'Live coverage with Mr Hasan P., Politics',
  lines: [
    'Turnout: three students and whoever keeps ringing the bell. Tövbe takes it with 99.7%.',
    "The döner policy is completely unfunded, and he's winning anyway.",
    "Mia's Wi-Fi plan was fully costed. Nobody read it.",
    "Chloe's vending-machine coalition fell apart at 3:31.",
  ],
  // the player's own vote, and what happens because of it
  byVote: {
    mia: 'One brave vote for Mia. The Wi-Fi gets switched on anyway, as a consolation.',
    chloe: "A vote for Chloe! Reception's vending machine is back on, out of pure spite.",
    tovbe: 'Another vote for Tövbe. The döner shop is open. Of course it is.',
  },
};

export const MAIL = [
  {
    id: 'stickies', from: 'Mr Ahmet Hoca', to: 'All staff', subject: 'PLEASE stop writing your passwords on sticky notes',
    body:
      'Dear colleagues,\n\nI have found three sticky notes with SCHOOLNET passwords on them this week. One was stuck to the screen.\n\n' +
      '{leakName}, yours is still "{leakPass}" (user: {leakUser}). Please change it before somebody uses it.\n\n' +
      'Mr Ahmet Hoca\nComputing / SCHOOLNET',
  },
  {
    id: 'robotics', from: 'Mr Ahmet Hoca', to: 'Robotics team', subject: 'Proud of you all',
    body:
      'Great work at the regional finals, team. Third place, with a robot held together by tape and hope.\n\n' +
      'Egemen, the wheel came off and you kept driving. Ozan, the code worked on the first try (once).\n\n' +
      'Proud of you all. See you Thursday!\nMr Ahmet Hoca',
  },
  {
    id: 'playstation', from: 'Mr Ahmet Başkan (parent)', to: 'Mr Ahmet Hoca', subject: 'Kaan and the PlayStation',
    body:
      'Dear teacher,\n\nPlease make my son stop playing PlayStation. He does not do his homework. ' +
      'Every day he says "one more match, baba". Last night it was eleven matches.\n\n' +
      'Thank you very much.\nAhmet Başkan (Kaan\'s dad)',
  },
  {
    id: 'playstation-re', from: 'Mr Ahmet Hoca', to: 'Mr Ahmet Başkan (parent)', subject: 'Re: Kaan and the PlayStation',
    body:
      'Dear Mr Başkan,\n\nWe have two Kaans in Year 9. Honestly, it is probably both of them. I will have a word.\n\n' +
      'I confiscated a PlayStation today. It is on my desk in {psRoom} until Friday.\n\nKind regards,\nMr Ahmet Hoca',
  },
  {
    id: 'election', from: 'Mr Hasan P.', to: 'Year 9', subject: 'Election night coverage',
    body:
      'Live coverage of the student council results starts at 3:30 on SCHOOLNET.\n\n' +
      'Debate Club is cancelled (again) because Ozan and Kaan turned the last one into a two-hour argument about döner versus lahmacun.\n\n' +
      'Vote! This year the winner\'s promise actually gets delivered.\n\nMr Hasan P., Politics',
  },
  {
    id: 'room000', from: 'School Office', to: 'All staff', subject: 'Room 000',
    body:
      'There is no Room 000. Please stop sending pupils there.\n\n' +
      'Whoever keeps drawing a door on the wall {room000Hint}: please stop. It is not funny.\n\nThe School Office',
  },
  {
    id: 'graffiti', from: 'Facilities', to: 'All staff', subject: 'Graffiti (again)',
    body:
      'Someone has painted EGEMEN WAS HERE in the {graffitiRoom} in glow-in-the-dark paint.\n\n' +
      'We can only see it with the lights off. If anyone knows an Egemen, please send him to the office.\n\nFacilities',
  },
  {
    id: 'library', from: 'Ms Lennox', to: 'All staff', subject: 'Overdue books',
    body:
      'Sohan, Ateş, Stewart and Charlotte still have library books out. The return trolley is by the door.\n\n' +
      'Also, could whoever is in the library after hours please stop re-shelving the atlases. They are back in the wrong order every morning.\n\nMs Lennox',
  },
  {
    id: 'rounds', from: 'Caretaker', to: 'Facilities', subject: "Tonight's rounds",
    body: "Rounds tonight, in this order:\n\n{rounds}\n\nThe bell went off by itself at 3:33 again. Fuses keep going missing. I'll check the lockers on the way.",
  },
];

// The Room 000 register (on the desk next to the chair with the exit key).
export const REGISTER = {
  title: 'Room 000: attendance',
  footer: 'One line at the bottom is still blank.',
};

// First-time tips: shown once per player (remembered in localStorage), never again.
export const TIPS = {
  computer: { title: 'SCHOOLNET', text: 'Teachers write their passwords on sticky notes. Look around this room for one.' },
  note: { title: 'A login', text: "Type it into this room's computer. Each computer lets you in once, for 45 seconds." },
  terminal: { title: 'SCHOOLNET', text: 'The school keeps going while you type. Esc logs you out if he comes.' },
  playstation: { title: "Kaan's PlayStation", text: 'Press G (or the PS button) to put it down and switch it on. He can\'t resist it.' },
  register: { title: 'The register', text: 'Sign it and he stops hunting you. It works once.' },
  mic: { title: 'He heard that', text: 'Your microphone is on. Keep your voice down, or hold your breath (hide).' },
  doner: { title: 'TÖVBE DÖNER', text: 'The döner shop is open. Follow the glowing signs with his face on them.' },
  vending: { title: 'Vending machine', text: 'Reception: one free can. It lands with a loud clunk.' },
  wifi: { title: 'Free Wi-Fi', text: 'Every computer session from now on lasts 20 seconds longer.' },
};
