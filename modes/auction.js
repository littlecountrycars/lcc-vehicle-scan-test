/* Auction mode. Owner: Jonathan.
   Appraising vehicles at a physical auction, including ones we may not buy: a few minutes per vehicle,
   a ~300 m lane drive up to about 45 mph, poor signal. Never touches monday.com; appraisals stay on the
   phone until shared. Change wording and defaults here; the scanner itself lives in obd.js. */
(window.LCC_MODES = window.LCC_MODES || {}).auction = {
  id: 'auction',
  label: 'Auction',
  title: 'Auction',
  who: 'Jonathan, buying',
  blurb: 'Appraise at the auction: quick scan, red flags, max bid.',
  record: 'appraisal', records: 'appraisals',

  stockLabel: 'Lane / run #',
  stockPlaceholder: 'Optional',
  stockFromVin: false,
  stockShort: 'lane',
  scanHint: 'Miles fills in from the scan on most vehicles. Key on, engine off is the best start (the next step tests the battery as you start it). If the auction already has it running, scan anyway.',
  quick: true,
  nextBumpsNumber: true,         // Next vehicle adds 1 to a numeric lane/run #

  lane: true,
  driveName: 'Lane drive',
  driveIntro: 'Tap start <b>before</b> you roll and don’t touch the phone while moving. From a stop, accelerate firmly up to 35–45 mph so it shifts through its gears, then brake firmly to a stop. Turn around and do it again if there’s time. Tap End when stopped.',

  money: 'bid',
  estimateName: 'Estimated recon',
  estimateHint: 'Likely recon cost to factor into your bid. Prefilled from typical parts + labor for each finding; adjust, remove, or add lines (tires, glass, body, detail).',
  overThousand: 'Over $1,000 in likely recon, or a big-ticket repair. Factor it into your bid or pass.',
  priceLabel: 'Expected sale price',
  pricePlaceholder: 'From SCOUT',
  priceHint: 'In SCOUT, use the <b>expected sale price</b>, not SCOUT’s max bid. SCOUT’s max bid already takes off its own typical recon and gross; this one uses this vehicle’s scan.',
  resultName: 'Max bid',
  feesName: 'Buyer fee + transport',
  minProfit: 2500,               // per Jonathan: $2,500 minimum profit after recon
  fees: 0,
  calls: { good: 'Bid', watch: 'Caution', problem: 'Walk away' },
  scout: true,

  destination: 'phone',
  keepDays: 8,                   // the same unit can show up at next week's auction
  keepOptions: [1, 8, 30]
};
