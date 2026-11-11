/* Read codes. Owner: Dylan.
   The plain option after the vehicle is read: codes, what they mean, likely fix and parts, recalls.
   No battery/idle/drive steps, no estimate, no money, never touches monday.com. Saved on the phone like the others. */
(window.LCC_MODES = window.LCC_MODES || {}).codes = {
  id: 'codes',
  label: 'Read codes',
  title: 'Read codes',
  who: 'anyone',
  blurb: 'Just the codes, what they mean and the likely fix. Nothing to fill in.',
  record: 'scan', records: 'scans',
  basic: true,                   // health only: no battery/idle, drive, estimate or money steps

  stockLabel: 'Stock #',
  stockPlaceholder: 'Optional',
  stockFromVin: true,
  stockShort: 'stock',
  quick: false,

  lane: false,
  driveName: 'Test drive',
  driveIntro: '',

  money: 'none',
  estimateName: 'Estimate',
  estimateHint: '',
  overThousand: 'Likely over $1,000 to fix.',

  destination: 'phone',
  keepDays: 30,
  keepOptions: [7, 30]
};
