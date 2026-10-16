// LAST BELL - the student council election running at the school (posters + the reception banner).
//
// Edit the candidates here. Each one gets a poster that is hung all over the school.
//   name     shown big on the poster (keep it short: first + last name)
//   slogan   one short line
//   color    poster colour (any CSS colour)
//   photo    optional: path to a picture, e.g. 'assets/posters/jamie.jpg' (square-ish, face centred).
//            Without one, a simple drawn portrait is used, styled by `look`:
//            skin, hair, hairStyle 'short'|'long', highlights (hair-end colour), liner, earrings, lips, blazer.
//   graffiti true = someone has drawn on this candidate's posters
//
//   style    'handmade' = a write-in candidate's home-made marker poster; `lines` splits the name,
//            `variants` = [{ slogan, photo }] gives one differently drawn poster each
//   weight   how often this candidate's posters appear (printed default 1.6, write-in default 3)
//
// The poster sheet holds 16 designs: 4 original school posters + the candidates' posters.

export const ELECTION = {
  office: 'Student Council President',
  when: 'Vote Friday',
  banner: 'Student Council Election · Vote Friday in the Hall',
  candidates: [
    {
      name: 'Mia Tran',
      slogan: 'Free Wi-Fi in every classroom.',
      color: '#1f4f8f',
      photo: 'assets/posters/mia.jpg',
      look: { skin: '#e2b894', hair: '#1c1512', hairStyle: 'long', highlights: '#b07a45', liner: true, earrings: true, lips: '#b4525a', blazer: '#22263a' },
      graffiti: false,
    },
    {
      name: 'Chloe Lim',
      slogan: 'Bring back the vending machines.',
      color: '#a3172f',
      photo: 'assets/posters/chloe.jpg',
      look: { skin: '#d9ab84', hair: '#181210', hairStyle: 'long', highlights: '#c9a067', liner: true, earrings: true, lips: '#a8444f', blazer: '#22263a' },
      graffiti: true,
    },
    {
      name: 'Muhammed Tövbe Estağfurullah Donaeld Tramp Micheal Jordain',
      lines: ['Muhammed', 'Tövbe Estağfurullah', 'Donaeld Tramp', 'Micheal Jordain'],
      style: 'handmade',
      weight: 3, // share of all posters, split across the variants
      // one hand-made poster per variant (photos: lookalike edits of Ozan's photo, with his permission)
      variants: [
        { slogan: 'I just ate a shawarma', photo: 'assets/posters/ozan-shawarma.jpg' },
        { slogan: 'I will open a Döner shop.', photo: 'assets/posters/ozan-doner.jpg' },
        { slogan: 'Baba come, I give you discount', photo: 'assets/posters/ozan-discount.jpg' },
        { slogan: 'Törkiş food day for everyone', photo: 'assets/posters/ozan-foodday.jpg' },
      ],
      color: '#e8c33a',
    },
  ],
};
