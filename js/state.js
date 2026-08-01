// ── CONFIG (constants) ──
// Paste your Supabase project URL and anon key here (Dashboard → Project Settings → API)
export const SUPABASE_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_URL) || 'https://vtswgisxeylubvazcefe.supabase.co';
export const SUPABASE_ANON_KEY = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_ANON_KEY) || 'sb_publishable_lTpVWMDF42ocz84PXirWww_iVcNyeZ-';
export const PREMIUM_DAILY_LIMIT = 9999;
export const ADMIN_EMAIL = 'karnanphysics2026@gmail.com';
export const LETTERS = ['1','2','3','4']; // display labels for options (never A/B/C/D to students)

const { createClient } = window.supabase;
export const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── TAMIL CHAPTER NAME TRANSLATIONS ──────────────────────────────────────────
export const CHAPTER_LABELS_TA = {
  // Physics
  'Electric Charges and Fields':                        'மின்னூட்டங்கள் மற்றும் புலங்கள்',
  'Electrostatic Potential and Capacitance':            'மின்னிலை மற்றும் மின்தேக்கு',
  'Current Electricity':                                'மின்னோட்டவியல்',
  'Moving Charges and Magnetism':                       'இயங்கும் மின்னூட்டங்களும் காந்தவியலும்',
  'Magnetism and Matter':                               'காந்தவியலும் பருப்பொருளும்',
  'Electromagnetic Induction':                          'மின்காந்த தூண்டல்',
  'Alternating Current':                                'மாறு மின்னோட்டம்',
  'Electromagnetic Waves':                              'மின்காந்த அலைகள்',
  'Ray Optics and Optical Instruments':                 'ஒளிக்கதிர் ஒளியியலும் ஒளியியல் கருவிகளும்',
  'Wave Optics':                                        'அலை ஒளியியல்',
  'Dual Nature of Radiation and Matter':                'கதிர்வீச்சு மற்றும் பருப்பொருளின் இரட்டை இயல்பு',
  'Atoms':                                              'அணுக்கள்',
  'Nuclei':                                             'கருக்கள்',
  'Semiconductor Electronics':                          'குறைக்கடத்தி மின்னணுவியல்',
  'Semiconductor Electronics: Materials, Devices and Simple Circuits': 'குறைக்கடத்தி மின்னணுவியல்',
  // Chemistry
  'Solutions':                                          'கரைசல்கள்',
  'Electrochemistry':                                   'மின்வேதியியல்',
  'Chemical Kinetics':                                  'வேதியியல் இயக்கவியல்',
  'd and f Block Elements':                             'd மற்றும் f தொகுதி தனிமங்கள்',
  'Coordination Compounds':                             'ஒருங்கிணைப்பு சேர்மங்கள்',
  'Haloalkanes and Haloarenes':                         'ஹேலோஆல்கேன்கள் மற்றும் ஹேலோஆரீன்கள்',
  'Alcohols, Phenols and Ethers':                       'ஆல்கஹால்கள், பீனால்கள் மற்றும் ஈதர்கள்',
  'Aldehydes, Ketones and Carboxylic Acids':            'ஆல்டிஹைடுகள், கீட்டோன்கள் மற்றும் கார்பாக்சிலிக் அமிலங்கள்',
  'Amines':                                             'அமினோக்கள்',
  'Biomolecules':                                       'உயிர் மூலக்கூறுகள்',
  // Biology
  'Sexual Reproduction in Flowering Plants':            'பூக்கும் தாவரங்களில் பாலின இனப்பெருக்கம்',
  'Human Reproduction':                                 'மனித இனப்பெருக்கம்',
  'Reproductive Health':                                'இனப்பெருக்க நலம்',
  'Principles of Inheritance and Variation':            'பரம்பரை மற்றும் மாறுபாட்டுக் கோட்பாடுகள்',
  'Molecular Basis of Inheritance':                     'மரபுரிமையின் மூலக்கூறு அடிப்படை',
  'Evolution':                                          'பரிணாமம்',
  'Human Health and Disease':                           'மனித நலனும் நோயும்',
  'Microbes in Human Welfare':                          'மனித நலனில் நுண்ணுயிரிகள்',
  'Biotechnology: Principles and Processes':            'உயிரித்தொழில்நுட்பம்: கோட்பாடுகள் மற்றும் செயல்முறைகள்',
  'Biotechnology and its Applications':                 'உயிரித்தொழில்நுட்பமும் அதன் பயன்பாடுகளும்',
  'Organisms and Populations':                          'உயிரினங்களும் மக்கட்தொகைகளும்',
  'Ecosystem':                                          'சூழல் மண்டலம்',
  'Biodiversity and Conservation':                      'பல்லுயிர் மற்றும் பாதுகாப்பு',
};

// ── SHARED MUTABLE APP STATE ──────────────────────────────────────────────────
// Everything here used to be a bare `let`/`const` on the implicit global scope
// (js/config.js), read and reassigned directly from every other script. ES
// modules can't do that (imported bindings can't be reassigned from outside
// their module), so it's now a single object whose *properties* every module
// reads/writes — e.g. `state.authUser = x` instead of `authUser = x`.
export const state = {
  FREE_DAILY_LIMIT: 5,
  FREE_FC_DAILY: 5,
  FREE_TF_DAILY: 5,
  adminConfig: { free_daily_limit: 5, free_max_test_duration: 30, electrostatics_daily_limit: 20 },

  // ── AUTH + PLAN STATE ──
  authUser: null,
  userPlan: 'free',
  DAILY_LIMIT: 5, // mirrors FREE_DAILY_LIMIT initially
  selectedPlan: 'free',

  // ── APP STATE ──
  manifest: null,
  appMode: 'practice',
  selection: { language: null, standard: null, subject: null, chapter: null },
  currentLang: 'en',   // 'en' = English, 'ta' = Tamil
  currentClass: '12th', // '11th' or '12th'
  practiceState: { questions: [], idx: 0, answers: {}, skipDaily: false },
  timedState: { questions: [], idx: 0, answers: {}, marked: {}, secs: 0, totalSecs: 11700, timer: null, start: 0, name: '' },
  timedQCount: 180,
  timedDuration: 11700,
  localLeaderboard: [],
  globalLeaderboard: [],
  currentLbTab: 'global',
  mistakes: [],
  progress: { total: 0, correct: 0, wrong: 0, time: 0, subjects: {}, chapters: {}, history: [] },
  wrongAnswers: [],
  dailyCache: {},
};

// Returns the Tamil chapter name when Tamil UI is active, else the original label
export function _chapLabel(label) {
  // Lazy import to avoid a circular dependency (i18n.js has no deps of its own,
  // so this is safe, but keeping the import local documents why it's here).
  const isTa = localStorage.getItem('lang') === 'ta';
  if (!isTa) return label;
  return CHAPTER_LABELS_TA[label] || label;
}
