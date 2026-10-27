// LAST BELL — everything the Floor 2 puzzles and secrets say (Second Floor update). Owned by the GAME
// workstream. Edit freely; floor2.js and security-pc.js read it.
//
// Lore rules: every name here is fictional except as the existing lore allows (Mr Ahmet Hoca runs
// SCHOOLNET; no other real people). The Founder is only ever "the Founder". These texts add to the old
// hints (the bell rings by itself at 3:33, fuses go missing, the register has one blank line, Room 000
// "doesn't exist") and never contradict them. New: the Caretaker was not always alone.
//
// The Assistant is the school's lunch monitor: a too-friendly woman in a hairnet and a pink tabard.

// ------------------------------------------------------------------------------ the security login
export const SEC_USER = 'security';
/** One per seed. Lower case, easy to type on a phone. */
export const PASSWORDS = ['thermos', 'lanyard', 'nightowl', 'keyring', 'mopbucket', 'boiler62'];

/** The login note, by clue spot. Each is a showCard() payload; {pass} is filled in per run. */
export const LOGIN_CLUES = {
  'clue-login-english': {
    room: 'English room',
    title: 'Slipped inside a planner',
    lines: ['NIGHT COVER: if security calls in sick, the office PC login is', 'user: security', 'password: {pass}', 'Founder\'s orders: Stairwell A stays sealed after the bell.', 'Please do NOT keep this in my planner. — Mrs Holloway'],
  },
  'clue-login-lab': {
    room: 'Computer lab',
    title: 'Taped inside the network cabinet',
    lines: ['SCHOOLNET 2000 — security workstation', 'user: security   pass: {pass}', 'This is the last time I reset it. Please stop writing it down.', '(Stairwell A stays sealed after the bell. Founder\'s orders, not mine.)', '— Mr Ahmet Hoca (written on a sticky note)'],
  },
  'clue-login-staffroom': {
    room: 'Staffroom',
    title: 'In a pigeonhole marked SECURITY',
    lines: ['Handover, night shift:', 'Workstation login is still security / {pass}.', 'Founder\'s orders: Stairwell A stays sealed after the bell.', 'Someone left a tray of school dinner on the desk again. Still warm. Not mine.', '— R. (agency)'],
  },
  'clue-login-office': {
    room: 'School office',
    title: 'Clipped to the visitors’ book',
    lines: ['For the fire inspector’s visit (Security Office):', 'Username: security', 'Password: {pass}', 'Founder\'s orders: Stairwell A stays sealed after the bell.', 'Shred after use. — School Office'],
  },
};

// ------------------------------------------------------------------------------ breakers
/** Hand-checked configurations (index 0 = breaker 1). Every one has 2 SEC. OFFICE + 5 SEC. CCTV on, 4 FIRE ALARM off. */
export const BREAKER_CONFIGS = [
  [1, 1, 0, 0, 1, 0, 1, 0],
  [0, 1, 1, 0, 1, 0, 0, 0],
  [1, 1, 0, 0, 1, 1, 0, 0],
  [0, 1, 0, 0, 1, 0, 1, 1],
  [0, 1, 1, 0, 1, 1, 0, 1],
  [1, 1, 0, 0, 1, 0, 0, 1],
];
export const BREAKER_CLUE_SPOTS = {
  'clue-breaker-staffroom': { room: 'Staffroom', where: 'pinned to the staffroom noticeboard' },
  'clue-breaker-prep': { room: 'Science prep room', where: 'stuck to the prep room fridge' },
  'clue-breaker-office': { room: 'School office', where: 'in the school office in-tray' },
};

/** The torn sheet: which switches must be ON (generated from the configuration, so it always matches). */
export function breakerClue(config, labels) {
  const on = [];
  config.forEach((v, i) => v && on.push(`${i + 1}  ${labels[i]}`));
  return {
    kind: 'note',
    title: 'CIRCUIT MAP: SECURITY',
    lines: ['(torn off the sub-board door)', 'For the security office, these ON:', ...on, 'Everything else OFF. Do NOT turn on 4. — J.'],
    footer: 'The maintenance room breaker panel.',
  };
}

// ------------------------------------------------------------------------------ combination lockers
/** Fictional staff and their birthdays on the staffroom calendar (day/month are seeded per run). */
export const CALENDAR_STAFF = ['Ms Lennox', 'Mrs Holloway', 'Mr Brandt', 'Ms Doyle', 'Mr Okafor', 'Mrs Pryce'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September'];

export const LOCKERS = {
  'locker-staff': { door: 'locker', room: 'Staffroom', note: 'Combination: my birthday (day, month).' },
  'locker-north': { door: 'locker', room: 'North Hall', tag: 'LOCKER 2-17', note: 'Code = the maths board answers, in order. Mr Brandt never rubs it off.' },
  'locker-cabinet': { door: 'cabinet', room: "Principal's office", tag: 'SCHOOL HISTORY', note: '' },
};
export const PLAQUE_EVENTS = [
  { key: 'wing', text: 'North wing opened', lo: 1966, hi: 1979 },
  { key: 'floor', text: 'Second floor opened', lo: 1980, hi: 1989 },
  { key: 'refurb', text: 'Refurbished', lo: 1990, hi: 1997 },
];

/** The staffroom birthday calendar (the staff locker's code is its owner's day + month). */
export function calendarClue(rows) {
  return {
    kind: 'note',
    title: 'STAFF BIRTHDAYS',
    lines: ['(a calendar on the staffroom wall, with cake doodles)', ...rows.map((r) => `${r.name} ........ ${r.day} ${MONTHS[r.month - 1]}`)],
    footer: 'Someone has added a name at the bottom in pink felt-tip, then rubbed it out.',
  };
}

/** The maths blackboard: three sums whose answers are the North Hall locker's digits. */
export function blackboardClue(sums) {
  return {
    kind: 'note',
    title: 'MENTAL MATHS — Mr Brandt',
    lines: ['(chalk on the blackboard, not rubbed off)', ...sums.map((s, i) => `${i + 1})  ${s} = ?`), 'Show your working!'],
    footer: 'Under it, small and neat: "I always know how many of you there are."',
  };
}

/** The founding plaque in the school office (the cabinet's code is the last three digits of one year). */
export function plaqueClue(years) {
  return {
    kind: 'note',
    title: 'FOUNDING PLAQUE',
    lines: ['(brass, screwed to the office wall)', 'This school was opened in 1962.', ...PLAQUE_EVENTS.map((e) => `${e.text} ${years[e.key]}.`), '"No child left behind."'],
    footer: 'Polished. Somebody polishes it every night.',
  };
}
export function cabinetNote(eventKey) {
  const e = PLAQUE_EVENTS.find((x) => x.key === eventKey) || PLAQUE_EVENTS[1];
  return `Combination: the year the ${e.text.replace(' opened', '').replace('Refurbished', 'refurbishment').toLowerCase()} — last 3 digits.`;
}

// ------------------------------------------------------------------------------ the staff card
export const CARD_SPOTS = {
  'card-library-desk': { room: 'Library', where: 'on the library checkout desk' },
  'card-staff-locker': { room: 'Staffroom', where: 'in a staff locker in the staffroom' },
  'card-2c-desk': { room: 'Classroom 2C', where: 'on the teacher’s desk in 2C' },
  'card-art-desk': { room: 'Art room', where: 'on a table in the art room' },
  'card-lost-property': { room: 'Lost property', where: 'in the lost property box' },
};
export const CARD_TEXT = {
  staff: { title: 'Staff access card', lines: ['STAFF ACCESS · No. 0333', 'Opens the card-reader doors upstairs.'], pickup: 'Picked up a staff access card.' },
  visitor: { title: 'Visitor pass', lines: ['VISITOR · PLEASE SIGN IN AT RECEPTION', 'It doesn’t open anything.'], pickup: 'A visitor pass. It won’t open much.' },
};

// ------------------------------------------------------------------------------ HUD goals + hints (90 s)
export const GOALS = {
  card: 'Find a staff access card',
  power: 'Restore power to the Security Office',
  login: 'Find the security login',
  stairs: 'Unlock Stairwell A',
  down: 'Downstairs: keycard, fuse, exit key → get out',
};
export const HINTS = {
  card: (room) => `Somebody mentioned leaving a staff card in the ${room}.`,
  power: (hall) => `The security circuit's junction box is in the ${hall}. The breakers are in Maintenance.`,
  login: (room) => `The security login is written down somewhere in the ${room}.`,
};

// ------------------------------------------------------------------------------ the secrets
export const SECRETS = {
  eotm: {
    kind: 'note',
    title: 'Employee of the Month',
    image: 'assets/posters/assistant-eotm.png',
    lines: ['A framed staff photo: a woman in a hairnet and a pink tabard, holding a ladle, smiling a little too widely.', 'Her badge says LUNCH MONITOR.', 'Personally appointed by the Founder.'],
    footer: 'Every month since 1998.',
  },
  photo: {
    kind: 'note',
    title: 'Year 6, Summer 1996',
    lines: ['A class photograph, curled at the corners. Three rows of children, squinting at the sun.', 'One child in the back row is circled in red marker. Beside the circle, in felt tip: "me!"', 'The circle has been gone over many, many times.'],
    footer: 'The marker is newer than the photo.',
  },
  clapper: {
    kind: 'note',
    title: 'The 1962 bell clapper',
    lines: ['Wrapped in a tea towel: the clapper from the school\'s first bell. A brass tag, tied on with wool, says "3:33".', 'The bell was taken down the day it cracked. The records say it kept ringing for a week anyway.'],
    footer: 'It is warm.',
  },
  drawings: {
    kind: 'note',
    title: 'Pinboard: Art Room',
    lines: ['ME AND MY FRIEND (two stick people holding hands, a big sun, hearts all around)', '♥ ♥ ♥', 'lunch is at 12', 'lunch is always at 12', 'ples dont go home yet'],
    footer: 'Every drawing is signed with the same long, wobbly name.',
  },
};
/** Inside the lockers (the staff locker may hold the staff card instead). Each one restores your stamina. */
export const LOCKER_CONTENTS = {
  'locker-staff': { title: 'A can of fizzy drink', lines: ['Warm, but sealed. You drink it: full stamina.'], prompt: 'Drink the can' },
  'locker-north': { title: 'A chocolate bar', lines: ['Half of it is left. You eat it: full stamina.'], prompt: 'Eat the chocolate bar' },
  'locker-cabinet': { title: 'A tin of school biscuits', lines: ['Shortbread, from the 1962 opening. Still crunchy. Full stamina.'], prompt: 'Eat a biscuit' },
};

// ------------------------------------------------------------------------------ SCHOOLNET 2000
export const PC = {
  product: 'SCHOOLNET 2000',
  edition: 'Security Workstation',
  noSignal: 'NO SIGNAL',
  noPower: 'The security circuit is dead. Wire the junction box and set the breakers in Maintenance.',
  wrongPass: 'The user name or password is incorrect. Passwords are case sensitive.',
  // Access Control: the lockdown log before the release, the result after it
  lockdownLog: ['22:04  FINAL BELL', '22:05  ALL STAIRWELLS SEALED', '22:05  OVERRIDE: SECURITY OFFICE ONLY'],
  releasedLog: ['STAIRWELL A: RELEASED', 'GROUND FLOOR EXIT: keycard · fuse · key'],
};
// The plate at Stairwell A's grille (world-stairs.js) and the one-time line when you first walk up to it
export const STAIR_SIGN = { locked: ['STAIRWELL A — LOCKED', 'RELEASE: SECURITY OFFICE'], open: ['STAIRWELL A — OPEN', 'GO DOWNSTAIRS'] };
export const STAIR_NEAR_LINE = 'Stairwell A is locked. Release: Security Office.';


/**
 * The files in My Documents. `hidden` files only appear with Tools → Folder Options → Show hidden files.
 * type: 'doc' | 'txt' | 'xls' | 'sys' (a system file: opens with a refusal).
 */
export const FILES = [
  {
    name: 'Incident log 1998.doc', type: 'doc', folder: '', size: '24 KB', modified: '15/10/1998 04:02',
    text:
      'SECURITY INCIDENT LOG\nNight of 14–15 October 1998. Officer on duty: R. Pike (agency).\n\n' +
      '22:10  Rounds begin. Caretaker on the ground floor as normal.\n' +
      '23:47  CAM 03 (2F, North Hall) shows TWO figures on rounds. Payroll lists one caretaker. Radioed him: he says he is alone.\n' +
      '23:49  The second figure is shorter. It walks right behind him, step for step. He does not turn round.\n' +
      '23:52  The other one stopped under CAM 03, looked up, and waved at the camera.\n' +
      '00:03  Reviewed the tape. CAM 03 is blank from 23:46 to 00:02.\n' +
      '03:33  The bell rang. Nobody in the office. Bell panel switched off at the wall.\n' +
      '03:40  Spare fuses missing from the maintenance cupboard (again).\n' +
      '04:00  Someone left a tray of school dinner on this desk. Still warm.\n\n' +
      'ACTION: asked for a second caretaker to be added to payroll so the numbers match.\n' +
      'REPLY (School Office): "We only employ one."',
  },
  {
    name: 'Fire drill rota.xls', type: 'xls', folder: '', size: '18 KB', modified: '02/09/2003 08:15',
    table: [
      ['Week', 'Fire warden', 'Floor', 'Assembly point'],
      ['1', 'Ms Lennox', '2F (library)', 'Playing field'],
      ['2', 'Mr Brandt', '2F (maths)', 'Playing field'],
      ['3', 'Mrs Holloway', '2F (English)', 'Car park'],
      ['4', 'Ms Doyle', 'Ground floor', 'Car park'],
      ['5', 'Mr Okafor', 'Science', 'Playing field'],
      ['every week', 'Lunch monitor (volunteered)', 'ALL FLOORS', '"I’ll stay behind and make sure nobody is left inside."'],
    ],
  },
  {
    name: 'CCTV maintenance.txt', type: 'txt', folder: '', size: '2 KB', modified: '11/03/2004 23:10',
    text:
      'CCTV MAINTENANCE (2F)\n\n' +
      '- The cameras and this workstation run off breaker 5 (SEC. CCTV) and 2 (SEC. OFFICE) on the maintenance sub-board.\n' +
      '  If the office goes dark: junction box first, then the breakers.\n' +
      '- CAM 03, North Hall: a smudge in the corner of the picture. Cleaned the lens twice. It isn’t on the lens.\n' +
      '- Stairwell A: maglock. Released from Access Control on this PC.\n' +
      '- Stairwell B: chained and padlocked on the GROUND FLOOR side by the caretaker. It can only be lifted from below.\n' +
      '- Main entrance: on manual. Not controlled from here.\n' +
      '- Please stop eating lunch in the security office. There is gravy in the keyboard.',
  },
  {
    name: 'Night staff.txt', type: 'txt', folder: 'Personnel', size: '1 KB', modified: '01/09/2004 07:30',
    text:
      'NIGHT STAFF (on payroll)\n\n' +
      '  Caretaker ............ 1   (nights, all floors)\n' +
      '  Security ............. 1   (agency, this office)\n\n' +
      '  TOTAL ................ 2\n\n' +
      'Lunch staff go home at 2 pm. All of them.',
  },
  {
    name: 'assistant_application.txt', type: 'txt', folder: 'Personnel', size: '3 KB', modified: '15/10/1998 03:33', hidden: true,
    text:
      'SUPPORT STAFF — APPLICATION FORM\n' +
      '=================================\n\n' +
      'Applicant:            The Assistant\n' +
      '                      ("Just call me that. Everyone will.")\n' +
      'Position:             Lunch Monitor / Assistant Caretaker\n' +
      'Previous school:      Room 000\n' +
      '                      [School Office: there is no Room 000]\n' +
      'Experience:           Helping at lunch since I was a little girl.\n' +
      'Attendance:           Perfect. I have never gone home.\n\n' +
      'Why do you want this job?\n' +
      '  To make sure no child is ever left alone. Not at lunch, not after\n' +
      '  the bell, not ever. :)\n\n' +
      'Skills:\n' +
      '  - Portion control\n' +
      '  - Head counts (I always know how many of you there are)\n' +
      '  - Very quiet shoes\n' +
      '  - Finding children who are hiding\n\n' +
      'Favourite pupils:     I have already chosen my favourites.\n' +
      'References:           Please see the register. I am the blank line\n' +
      '                      at the bottom.\n\n' +
      '---------------------------------\n' +
      'Interviewed by:       Founder\n' +
      'Interview notes:      Brought her own ladle. Smiled the whole time.\n' +
      '                      Knew every pupil’s name, including the ones\n' +
      '                      who haven’t started here yet.\n' +
      'Status:               HIRED IMMEDIATELY\n\n' +
      'Security recommendation: REJECT APPLICATION.\n' +
      '  (This form was pushed under the security office door at 03:33.\n' +
      '   The building was locked. — R. Pike)',
  },
  { name: 'Thumbs.db', type: 'sys', folder: '', size: '6 KB', modified: '01/01/2000 00:00', hidden: true },
];

/** Access Control: the door list (the two live rows are filled from floor2 state). */
export const ACCESS_DOORS = [
  { id: 'stairA', name: 'Stairwell A (2F)', kind: 'Maglock' },
  { id: 'stairB', name: 'Stairwell B (2F)', kind: 'Chain + padlock', fixed: 'CHAINED (GROUND FLOOR SIDE)' },
  { id: 'security', name: 'Security Office', kind: 'Card reader' },
  { id: 'office', name: 'School Office', kind: 'Card reader' },
  { id: 'fire', name: 'Fire doors (2F)', kind: 'Hold-open', fixed: 'ON MANUAL' },
  { id: 'main', name: 'Main entrance (GF)', kind: 'Manual only', fixed: 'ON MANUAL' },
];
