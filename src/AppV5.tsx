import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import BookOpen from 'lucide-react-native/icons/book-open';
import Camera from 'lucide-react-native/icons/camera';
import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronUp from 'lucide-react-native/icons/chevron-up';
import FileText from 'lucide-react-native/icons/file-text';
import Flame from 'lucide-react-native/icons/flame';
import ImageIcon from 'lucide-react-native/icons/image';
import Library from 'lucide-react-native/icons/library';
import Mic from 'lucide-react-native/icons/mic';
import Play from 'lucide-react-native/icons/play';
import Plus from 'lucide-react-native/icons/plus';
import RotateCcw from 'lucide-react-native/icons/rotate-ccw';
import Settings2 from 'lucide-react-native/icons/settings-2';
import Sparkles from 'lucide-react-native/icons/sparkles';
import Square from 'lucide-react-native/icons/square';
import Trophy from 'lucide-react-native/icons/trophy';
import Volume2 from 'lucide-react-native/icons/volume-2';
import X from 'lucide-react-native/icons/x';
import type { LucideIcon } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  backupExportHint,
  backupExportLabel,
  exportBackup,
  pickBackupFile,
  supportsBackupFilePicker,
} from './platform/backup';
import { pdfPickerLabel, pickPdf } from './platform/documentPicker';
import {
  cameraActionLabel,
  readAssetBase64,
  requestCameraAccess,
  requestPhotoLibraryAccess,
  supportsCameraCapture,
} from './platform/imagePicker';
import {
  microphoneRequiredMessage,
  microphoneUnavailableMessage,
  readRecording,
} from './platform/recording';
import {
  getOrCreateSpeechUri,
  isSpeechCacheAvailable,
  speechCacheUnavailableMessage,
} from './platform/speechCache';
import { useCloudSync } from './lib/useCloudSync';
import AppShell, { type NavItem } from './ui/AppShell';
import ConfirmDialog, { type ConfirmRequest } from './ui/ConfirmDialog';
import GoalCelebration, { type GoalSummary } from './ui/GoalCelebration';
import MasteryRing from './ui/MasteryRing';
import PracticeCalendar from './ui/PracticeCalendar';
import SyncChoiceDialog from './ui/SyncChoiceDialog';
import { columnStyle, useResponsiveLayout } from './ui/useResponsiveLayout';
import {
  analyzeLearningMaterial,
  evaluateTranslationAnswer,
  generateThemedDeck,
  getPronunciationFeedback,
  synthesizeSpeech,
  type GeneratedFlashcard,
  type PronunciationFeedback,
} from './lib/aiFunctions';
import {
  applyReviewResult,
  buildPracticeQueue,
  cardStrength,
  deckMastery,
  DEFAULT_EASE,
  normalizeAnswer,
  initialEaseFor,
  isDue,
  isLocallyAcceptableAnswer,
  summarizeLessonOutcomes,
  type CardStrength,
  type Grade,
} from './lib/learning';
import {
  applyActivityEvent,
  buildPracticeCalendar,
  countPractisedDays,
  createInitialActivity,
  DAILY_GOAL,
  earnedMilestones,
  rollActivityToDate,
  type ActivityEvent,
  type ActivityState,
} from './lib/engagement';
import { fetchAiBudget, supabase, type AiBudget } from './lib/supabase';

type Screen = 'library' | 'lesson' | 'add' | 'ai';

const NAV_ITEMS: Array<NavItem<Screen>> = [
  {
    key: 'library',
    label: 'Today',
    icon: Library,
    hint: 'Goal, streak and decks',
  },
  { key: 'lesson', label: 'Lesson', icon: BookOpen, hint: 'Practice and speak' },
  { key: 'add', label: 'Add', icon: Plus, hint: 'Create a card by hand' },
  { key: 'ai', label: 'AI', icon: Sparkles, hint: 'Generate cards and feedback' },
];

type LessonQuestion = {
  id: string;
  cardId: string;
  prompt: string;
  answer: string;
  direction: 'to-native' | 'to-learning';
};

type LessonAnswer = {
  question: LessonQuestion;
  response: string;
  correct: boolean;
  feedback: string;
};

type LessonRound = 'full' | 'retry';

type Flashcard = {
  id: string;
  term: string;
  translation: string;
  example: string;
  exampleTranslation: string;
  known: number;
  missed: number;
  /** Consecutive confident recalls; drives how often the card comes back. */
  streak: number;
  /** SM-2 style difficulty; lower means the card keeps feeling hard. */
  ease: number;
  intervalDays: number;
  nextReviewAt: string;
};

type Deck = {
  id: string;
  name: string;
  cards: Flashcard[];
};

type LanguageFolder = {
  id: string;
  name: string;
  speechLocale: string;
  decks: Deck[];
};

type LibraryState = {
  version: 5;
  motherTongue: string;
  languages: LanguageFolder[];
  selectedLanguageId: string;
  selectedDeckId: string;
};

const LIBRARY_STORAGE_KEY = 'language-learning/library/v5';
const ACTIVITY_STORAGE_KEY = 'language-learning/activity/v1';
const V4_LIBRARY_STORAGE_KEY = 'language-learning/library/v4';
const V3_LIBRARY_STORAGE_KEY = 'language-learning/library/v3';
const V2_LIBRARY_STORAGE_KEY = 'language-learning/library/v2';
const OLD_CARDS_STORAGE_KEY = 'language-learning/cards/v1';
const OLD_SETTINGS_STORAGE_KEY = 'language-learning/settings/v1';
// The Edge Functions clamp to this same ceiling, so raising it here is enough.
const MAX_AI_CARDS_PER_REQUEST = 25;
/** Ordered worst to best, matching the Grade scale in src/lib/learning.ts. */
const GRADE_BUTTONS: Array<{
  grade: Grade;
  label: string;
  icon: LucideIcon;
  kind: 'primary' | 'success' | 'danger' | 'warning';
}> = [
  { grade: 'again', label: "Didn't know", icon: X, kind: 'danger' },
  { grade: 'hard', label: 'Hard', icon: RotateCcw, kind: 'warning' },
  { grade: 'good', label: 'Good', icon: Check, kind: 'success' },
  { grade: 'easy', label: 'Easy', icon: Trophy, kind: 'primary' },
];
// More effort recalled is worth more, but getting it wrong still earns
// something so that honest self-grading is never punished.
const GRADE_XP: Record<Grade, number> = {
  again: 4,
  hard: 6,
  good: 8,
  easy: 10,
};
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
// Matches the image cap: the practical ceiling is the Edge Function request
// body, not OpenAI's own 50 MB file limit.
const MAX_PDF_BYTES = 6 * 1024 * 1024;
const MAX_RECORDING_BYTES = 5 * 1024 * 1024;
const MAX_RECORDING_DURATION_MS = 30_000;

function getLocalDateKey(date = new Date()) {
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function getGreeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return 'GOOD MORNING';
  if (hour < 18) return 'GOOD AFTERNOON';
  return 'GOOD EVENING';
}

const arabicCards: Flashcard[] = [
  {
    id: 'arabic-demo-1',
    term: '\u0645\u0631\u062d\u0628\u0627',
    translation: '\u05e9\u05dc\u05d5\u05dd',
    example:
      '\u0645\u0631\u062d\u0628\u0627\u060c \u0643\u064a\u0641\u0643 \u0627\u0644\u064a\u0648\u0645\u061f',
    exampleTranslation:
      '\u05e9\u05dc\u05d5\u05dd, \u05d0\u05d9\u05da \u05d0\u05ea\u05d4 \u05d4\u05d9\u05d5\u05dd?',
    known: 0,
    missed: 0,
    streak: 0,
    ease: DEFAULT_EASE,
    intervalDays: 0,
    nextReviewAt: new Date(0).toISOString(),
  },
  {
    id: 'arabic-demo-2',
    term: '\u0645\u064a',
    translation: '\u05de\u05d9\u05dd',
    example: '\u0628\u062f\u064a \u0645\u064a \u0644\u0648 \u0633\u0645\u062d\u062a.',
    exampleTranslation:
      '\u05d0\u05e0\u05d9 \u05e8\u05d5\u05e6\u05d4 \u05de\u05d9\u05dd, \u05d1\u05d1\u05e7\u05e9\u05d4.',
    known: 0,
    missed: 0,
    streak: 0,
    ease: DEFAULT_EASE,
    intervalDays: 0,
    nextReviewAt: new Date(0).toISOString(),
  },
];

const greekCards: Flashcard[] = [
  {
    id: 'greek-demo-1',
    term: '\u03b3\u03b5\u03b9\u03b1 \u03c3\u03bf\u03c5',
    translation: '\u05e9\u05dc\u05d5\u05dd',
    example:
      '\u0393\u03b5\u03b9\u03b1 \u03c3\u03bf\u03c5, \u03c0\u03ce\u03c2 \u03b5\u03af\u03c3\u03b1\u03b9;',
    exampleTranslation:
      '\u05e9\u05dc\u05d5\u05dd, \u05de\u05d4 \u05e9\u05dc\u05d5\u05de\u05da?',
    known: 0,
    missed: 0,
    streak: 0,
    ease: DEFAULT_EASE,
    intervalDays: 0,
    nextReviewAt: new Date(0).toISOString(),
  },
  {
    id: 'greek-demo-2',
    term: '\u03bd\u03b5\u03c1\u03cc',
    translation: '\u05de\u05d9\u05dd',
    example:
      '\u0398\u03ad\u03bb\u03c9 \u03bd\u03b5\u03c1\u03cc, \u03c0\u03b1\u03c1\u03b1\u03ba\u03b1\u03bb\u03ce.',
    exampleTranslation:
      '\u05d0\u05e0\u05d9 \u05e8\u05d5\u05e6\u05d4 \u05de\u05d9\u05dd, \u05d1\u05d1\u05e7\u05e9\u05d4.',
    known: 0,
    missed: 0,
    streak: 0,
    ease: DEFAULT_EASE,
    intervalDays: 0,
    nextReviewAt: new Date(0).toISOString(),
  },
];

const initialLibrary: LibraryState = {
  version: 5,
  motherTongue: 'Hebrew',
  languages: [
    {
      id: 'language-levantine-arabic',
      name: 'Levantine Arabic',
      speechLocale: 'ar-LB',
      decks: [{ id: 'deck-arabic-basics', name: 'Basics', cards: arabicCards }],
    },
    {
      id: 'language-greek',
      name: 'Greek',
      speechLocale: 'el-GR',
      decks: [{ id: 'deck-greek-basics', name: 'Basics', cards: greekCards }],
    },
  ],
  selectedLanguageId: 'language-levantine-arabic',
  selectedDeckId: 'deck-arabic-basics',
};

function inferSpeechLocale(languageName: string) {
  const name = languageName.trim().toLowerCase();
  if (name.includes('arabic')) return 'ar-LB';
  if (name.includes('greek')) return 'el-GR';
  if (name.includes('spanish')) return 'es-ES';
  if (name.includes('french')) return 'fr-FR';
  if (name.includes('italian')) return 'it-IT';
  if (name.includes('german')) return 'de-DE';
  if (name.includes('hebrew')) return 'he-IL';
  if (name.includes('english')) return 'en-US';
  return 'en-US';
}

function shuffle<T>(items: T[]) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function estimateBase64Bytes(value: string) {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

function normalizeCard(card: Partial<Flashcard>): Flashcard {
  return {
    id: card.id ?? createId('card'),
    term: card.term?.trim() ?? '',
    translation: card.translation?.trim() ?? '',
    example: card.example?.trim() ?? '',
    exampleTranslation: card.exampleTranslation?.trim() ?? '',
    known: Number.isFinite(card.known) ? card.known! : 0,
    missed: Number.isFinite(card.missed) ? card.missed! : 0,
    // Defaulting here is what migrates libraries saved before streaks and ease
    // existed, including documents already synced to an account.
    streak: Number.isFinite(card.streak) ? card.streak! : 0,
    ease: Number.isFinite(card.ease) ? card.ease! : initialEaseFor(card),
    intervalDays: Number.isFinite(card.intervalDays) ? card.intervalDays! : 0,
    nextReviewAt: card.nextReviewAt ?? new Date(0).toISOString(),
  };
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function languageNameFromOldCode(code?: string) {
  if (code === 'el') return 'Greek';
  if (code === 'ar-levantine') return 'Levantine Arabic';
  if (code === 'es') return 'Spanish';
  if (code === 'fr') return 'French';
  return 'English';
}

function getSelectedLanguage(library: LibraryState) {
  return (
    library.languages.find(
      (language) => language.id === library.selectedLanguageId,
    ) ?? library.languages[0]
  );
}

function getSelectedDeck(library: LibraryState) {
  const language = getSelectedLanguage(library);
  return (
    language?.decks.find((deck) => deck.id === library.selectedDeckId) ??
    language?.decks[0]
  );
}

function normalizeLibrary(value: LibraryState): LibraryState {
  const languages = value.languages.filter((language) => language.name.trim());

  if (!languages.length) {
    return initialLibrary;
  }

  const selectedLanguage =
    languages.find((language) => language.id === value.selectedLanguageId) ??
    languages[0];
  const decks = selectedLanguage.decks.length
    ? selectedLanguage.decks
    : [{ id: createId('deck'), name: 'General', cards: [] }];
  const normalizedLanguages = languages.map((language) => ({
    ...language,
    speechLocale:
      language.speechLocale?.trim() || inferSpeechLocale(language.name),
    decks: (language.id === selectedLanguage.id ? decks : language.decks).map(
      (deck) => ({
        ...deck,
        cards: deck.cards.map(normalizeCard).filter((card) => card.term),
      }),
    ),
  }));
  const selectedDeck =
    decks.find((deck) => deck.id === value.selectedDeckId) ?? decks[0];

  return {
    version: 5,
    motherTongue: value.motherTongue?.trim() || 'Hebrew',
    languages: normalizedLanguages,
    selectedLanguageId: selectedLanguage.id,
    selectedDeckId: selectedDeck.id,
  };
}

/**
 * Coerces a stored or synced activity record into a valid ActivityState.
 * Shared by the local load path and by cloud sync, so a document arriving from
 * another device gets exactly the same validation as one read off disk.
 */
function hydrateActivity(value: unknown, today: string): ActivityState | null {
  if (!value || typeof value !== 'object') return null;

  const parsed = value as Partial<ActivityState>;
  const initial = createInitialActivity(today);

  return {
    ...initial,
    totalXp: Math.max(0, Number(parsed.totalXp) || 0),
    todayXp: Math.max(0, Number(parsed.todayXp) || 0),
    streakDays: Math.max(0, Number(parsed.streakDays) || 0),
    lastActiveDate:
      typeof parsed.lastActiveDate === 'string' ? parsed.lastActiveDate : '',
    todayDate: typeof parsed.todayDate === 'string' ? parsed.todayDate : today,
    todayProgress: Math.max(0, Number(parsed.todayProgress) || 0),
    lessonsCompleted: Math.max(0, Number(parsed.lessonsCompleted) || 0),
    perfectLessons: Math.max(0, Number(parsed.perfectLessons) || 0),
    // Records saved before the practice calendar existed have no history.
    // It starts empty and fills from today rather than being back-filled:
    // inventing practice days would make the calendar a lie.
    history:
      parsed.history && typeof parsed.history === 'object'
        ? (parsed.history as Record<string, number>)
        : {},
  };
}

/**
 * Remaining monthly AI allowance, as dollars. This mirrors the server-side
 * estimate, not an OpenAI invoice, so it is shown to set expectations rather
 * than as an authoritative figure.
 */
function formatBudgetRemaining(budget: AiBudget) {
  const remaining = Math.max(
    0,
    budget.budgetMicroUsd - budget.spentMicroUsd,
  );
  return `$${(remaining / 1_000_000).toFixed(2)}`;
}

/** Serialised demo library, used to tell untouched devices from real ones. */
const PRISTINE_LIBRARY_JSON = JSON.stringify(initialLibrary);

export default function AppV5() {
  const layout = useResponsiveLayout();
  const speechPlayer = useAudioPlayer(null);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingStopInFlightRef = useRef(false);

  const [screen, setScreen] = useState<Screen>('library');
  const [library, setLibrary] = useState<LibraryState>(initialLibrary);
  const [storageReady, setStorageReady] = useState(false);
  const [activityReady, setActivityReady] = useState(false);
  const [activity, setActivity] = useState<ActivityState>(() =>
    createInitialActivity(getLocalDateKey()),
  );
  const [notice, setNotice] = useState('Loading your local library...');
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(
    null,
  );
  const [showLibraryManagement, setShowLibraryManagement] = useState(false);
  const [showCardSettings, setShowCardSettings] = useState(false);
  const [showAllCards, setShowAllCards] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [goalSummary, setGoalSummary] = useState<GoalSummary | null>(null);
  // Which date's goal celebration has already been shown, so re-renders, deck
  // changes and extra practice cannot retrigger it.
  const celebratedDateRef = useRef('');
  const [cardSearch, setCardSearch] = useState('');
  const [expandedCardId, setExpandedCardId] = useState('');
  const [showLessonDeckPicker, setShowLessonDeckPicker] = useState(false);
  const [showAddDestination, setShowAddDestination] = useState(false);
  const [showAddDetails, setShowAddDetails] = useState(false);
  const [showAiDestination, setShowAiDestination] = useState(false);
  const [aiWorkspace, setAiWorkspace] = useState<'cards' | 'speaking'>('cards');
  const [cardIndex, setCardIndex] = useState(0);
  // Tagged with the deck it belongs to, so a deck change invalidates it
  // declaratively. An effect that cleared the queue separately would race the
  // effect that builds it: both run in the same commit, the clear would win,
  // and the builder's dependencies would not change again to retry.
  const [practice, setPractice] = useState<{ deckId: string; ids: string[] }>({
    deckId: '',
    ids: [],
  });
  const [showTranslation, setShowTranslation] = useState(false);
  const [newLanguageName, setNewLanguageName] = useState('');
  const [newDeckName, setNewDeckName] = useState('');
  const [deckGoal, setDeckGoal] = useState('');
  const [deckGoalLoading, setDeckGoalLoading] = useState(false);
  const [newTerm, setNewTerm] = useState('');
  const [newTranslation, setNewTranslation] = useState('');
  const [newExample, setNewExample] = useState('');
  const [newExampleTranslation, setNewExampleTranslation] = useState('');
  const [editingCardId, setEditingCardId] = useState('');
  const [editTerm, setEditTerm] = useState('');
  const [editTranslation, setEditTranslation] = useState('');
  const [editExample, setEditExample] = useState('');
  const [editExampleTranslation, setEditExampleTranslation] = useState('');
  const [deckNameDraft, setDeckNameDraft] = useState('');
  const [aiMode, setAiMode] = useState<'full_text' | 'pairs'>('full_text');
  const [sourceText, setSourceText] = useState('');
  const [selectedImageLabel, setSelectedImageLabel] = useState('');
  const [aiPreviewCards, setAiPreviewCards] = useState<GeneratedFlashcard[]>([]);
  const [selectedPreviewIndexes, setSelectedPreviewIndexes] = useState<number[]>(
    [],
  );
  const [aiLoading, setAiLoading] = useState(false);
  const [aiBudget, setAiBudget] = useState<AiBudget | null>(null);
  const [practiceSentence, setPracticeSentence] = useState('');
  const [spokenTranscript, setSpokenTranscript] = useState('');
  const [pronunciationFeedback, setPronunciationFeedback] =
    useState<PronunciationFeedback | null>(null);
  const [backupText, setBackupText] = useState('');
  const [lessonStage, setLessonStage] = useState<
    'setup' | 'exam' | 'results' | 'speaking'
  >('setup');
  const [lessonQuestions, setLessonQuestions] = useState<LessonQuestion[]>([]);
  const [lessonAnswers, setLessonAnswers] = useState<LessonAnswer[]>([]);
  const [lessonQuestionIndex, setLessonQuestionIndex] = useState(0);
  const [lessonInput, setLessonInput] = useState('');
  const [lessonChecked, setLessonChecked] = useState(false);
  const [lessonChecking, setLessonChecking] = useState(false);
  const [lessonRound, setLessonRound] = useState<LessonRound>('full');
  const [completedLessonRecordings, setCompletedLessonRecordings] = useState<
    string[]
  >([]);
  const [speechLoadingText, setSpeechLoadingText] = useState('');
  const lessonCompletionHandledRef = useRef(false);
  const lessonEvaluationIdRef = useRef(0);

  const contentColumn = useMemo(
    () => columnStyle(layout.contentMaxWidth),
    [layout.contentMaxWidth],
  );
  const focusColumn = useMemo(
    () => columnStyle(layout.focusMaxWidth),
    [layout.focusMaxWidth],
  );
  // The deck grid keeps its 2-up phone layout and gains a column once there is
  // room, instead of stretching two very wide tiles across a monitor.
  // On a wide monitor the three management panels sit two-up instead of
  // stacking into a very long single column.
  const managementGrid = useMemo(
    () =>
      layout.splitDashboard
        ? ({
            flexDirection: 'row' as const,
            flexWrap: 'wrap' as const,
            alignItems: 'flex-start' as const,
            gap: 16,
          })
        : ({ gap: 16 }),
    [layout.splitDashboard],
  );
  const managementPanel = useMemo(
    () => (layout.splitDashboard ? { width: '48%' as const } : null),
    [layout.splitDashboard],
  );
  // Four grades side by side are unreadably narrow on a phone, so they wrap to
  // 2x2 there and open out into a single row once there is width. The 48%
  // leaves headroom for the 9px gap; an exact 50% overflows and wraps to one
  // button per line.
  const gradeButtonStyle = useMemo(
    () => ({ width: layout.isPhone ? ('48%' as const) : ('23.5%' as const) }),
    [layout.isPhone],
  );
  // The percentages leave headroom for the 9px gap between tiles; an exact
  // 100/n split overflows the row and wraps to a single tile per line.
  const deckTileWidth = useMemo(
    () => ({
      width: layout.deckColumns === 3 ? ('31%' as const) : ('48%' as const),
    }),
    [layout.deckColumns],
  );

  const selectedLanguage = getSelectedLanguage(library);
  const selectedDeck = getSelectedDeck(library);
  const cards = selectedDeck?.cards ?? [];
  const dueCards = useMemo(
    () =>
      cards.filter(
        (card) => new Date(card.nextReviewAt).getTime() <= Date.now(),
      ),
    [cards],
  );
  // Deck browser contents. Matching reuses normalizeAnswer so searching works
  // the same way answer checking does -- accents, diacritics and punctuation
  // are ignored, which matters for Greek, Arabic and Hebrew.
  const browsedCards = useMemo(() => {
    const query = normalizeAnswer(cardSearch);

    if (!query) return cards;

    return cards.filter((card) =>
      [card.term, card.translation, card.example, card.exampleTranslation]
        .map(normalizeAnswer)
        .some((field) => field.includes(query)),
    );
  }, [cards, cardSearch]);

  const strongCardCount = useMemo(
    () => cards.filter((card) => cardStrength(card) === 'strong').length,
    [cards],
  );
  const practiceCalendar = useMemo(
    () => buildPracticeCalendar(activity.history ?? {}, getLocalDateKey(), 12),
    [activity.history],
  );
  const practisedDays = useMemo(
    () => countPractisedDays(activity.history ?? {}),
    [activity.history],
  );
  const milestones = useMemo(
    () =>
      earnedMilestones({
        activity,
        strongCards: strongCardCount,
        daysPractised: practisedDays,
      }),
    [activity, strongCardCount, practisedDays],
  );

  const weakCardCount = useMemo(
    () => cards.filter((card) => cardStrength(card) === 'needs-work').length,
    [cards],
  );
  // The queue holds card IDs rather than card objects, and lives in state
  // rather than a useMemo: grading a card mutates `cards`, which would
  // otherwise reshuffle the round mid-practice and re-roll the randomness on
  // every render.
  const reviewCards = useMemo(
    () =>
      practice.deckId && practice.deckId === selectedDeck?.id
        ? practice.ids
            .map((id) => cards.find((card) => card.id === id))
            .filter((card): card is Flashcard => Boolean(card))
        : [],
    [practice, selectedDeck?.id, cards],
  );
  const activeCard = reviewCards[cardIndex] ?? null;
  const canUseAi = Boolean(supabase);
  const practicePhrases = useMemo(
    () =>
      Array.from(
        new Set(cards.map((card) => card.example.trim()).filter(Boolean)),
      ),
    [cards],
  );
  const progress = useMemo(
    () =>
      cards.reduce(
        (total, card) => ({
          known: total.known + card.known,
          missed: total.missed + card.missed,
        }),
        { known: 0, missed: 0 },
      ),
    [cards],
  );
  const reviews = progress.known + progress.missed;
  const accuracy = reviews ? Math.round((progress.known / reviews) * 100) : 0;
  const lessonCardIds = useMemo(
    () => Array.from(new Set(lessonQuestions.map((question) => question.cardId))),
    [lessonQuestions],
  );
  const lessonCards = useMemo(
    () => cards.filter((card) => lessonCardIds.includes(card.id)),
    [cards, lessonCardIds],
  );
  const lessonPhrases = useMemo(
    () =>
      shuffle(
        Array.from(
          new Set(
            lessonCards
              .map((card) => card.example.trim() || card.term.trim())
              .filter(Boolean),
          ),
        ),
      ).slice(0, 5),
    [lessonCards],
  );
  const lessonScore = lessonAnswers.filter((answer) => answer.correct).length;

  function getSentenceTranslation(
    sentence: string,
    sourceCards: Flashcard[] = cards,
  ) {
    return (
      sourceCards.find((card) => card.example.trim() === sentence.trim())
        ?.exampleTranslation ?? ''
    );
  }

  useEffect(() => {
    loadLibrary();
    loadActivity();

    return () => {
      if (recordingTimerRef.current) {
        clearTimeout(recordingTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!storageReady) return;

    AsyncStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(library)).catch(
      (error) => setNotice(`Local save error: ${error.message}`),
    );
  }, [library, storageReady]);

  useEffect(() => {
    if (!activityReady) return;

    AsyncStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(activity)).catch(
      (error) => setNotice(`Activity save error: ${error.message}`),
    );
  }, [activity, activityReady]);

  // Mirrors the library and activity documents to the signed-in account so the
  // same data appears on every device. Local storage above stays the source of
  // truth during a session, so the app still works offline.
  const { syncChoice } = useCloudSync<LibraryState, ActivityState>({
    library,
    activity,
    ready: storageReady && activityReady,
    libraryIsPristine: JSON.stringify(library) === PRISTINE_LIBRARY_JSON,
    activityIsPristine:
      activity.totalXp === 0 && activity.lessonsCompleted === 0,
    applyLibrary: setLibrary,
    applyActivity: setActivity,
    normalizeLibrary: (value) => {
      try {
        return value ? normalizeLibrary(value as LibraryState) : null;
      } catch {
        return null;
      }
    },
    normalizeActivity: (value) => hydrateActivity(value, getLocalDateKey()),
    onNotice: setNotice,
  });

  useEffect(() => {
    if (!activityReady) return;

    let isMounted = true;
    let midnightTimer: ReturnType<typeof setTimeout> | undefined;
    const rollToToday = () => {
      setActivity((current) =>
        rollActivityToDate(current, getLocalDateKey()),
      );
    };
    const scheduleMidnightRollover = () => {
      const now = new Date();
      const nextMidnight = new Date(now);
      nextMidnight.setHours(24, 0, 1, 0);
      midnightTimer = setTimeout(() => {
        rollToToday();
        if (isMounted) scheduleMidnightRollover();
      }, nextMidnight.getTime() - now.getTime());
    };

    rollToToday();
    scheduleMidnightRollover();
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') rollToToday();
    });

    return () => {
      isMounted = false;
      subscription.remove();
      if (midnightTimer) clearTimeout(midnightTimer);
    };
  }, [activityReady]);

  // Builds the next practice round whenever there isn't a usable one: on first
  // load, after a deck change, and when the previous round runs out. This is
  // what makes practice unlimited — the queue simply refills. It is the only
  // writer of `practice`, which is what keeps it free of effect-ordering races.
  useEffect(() => {
    const deckId = selectedDeck?.id;

    if (!storageReady || !deckId || !cards.length) return;
    if (practice.deckId === deckId && reviewCards.length) return;

    setPractice({
      deckId,
      ids: buildPracticeQueue(cards, {
        length: Math.max(cards.length, 12),
      }).map((card) => card.id),
    });
    setCardIndex(0);
  }, [storageReady, selectedDeck?.id, cards, practice.deckId, reviewCards.length]);

  // Refreshed when the AI tab opens and after each AI call.
  //
  // Read twice on purpose. The server charges a flat provisional reservation
  // before calling OpenAI and reconciles it to the true cost in the background
  // once the response has been sent, so a single read taken the moment a call
  // finishes shows the reservation (5% of the monthly budget) rather than what
  // was actually spent, and would sit there stale for as long as the user
  // stayed on this tab. The second read collects the reconciled figure.
  useEffect(() => {
    if (screen !== 'ai' || !canUseAi || aiLoading) return;

    let cancelled = false;

    const read = async () => {
      const budget = await fetchAiBudget().catch(() => null);
      if (!cancelled) setAiBudget(budget);
    };

    void read();
    const settleTimer = setTimeout(() => void read(), 2_500);

    return () => {
      cancelled = true;
      clearTimeout(settleTimer);
    };
  }, [screen, canUseAi, aiLoading]);

  // The daily goal is the session's finish line. Fires once per day, keyed on
  // the date rather than a boolean so a new day re-arms it automatically.
  useEffect(() => {
    if (!activityReady) return;

    const today = getLocalDateKey();

    if (activity.todayDate !== today) return;
    if (activity.todayProgress < DAILY_GOAL) return;
    if (celebratedDateRef.current === today) return;

    celebratedDateRef.current = today;
    setGoalSummary({
      cardsPractised: activity.todayProgress,
      xpEarned: activity.todayXp,
      streakDays: activity.streakDays,
    });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [activityReady, activity]);

  useEffect(() => {
    lessonEvaluationIdRef.current += 1;
    setLessonChecking(false);
    setCardIndex(0);
    setShowTranslation(false);
    setPronunciationFeedback(null);
    setSpokenTranscript('');
    setPracticeSentence(getSelectedDeck(library)?.cards[0]?.example ?? '');
    setDeckNameDraft(getSelectedDeck(library)?.name ?? '');
    setEditingCardId('');
    setLessonStage('setup');
    setLessonQuestions([]);
    setLessonAnswers([]);
    setLessonRound('full');
    lessonCompletionHandledRef.current = false;
  }, [library.selectedLanguageId, library.selectedDeckId]);

  async function loadLibrary() {
    try {
      const [
        [, storedLibrary],
        [, storedV4Library],
        [, storedV3Library],
        [, storedV2Library],
      ] =
        await AsyncStorage.multiGet([
          LIBRARY_STORAGE_KEY,
          V4_LIBRARY_STORAGE_KEY,
          V3_LIBRARY_STORAGE_KEY,
          V2_LIBRARY_STORAGE_KEY,
        ]);

      if (storedLibrary) {
        setLibrary(normalizeLibrary(JSON.parse(storedLibrary) as LibraryState));
        setNotice('Your library is ready.');
        return;
      }

      if (storedV4Library) {
        setLibrary(
          normalizeLibrary(JSON.parse(storedV4Library) as LibraryState),
        );
        setNotice('Your existing library was upgraded.');
        return;
      }

      if (storedV3Library) {
        setLibrary(
          normalizeLibrary(JSON.parse(storedV3Library) as LibraryState),
        );
        setNotice('Your existing library was upgraded.');
        return;
      }

      if (storedV2Library) {
        setLibrary(
          normalizeLibrary(JSON.parse(storedV2Library) as LibraryState),
        );
        setNotice('Your existing library was upgraded.');
        return;
      }

      const [[, oldCards], [, oldSettings]] = await AsyncStorage.multiGet([
        OLD_CARDS_STORAGE_KEY,
        OLD_SETTINGS_STORAGE_KEY,
      ]);

      if (oldCards) {
        const cardsToImport = JSON.parse(oldCards) as Flashcard[];
        const settings = oldSettings
          ? (JSON.parse(oldSettings) as {
              nativeLanguage?: string;
              learningLanguage?: string;
            })
          : {};
        const languageId = createId('language');
        const deckId = createId('deck');
        const migrated: LibraryState = {
          version: 5,
          motherTongue:
            settings.nativeLanguage === 'en' ? 'English' : 'Hebrew',
          languages: [
            {
              id: languageId,
              name: languageNameFromOldCode(settings.learningLanguage),
              speechLocale: inferSpeechLocale(
                languageNameFromOldCode(settings.learningLanguage),
              ),
              decks: [
                {
                  id: deckId,
                  name: 'Imported cards',
                  cards: Array.isArray(cardsToImport)
                    ? cardsToImport.map(normalizeCard)
                    : [],
                },
              ],
            },
          ],
          selectedLanguageId: languageId,
          selectedDeckId: deckId,
        };

        setLibrary(migrated);
        setNotice('Your existing cards were moved into an Imported cards deck.');
      } else {
        setLibrary(initialLibrary);
        setNotice('Your local library is ready.');
      }
    } catch (error) {
      setLibrary(initialLibrary);
      setNotice(
        error instanceof Error
          ? `Library load error: ${error.message}`
          : 'Library load error.',
      );
    } finally {
      setStorageReady(true);
    }
  }

  async function loadActivity() {
    const today = getLocalDateKey();
    try {
      const storedActivity = await AsyncStorage.getItem(ACTIVITY_STORAGE_KEY);
      if (!storedActivity) return;

      const hydratedActivity =
        hydrateActivity(JSON.parse(storedActivity), today) ??
        createInitialActivity(today);
      setActivity(rollActivityToDate(hydratedActivity, today));
    } catch {
      setActivity(createInitialActivity(today));
    } finally {
      setActivityReady(true);
    }
  }

  function recordActivity(event: ActivityEvent) {
    setActivity((current) =>
      applyActivityEvent(current, event, getLocalDateKey()),
    );
  }

  function changeScreen(nextScreen: Screen) {
    if (nextScreen === 'library') {
      setActivity((current) =>
        rollActivityToDate(current, getLocalDateKey()),
      );
    }
    if (nextScreen === screen) return;
    if (screen === 'lesson' && nextScreen !== 'lesson') {
      lessonEvaluationIdRef.current += 1;
      setLessonChecking(false);
    }
    void Haptics.selectionAsync();
    setScreen(nextScreen);
  }

  function startLessonFromDashboard() {
    setScreen('lesson');
    startLesson();
  }

  function toggleCardTranslation() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowTranslation((current) => !current);
  }

  function selectLanguage(languageId: string) {
    const language = library.languages.find((item) => item.id === languageId);
    if (!language) return;

    setLibrary((current) => ({
      ...current,
      selectedLanguageId: languageId,
      selectedDeckId: language.decks[0]?.id ?? '',
    }));
  }

  function selectDeck(deckId: string) {
    setLibrary((current) => ({ ...current, selectedDeckId: deckId }));
  }

  function updateSelectedLanguageLocale(speechLocale: string) {
    if (!selectedLanguage) return;
    setLibrary((current) => ({
      ...current,
      languages: current.languages.map((language) =>
        language.id === selectedLanguage.id
          ? { ...language, speechLocale }
          : language,
      ),
    }));
  }

  function startLesson() {
    if (!selectedDeck?.cards.length) {
      setNotice('Add cards to this deck before starting a lesson.');
      return;
    }

    const lessonSelection = shuffle(selectedDeck.cards).slice(0, 10);
    const questionLimit = Math.min(10, lessonSelection.length * 2);
    const questions = shuffle<LessonQuestion>(
      Array.from({ length: questionLimit }, (_, index) => {
        const cardIndex = index % lessonSelection.length;
        const cycle = Math.floor(index / lessonSelection.length);
        const baseToNative = cardIndex % 2 === 0;
        const direction =
          cycle % 2 === 0
            ? baseToNative
              ? 'to-native'
              : 'to-learning'
            : baseToNative
              ? 'to-learning'
              : 'to-native';
        const card = lessonSelection[cardIndex];

        return {
          id: `${card.id}-${direction}`,
          cardId: card.id,
          prompt: direction === 'to-native' ? card.term : card.translation,
          answer: direction === 'to-native' ? card.translation : card.term,
          direction,
        };
      }),
    );

    lessonEvaluationIdRef.current += 1;
    setLessonQuestions(questions);
    setLessonAnswers([]);
    setLessonQuestionIndex(0);
    setLessonInput('');
    setLessonChecked(false);
    setLessonChecking(false);
    setLessonRound('full');
    lessonCompletionHandledRef.current = false;
    setPronunciationFeedback(null);
    setSpokenTranscript('');
    setCompletedLessonRecordings([]);
    setLessonStage('exam');
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setNotice(`Lesson started with ${questions.length} translation questions.`);
  }

  async function checkLessonAnswer() {
    const question = lessonQuestions[lessonQuestionIndex];
    const response = lessonInput.trim();
    if (!question || !response || lessonChecked || lessonChecking) return;

    setLessonChecking(true);
    const evaluationId = ++lessonEvaluationIdRef.current;
    let correct = isLocallyAcceptableAnswer(response, question.answer);
    let feedback = '';
    let evaluationError = '';

    if (!correct && supabase && selectedLanguage) {
      try {
        const evaluation = await evaluateTranslationAnswer({
          prompt: question.prompt,
          response,
          referenceAnswer: question.answer,
          promptLanguage:
            question.direction === 'to-native'
              ? selectedLanguage.name
              : library.motherTongue,
          answerLanguage:
            question.direction === 'to-native'
              ? library.motherTongue
              : selectedLanguage.name,
        });
        correct = evaluation.correct;
        feedback = evaluation.feedback;
      } catch (error) {
        feedback = 'Alternative meaning could not be verified online.';
        evaluationError =
          error instanceof Error
            ? `Answer check: ${error.message}`
            : 'The alternative answer could not be checked.';
      }
    }

    if (evaluationId !== lessonEvaluationIdRef.current) return;
    if (evaluationError) setNotice(evaluationError);

    setLessonAnswers((current) => [
      ...current,
      {
        question,
        response,
        correct,
        feedback,
      },
    ]);
    setLessonChecked(true);
    setLessonChecking(false);
    void Haptics.notificationAsync(
      correct
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Error,
    );
  }

  function skipLessonAnswer() {
    const question = lessonQuestions[lessonQuestionIndex];
    if (!question || lessonChecked || lessonChecking) return;

    setLessonAnswers((current) => [
      ...current,
      {
        question,
        response: '',
        correct: false,
        feedback: 'Question skipped.',
      },
    ]);
    setLessonInput('');
    setLessonChecked(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }

  function acceptCurrentLessonAnswer() {
    const question = lessonQuestions[lessonQuestionIndex];
    if (!question || !lessonChecked) return;

    setLessonAnswers((current) =>
      current.map((answer, index) =>
        index === current.length - 1 && answer.question.id === question.id
          ? {
              ...answer,
              correct: true,
              feedback: 'Counted as correct by you.',
            }
          : answer,
      ),
    );
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  function saveLessonProgress(answers: LessonAnswer[]) {
    const outcomes = summarizeLessonOutcomes(
      answers.map((answer) => ({
        cardId: answer.question.cardId,
        correct: answer.correct,
      })),
    );

    const reviewedAt = new Date();
    updateSelectedDeck((deck) => ({
      ...deck,
      cards: deck.cards.map((card) => {
        const result = outcomes.get(card.id);
        return result ? applyReviewResult(card, result, reviewedAt) : card;
      }),
    }));
  }

  function continueLesson() {
    if (!lessonChecked || lessonChecking) return;
    if (lessonQuestionIndex >= lessonQuestions.length - 1) {
      if (lessonCompletionHandledRef.current) return;
      lessonCompletionHandledRef.current = true;

      if (lessonRound === 'full') {
        saveLessonProgress(lessonAnswers);
        recordActivity({
          units: lessonAnswers.length,
          xp: lessonScore * 10 + 20,
          lessonCompleted: true,
          perfectLesson: lessonScore === lessonAnswers.length,
        });
      }
      setLessonStage('results');
      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );
      setNotice(
        lessonRound === 'full'
          ? 'Lesson complete. Card progress was saved.'
          : 'Mistake retry complete. Review the result or continue to speaking.',
      );
      return;
    }

    setLessonQuestionIndex((current) => current + 1);
    setLessonInput('');
    setLessonChecked(false);
    setLessonChecking(false);
  }

  function retryLessonMistakes() {
    const missedQuestions = lessonAnswers
      .filter((answer) => !answer.correct)
      .map((answer) => answer.question);

    if (!missedQuestions.length) {
      setNotice('There are no mistakes to retry in this round.');
      return;
    }

    lessonEvaluationIdRef.current += 1;
    setLessonQuestions(shuffle(missedQuestions));
    setLessonAnswers([]);
    setLessonQuestionIndex(0);
    setLessonInput('');
    setLessonChecked(false);
    setLessonChecking(false);
    setLessonRound('retry');
    lessonCompletionHandledRef.current = false;
    setLessonStage('exam');
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setNotice(`Retrying ${missedQuestions.length} missed question${
      missedQuestions.length === 1 ? '' : 's'
    }.`);
  }

  function openLessonSpeaking() {
    const firstSentence = lessonPhrases[0] ?? '';
    setPracticeSentence(firstSentence);
    setSpokenTranscript('');
    setPronunciationFeedback(null);
    setCompletedLessonRecordings([]);
    setLessonStage('speaking');
    setNotice(
      `Listening and recording practice is ready with ${lessonPhrases.length} exercises.`,
    );
  }

  function resetLesson() {
    speechPlayer.pause();
    lessonEvaluationIdRef.current += 1;
    setLessonStage('setup');
    setLessonQuestions([]);
    setLessonAnswers([]);
    setLessonChecking(false);
    setLessonQuestionIndex(0);
    setLessonInput('');
    setLessonChecked(false);
    setLessonRound('full');
    lessonCompletionHandledRef.current = false;
    setPronunciationFeedback(null);
    setSpokenTranscript('');
    setCompletedLessonRecordings([]);
  }

  async function playSentence(sentence: string) {
    if (!sentence.trim() || !selectedLanguage) return;
    if (!supabase) {
      setNotice('Supabase is required for OpenAI voice playback.');
      return;
    }
    if (!isSpeechCacheAvailable) {
      setNotice(speechCacheUnavailableMessage);
      return;
    }

    setSpeechLoadingText(sentence);
    try {
      speechPlayer.pause();
      const { uri: fileUri, generatedVoice } = await getOrCreateSpeechUri({
        language: selectedLanguage.name,
        text: sentence.trim(),
        synthesize: (format) =>
          synthesizeSpeech({
            text: sentence,
            language: selectedLanguage.name,
            format,
          }),
      });
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });
      speechPlayer.replace({ uri: fileUri });
      await new Promise((resolve) => setTimeout(resolve, 180));
      speechPlayer.play();
      setNotice(
        generatedVoice
          ? `Playing AI-generated ${selectedLanguage.name} speech with OpenAI ${generatedVoice}.`
          : `Playing cached AI-generated ${selectedLanguage.name} speech.`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `Voice playback error: ${error.message}`
          : 'Voice playback error.',
      );
    } finally {
      setSpeechLoadingText('');
    }
  }

  function addLanguage() {
    const name = newLanguageName.trim();
    if (!name) {
      setNotice('Enter the language name first.');
      return;
    }

    const languageId = createId('language');
    const deckId = createId('deck');
    setLibrary((current) => ({
      ...current,
      languages: [
        ...current.languages,
        {
          id: languageId,
          name,
          speechLocale: inferSpeechLocale(name),
          decks: [{ id: deckId, name: 'General', cards: [] }],
        },
      ],
      selectedLanguageId: languageId,
      selectedDeckId: deckId,
    }));
    setNewLanguageName('');
    setNotice(`Created the ${name} language folder.`);
  }

  function addDeck() {
    const name = newDeckName.trim();
    if (!name || !selectedLanguage) {
      setNotice('Choose a language and enter a deck name.');
      return;
    }

    const deckId = createId('deck');
    setLibrary((current) => ({
      ...current,
      languages: current.languages.map((language) =>
        language.id === selectedLanguage.id
          ? {
              ...language,
              decks: [...language.decks, { id: deckId, name, cards: [] }],
            }
          : language,
      ),
      selectedDeckId: deckId,
    }));
    setNewDeckName('');
    setNotice(`Created the ${name} deck in ${selectedLanguage.name}.`);
  }

  async function createDeckFromGoal() {
    const goal = deckGoal.trim();

    if (!goal || !selectedLanguage) {
      setNotice('Choose a language and describe the deck goal first.');
      return;
    }

    if (!supabase) {
      setNotice('Supabase is required to create an AI-generated deck.');
      return;
    }

    setDeckGoalLoading(true);

    try {
      const generatedDeck = await generateThemedDeck({
        goal,
        nativeLanguage: library.motherTongue,
        learningLanguage: selectedLanguage.name,
        minCards: 10,
        maxCards: MAX_AI_CARDS_PER_REQUEST,
      });
      const cardsToAdd: Flashcard[] = generatedDeck.cards.map((card) => ({
        id: createId('ai-deck'),
        term: card.term,
        translation: card.translation,
        example: card.example || `${card.term} - ${card.translation}`,
        exampleTranslation: card.exampleTranslation,
        known: 0,
        missed: 0,
        streak: 0,
        ease: DEFAULT_EASE,
        intervalDays: 0,
        nextReviewAt: new Date(0).toISOString(),
      }));

      if (cardsToAdd.length < 10) {
        setNotice(
          `OpenAI returned only ${cardsToAdd.length} cards. Try a broader goal.`,
        );
        return;
      }

      const deckId = createId('ai-themed-deck');
      const deckName = generatedDeck.deckName.trim() || goal;

      setLibrary((current) => ({
        ...current,
        languages: current.languages.map((language) =>
          language.id === selectedLanguage.id
            ? {
                ...language,
                decks: [
                  ...language.decks,
                  { id: deckId, name: deckName, cards: cardsToAdd },
                ],
              }
            : language,
        ),
        selectedDeckId: deckId,
      }));
      setDeckGoal('');
      setCardIndex(0);
      setScreen('library');
      setNotice(
        `Created ${deckName} with ${cardsToAdd.length} cards in ${selectedLanguage.name}.`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `Deck generation error: ${error.message}`
          : 'Deck generation error.',
      );
    } finally {
      setDeckGoalLoading(false);
    }
  }

  function renameSelectedDeck() {
    const name = deckNameDraft.trim();
    if (!selectedDeck || !name) {
      setNotice('Enter a deck name first.');
      return;
    }

    updateSelectedDeck((deck) => ({ ...deck, name }), `Renamed deck to ${name}.`);
  }

  function deleteSelectedDeck() {
    if (!selectedLanguage || !selectedDeck) return;
    if (selectedLanguage.decks.length === 1) {
      setNotice('A language must keep at least one deck.');
      return;
    }

    setConfirmRequest({
      title: 'Delete deck?',
      message: `${selectedDeck.name} and all ${selectedDeck.cards.length} cards will be deleted.`,
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: () => {
        const remainingDecks = selectedLanguage.decks.filter(
          (deck) => deck.id !== selectedDeck.id,
        );
        setLibrary((current) => ({
          ...current,
          languages: current.languages.map((language) =>
            language.id === selectedLanguage.id
              ? { ...language, decks: remainingDecks }
              : language,
          ),
          selectedDeckId: remainingDecks[0].id,
        }));
        setNotice(`Deleted the ${selectedDeck.name} deck.`);
      },
    });
  }

  function updateSelectedDeck(
    update: (deck: Deck) => Deck,
    message?: string,
  ) {
    if (!selectedLanguage || !selectedDeck) {
      setNotice('Create or select a language and deck first.');
      return false;
    }

    setLibrary((current) => ({
      ...current,
      languages: current.languages.map((language) =>
        language.id === selectedLanguage.id
          ? {
              ...language,
              decks: language.decks.map((deck) =>
                deck.id === selectedDeck.id ? update(deck) : deck,
              ),
            }
          : language,
      ),
    }));
    if (message) setNotice(message);
    return true;
  }

  function saveNewCard() {
    const term = newTerm.trim();
    const translation = newTranslation.trim();
    const example = newExample.trim();
    const exampleTranslation = newExampleTranslation.trim();

    if (!term || !translation) {
      setNotice('Enter both a word or phrase and its translation.');
      return;
    }

    const card: Flashcard = {
      id: createId('manual'),
      term,
      translation,
      example: example || `${term} - ${translation}`,
      exampleTranslation,
      known: 0,
      missed: 0,
      streak: 0,
      ease: DEFAULT_EASE,
      intervalDays: 0,
      nextReviewAt: new Date(0).toISOString(),
    };
    if (
      !updateSelectedDeck(
        (deck) => ({ ...deck, cards: [card, ...deck.cards] }),
        `Saved to ${selectedLanguage?.name} / ${selectedDeck?.name}.`,
      )
    ) {
      return;
    }

    setNewTerm('');
    setNewTranslation('');
    setNewExample('');
    setNewExampleTranslation('');
    setCardIndex(0);
    setScreen('library');
  }

  function saveGeneratedCards(generatedCards: GeneratedFlashcard[]) {
    if (!generatedCards.length) {
      setNotice('No useful flashcards were found.');
      return;
    }

    const nextCards: Flashcard[] = generatedCards.map((card) => ({
      id: createId('ai'),
      term: card.term,
      translation: card.translation,
      example: card.example || `${card.term} - ${card.translation}`,
      exampleTranslation: card.exampleTranslation,
      known: 0,
      missed: 0,
      streak: 0,
      ease: DEFAULT_EASE,
      intervalDays: 0,
      nextReviewAt: new Date(0).toISOString(),
    }));
    if (
      !updateSelectedDeck(
        (deck) => ({ ...deck, cards: [...nextCards, ...deck.cards] }),
        `Added ${nextCards.length} cards to ${selectedLanguage?.name} / ${selectedDeck?.name}.`,
      )
    ) {
      return;
    }

    setSourceText('');
    setSelectedImageLabel('');
    setAiPreviewCards([]);
    setSelectedPreviewIndexes([]);
    setCardIndex(0);
    setScreen('library');
  }

  function markCard(grade: Grade) {
    if (!activeCard) return;

    const wasDue = isDue(activeCard);
    const reviewedCard = applyReviewResult(activeCard, grade);

    updateSelectedDeck((deck) => ({
      ...deck,
      cards: deck.cards.map((card) =>
        card.id === activeCard.id ? reviewedCard : card,
      ),
    }));
    setShowTranslation(false);

    // Emptying the round makes the effect above build a fresh one, so practice
    // continues instead of stopping at the end of the deck.
    const nextIndex = cardIndex + 1;
    if (nextIndex >= reviewCards.length) {
      setPractice((current) => ({ ...current, ids: [] }));
      setCardIndex(0);
    } else {
      setCardIndex(nextIndex);
    }

    recordActivity({ units: 1, xp: GRADE_XP[grade] });
    void Haptics.notificationAsync(
      grade === 'again'
        ? Haptics.NotificationFeedbackType.Warning
        : Haptics.NotificationFeedbackType.Success,
    );
    setNotice(
      grade === 'again'
        ? 'Marked as not known. It will come back tomorrow, and more often.'
        : wasDue
          ? `Scheduled again in ${reviewedCard.intervalDays} day${
              reviewedCard.intervalDays === 1 ? '' : 's'
            }.`
          : 'Extra practice counted. Its review date is unchanged.',
    );
  }

  /** Loads a card into the shared edit form. Used by both the review card and
   *  the deck browser, so a typo can be fixed from wherever it is noticed. */
  function beginEditingCard(card: Flashcard) {
    setEditingCardId(card.id);
    setEditTerm(card.term);
    setEditTranslation(card.translation);
    setEditExample(card.example);
    setEditExampleTranslation(card.exampleTranslation);
  }

  function beginEditingActiveCard() {
    if (!activeCard) return;
    beginEditingCard(activeCard);
  }

  function saveCardEdits() {
    if (!editingCardId || !editTerm.trim() || !editTranslation.trim()) {
      setNotice('A card needs both a term and translation.');
      return;
    }

    updateSelectedDeck(
      (deck) => ({
        ...deck,
        cards: deck.cards.map((card) =>
          card.id === editingCardId
            ? {
                ...card,
                term: editTerm.trim(),
                translation: editTranslation.trim(),
                example:
                  editExample.trim() ||
                  `${editTerm.trim()} - ${editTranslation.trim()}`,
                exampleTranslation: editExampleTranslation.trim(),
              }
            : card,
        ),
      }),
      'Card updated.',
    );
    setEditingCardId('');
  }

  function deleteCard(target: Flashcard) {
    setConfirmRequest({
      title: 'Delete card?',
      message: target.term,
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: () => {
        updateSelectedDeck(
          (deck) => ({
            ...deck,
            cards: deck.cards.filter((card) => card.id !== target.id),
          }),
          'Card deleted.',
        );
        setEditingCardId('');
        // The practice round still holds the deleted id; clearing it rebuilds
        // a fresh round rather than leaving a gap mid-session.
        setPractice((current) => ({ ...current, ids: [] }));
        setCardIndex(0);
      },
    });
  }

  function deleteActiveCard() {
    if (!activeCard) return;
    deleteCard(activeCard);
  }

  function previewGeneratedCards(generatedCards: GeneratedFlashcard[]) {
    if (!generatedCards.length) {
      setNotice('No useful flashcards were found.');
      return;
    }

    setAiPreviewCards(generatedCards);
    setSelectedPreviewIndexes(generatedCards.map((_, index) => index));
    setNotice(`Review ${generatedCards.length} AI cards before saving.`);
  }

  function togglePreviewCard(index: number) {
    setSelectedPreviewIndexes((current) =>
      current.includes(index)
        ? current.filter((item) => item !== index)
        : [...current, index],
    );
  }

  function saveSelectedPreviewCards() {
    const selectedCards = aiPreviewCards.filter((_, index) =>
      selectedPreviewIndexes.includes(index),
    );
    if (!selectedCards.length) {
      setNotice('Select at least one AI card to save.');
      return;
    }
    saveGeneratedCards(selectedCards);
  }

  async function analyzeText() {
    if (!supabase || !selectedLanguage || !selectedDeck) {
      setNotice('Select a destination deck and configure Supabase first.');
      return;
    }
    if (!sourceText.trim()) {
      setNotice('Paste text or a word list first.');
      return;
    }

    setAiLoading(true);
    try {
      previewGeneratedCards(
        await analyzeLearningMaterial({
          mode: aiMode,
          nativeLanguage: library.motherTongue,
          learningLanguage: selectedLanguage.name,
          text: sourceText,
          maxCards: MAX_AI_CARDS_PER_REQUEST,
        }),
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? `OpenAI error: ${error.message}` : 'OpenAI error.',
      );
    } finally {
      setAiLoading(false);
    }
  }

  async function analyzeImage(asset: ImagePicker.ImagePickerAsset) {
    if (!supabase || !selectedLanguage || !selectedDeck) {
      setNotice('Select a destination deck and configure Supabase first.');
      return;
    }
    setAiLoading(true);
    setSelectedImageLabel(asset.fileName ?? 'Selected photo');
    try {
      // Browsers do not always populate `base64`, so the platform wrapper reads
      // the underlying File when it is missing.
      const imageBase64 = await readAssetBase64(asset);

      if (!imageBase64) {
        setNotice('The selected image did not include readable image data.');
        return;
      }
      if (estimateBase64Bytes(imageBase64) > MAX_IMAGE_BYTES) {
        setNotice(
          'This photo is too large to analyze safely. Crop it to the text area or choose a smaller image.',
        );
        return;
      }

      previewGeneratedCards(
        await analyzeLearningMaterial({
          mode: aiMode,
          nativeLanguage: library.motherTongue,
          learningLanguage: selectedLanguage.name,
          text: sourceText,
          imageBase64,
          imageMimeType: asset.mimeType ?? 'image/jpeg',
          maxCards: MAX_AI_CARDS_PER_REQUEST,
        }),
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `Image analysis error: ${error.message}`
          : 'Image analysis error.',
      );
    } finally {
      setAiLoading(false);
    }
  }

  async function choosePdf() {
    if (!supabase || !selectedLanguage || !selectedDeck) {
      setNotice('Select a destination deck and configure Supabase first.');
      return;
    }

    try {
      const picked = await pickPdf();
      if (!picked) return;

      if (estimateBase64Bytes(picked.base64) > MAX_PDF_BYTES) {
        setNotice(
          'This PDF is too large to analyze. Split it into smaller files, or export just the pages you need.',
        );
        return;
      }

      setAiLoading(true);
      setSelectedImageLabel(picked.fileName);

      previewGeneratedCards(
        await analyzeLearningMaterial({
          mode: aiMode,
          nativeLanguage: library.motherTongue,
          learningLanguage: selectedLanguage.name,
          text: sourceText,
          pdfBase64: picked.base64,
          pdfFileName: picked.fileName,
          maxCards: MAX_AI_CARDS_PER_REQUEST,
        }),
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `PDF analysis error: ${error.message}`
          : 'PDF analysis error.',
      );
    } finally {
      setAiLoading(false);
    }
  }

  async function choosePhoto() {
    try {
      const permission = await requestPhotoLibraryAccess();
      if (!permission.granted) {
        setNotice(permission.message);
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        base64: true,
        quality: 0.65,
      });
      if (!result.canceled && result.assets[0]) {
        await analyzeImage(result.assets[0]);
      }
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `Photo picker error: ${error.message}`
          : 'The photo picker could not be opened.',
      );
    }
  }

  async function takePhoto() {
    try {
      const permission = await requestCameraAccess();
      if (!permission.granted) {
        setNotice(permission.message);
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        base64: true,
        quality: 0.65,
      });
      if (!result.canceled && result.assets[0]) {
        await analyzeImage(result.assets[0]);
      }
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `Camera error: ${error.message}`
          : 'The camera could not be opened.',
      );
    }
  }

  function choosePracticeSentence(sentence: string) {
    setPracticeSentence(sentence);
    setSpokenTranscript('');
    setPronunciationFeedback(null);
  }

  async function requestTextFeedback() {
    if (!supabase || !selectedLanguage) {
      setNotice('Configure Supabase and select a language first.');
      return;
    }
    if (!practiceSentence.trim() || !spokenTranscript.trim()) {
      setNotice('Choose a deck phrase and enter what you said.');
      return;
    }

    setAiLoading(true);
    try {
      const feedback = await getPronunciationFeedback({
        expectedSentence: practiceSentence,
        learningLanguage: selectedLanguage.name,
        transcript: spokenTranscript,
      });
      setPronunciationFeedback(feedback);
      setNotice(`Feedback received for the ${selectedDeck?.name} deck.`);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `Pronunciation error: ${error.message}`
          : 'Pronunciation error.',
      );
    } finally {
      setAiLoading(false);
    }
  }

  async function startRecording() {
    if (!supabase || !practiceSentence.trim()) {
      setNotice('Choose a phrase from the selected deck first.');
      return;
    }
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setNotice(
          permission.canAskAgain
            ? microphoneRequiredMessage
            : microphoneUnavailableMessage,
        );
        return;
      }

      speechPlayer.pause();
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      recordingStopInFlightRef.current = false;
      setPronunciationFeedback(null);
      setNotice('Recording the selected deck phrase (30 seconds maximum)...');

      if (recordingTimerRef.current) {
        clearTimeout(recordingTimerRef.current);
      }
      recordingTimerRef.current = setTimeout(() => {
        setNotice('The 30-second recording limit was reached. Sending feedback...');
        void stopRecording();
      }, MAX_RECORDING_DURATION_MS);
    } catch (error) {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      }).catch(() => undefined);
      setNotice(
        error instanceof Error
          ? `Recording setup error: ${error.message}`
          : 'The microphone could not start recording.',
      );
    }
  }

  async function stopRecording() {
    if (
      !audioRecorder.isRecording ||
      !selectedLanguage ||
      recordingStopInFlightRef.current
    ) {
      return;
    }
    recordingStopInFlightRef.current = true;

    if (recordingTimerRef.current) {
      clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    setAiLoading(true);
    try {
      await audioRecorder.stop();
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });
      if (!audioRecorder.uri) {
        setNotice('No audio file was created.');
        return;
      }

      const recording = await readRecording(audioRecorder.uri);
      if (estimateBase64Bytes(recording.base64) > MAX_RECORDING_BYTES) {
        setNotice(
          'The recording is too large to analyze. Please record a shorter phrase.',
        );
        return;
      }
      const feedback = await getPronunciationFeedback({
        expectedSentence: practiceSentence,
        learningLanguage: selectedLanguage.name,
        audioBase64: recording.base64,
        audioMimeType: recording.mimeType,
        fileName: recording.fileName,
      });
      setPronunciationFeedback(feedback);
      setSpokenTranscript(feedback.transcript);
      if (screen === 'lesson' && lessonStage === 'speaking') {
        const isNewRecording =
          !completedLessonRecordings.includes(practiceSentence);
        setCompletedLessonRecordings((current) =>
          current.includes(practiceSentence)
            ? current
            : [...current, practiceSentence],
        );
        if (isNewRecording) {
          recordActivity({ units: 1, xp: 10 });
        }
      }
      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );
      setNotice(`Feedback received for the ${selectedDeck?.name} deck.`);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `Recording error: ${error.message}`
          : 'Recording error.',
      );
    } finally {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      }).catch(() => undefined);
      recordingStopInFlightRef.current = false;
      setAiLoading(false);
    }
  }

  async function shareBackup() {
    try {
      const backup = JSON.stringify(
        {
          app: 'Language Learning App',
          exportedAt: new Date().toISOString(),
          library,
        },
        null,
        2,
      );
      const fileName = `language-learning-backup-${getLocalDateKey()}.json`;
      const result = await exportBackup(fileName, backup);
      setNotice(result.message);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `Backup error: ${error.message}`
          : 'Backup error.',
      );
    }
  }

  async function loadBackupFromFile() {
    try {
      const contents = await pickBackupFile();

      if (!contents) return;

      setBackupText(contents);
      confirmRestore(contents);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `Backup file error: ${error.message}`
          : 'That file could not be read.',
      );
    }
  }

  function restoreBackup() {
    confirmRestore(backupText);
  }

  function confirmRestore(rawBackup: string) {
    try {
      const parsed = JSON.parse(rawBackup) as
        | LibraryState
        | { library?: LibraryState };
      const restored =
        'library' in parsed && parsed.library ? parsed.library : parsed;
      const normalized = normalizeLibrary(restored as LibraryState);
      const cardCount = normalized.languages.reduce(
        (total, language) =>
          total +
          language.decks.reduce((deckTotal, deck) => deckTotal + deck.cards.length, 0),
        0,
      );

      setConfirmRequest({
        title: 'Restore backup?',
        message: `This replaces the library stored on this device with ${cardCount} card${cardCount === 1 ? '' : 's'}.`,
        confirmLabel: 'Restore',
        destructive: true,
        onConfirm: () => {
          setLibrary(normalized);
          setBackupText('');
          setNotice('Backup restored successfully.');
        },
      });
    } catch {
      setNotice('That text is not a valid app backup.');
    }
  }

  function renderTargetSelector(title = 'Destination') {
    return (
      <View style={styles.targetBlock}>
        <Text style={styles.sectionLabel}>{title}</Text>
        <Text style={styles.label}>Language folder</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.chipRow}>
            {library.languages.map((language) => (
              <ChoiceChip
                key={language.id}
                active={language.id === library.selectedLanguageId}
                label={language.name}
                onPress={() => selectLanguage(language.id)}
              />
            ))}
          </View>
        </ScrollView>

        <Text style={styles.label}>Deck</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.chipRow}>
            {(selectedLanguage?.decks ?? []).map((deck) => (
              <ChoiceChip
                key={deck.id}
                active={deck.id === library.selectedDeckId}
                label={`${deck.name} (${deck.cards.length})`}
                onPress={() => selectDeck(deck.id)}
              />
            ))}
          </View>
        </ScrollView>

        <View style={styles.inlineForm}>
          <TextInput
            accessibilityLabel="New destination deck name"
            onChangeText={setNewDeckName}
            placeholder="New deck name"
            placeholderTextColor="#79838C"
            style={[styles.input, styles.inlineInput]}
            value={newDeckName}
          />
          <Pressable
            accessibilityRole="button"
            onPress={addDeck}
            style={styles.compactButton}
          >
            <Text style={styles.compactButtonText}>Add deck</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  function renderLibrary() {
    const goalProgress = Math.min(activity.todayProgress / DAILY_GOAL, 1);
    const goalComplete = activity.todayProgress >= DAILY_GOAL;

    return (
      <ScrollView
        contentContainerStyle={[styles.scrollContent, contentColumn]}
      >
        <Header
          kicker={getGreeting()}
          title="Your learning day"
          badge={selectedLanguage?.name ?? 'Choose language'}
        />

        <View style={styles.dailyPanel}>
          <View style={styles.dailyPanelHeader}>
            <View style={styles.dailyTitleRow}>
              <View style={styles.dailyIconBox}>
                <Flame color="#B65F32" size={22} strokeWidth={2.4} />
              </View>
              <View>
                <Text style={styles.dailyEyebrow}>TODAY</Text>
                <Text style={styles.dailyTitle}>
                  {goalComplete ? 'Goal complete' : 'Keep your momentum'}
                </Text>
              </View>
            </View>
            <View style={styles.xpBadge}>
              <Trophy color="#8A4B2C" size={15} strokeWidth={2.4} />
              <Text style={styles.xpBadgeText}>{activity.todayXp} XP today</Text>
            </View>
          </View>

          <View style={styles.momentumRow}>
            <View style={styles.momentumItem}>
              <Text style={styles.momentumValue}>{activity.streakDays}</Text>
              <Text style={styles.momentumLabel}>day streak</Text>
            </View>
            <View style={styles.momentumDivider} />
            <View style={styles.momentumItem}>
              <Text style={styles.momentumValue}>{dueCards.length}</Text>
              <Text style={styles.momentumLabel}>cards due</Text>
            </View>
            <View style={styles.momentumDivider} />
            <View style={styles.momentumItem}>
              <Text style={styles.momentumValue}>{accuracy}%</Text>
              <Text style={styles.momentumLabel}>accuracy</Text>
            </View>
          </View>

          <View style={styles.goalBlock}>
            <View style={styles.goalLabelRow}>
              <Text style={styles.goalLabel}>Daily practice</Text>
              <Text style={styles.goalValue}>
                {Math.min(activity.todayProgress, DAILY_GOAL)}/{DAILY_GOAL}
              </Text>
            </View>
            <View style={styles.dailyProgressTrack}>
              <View
                style={[
                  styles.dailyProgressFill,
                  { width: `${goalProgress * 100}%` },
                ]}
              />
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !cards.length }}
            disabled={!cards.length}
            onPress={startLessonFromDashboard}
            style={({ pressed }) => [
              styles.dailyStartButton,
              pressed && styles.pressed,
              !cards.length && styles.disabled,
            ]}
          >
            <Play color="#FFFFFF" fill="#FFFFFF" size={19} strokeWidth={2.5} />
            <View style={styles.dailyStartTextBlock}>
              <Text style={styles.dailyStartButtonText}>Start a lesson</Text>
              <Text style={styles.dailyStartButtonSubtext} numberOfLines={1}>
                {selectedDeck?.name ?? 'Choose a deck'} - up to 10 questions
              </Text>
            </View>
          </Pressable>

          <View style={styles.quickActionRow}>
            <ActionButton
              icon={Plus}
              label="Add cards"
              onPress={() => changeScreen('add')}
            />
            <ActionButton
              icon={Sparkles}
              label="AI tools"
              onPress={() => changeScreen('ai')}
            />
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showLibraryManagement }}
          onPress={() => {
            void Haptics.selectionAsync();
            setShowLibraryManagement((current) => !current);
          }}
          style={({ pressed }) => [
            styles.managementToggle,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.managementToggleLabel}>
            <Settings2 color="#38424C" size={19} strokeWidth={2.2} />
            <Text style={styles.managementToggleText}>Manage library</Text>
          </View>
          {showLibraryManagement ? (
            <ChevronUp color="#52606D" size={20} />
          ) : (
            <ChevronDown color="#52606D" size={20} />
          )}
        </Pressable>

        {showLibraryManagement ? (
          <View style={managementGrid}>
        <View style={[styles.panel, managementPanel]}>
          <Text style={styles.panelTitle}>Languages</Text>
          <Text style={styles.panelText}>
            Each language is a folder containing its own decks.
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.chipRow}>
              {library.languages.map((language) => (
                <ChoiceChip
                  key={language.id}
                  active={language.id === library.selectedLanguageId}
                  label={language.name}
                  onPress={() => selectLanguage(language.id)}
                />
              ))}
            </View>
          </ScrollView>
          <View style={styles.inlineForm}>
            <TextInput
              accessibilityLabel="New language name"
              onChangeText={setNewLanguageName}
              placeholder="Language name"
              placeholderTextColor="#79838C"
              style={[styles.input, styles.inlineInput]}
              value={newLanguageName}
            />
            <Pressable
              accessibilityRole="button"
              onPress={addLanguage}
              style={styles.compactButton}
            >
              <Text style={styles.compactButtonText}>Add language</Text>
            </Pressable>
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Translation language</Text>
            <TextInput
              accessibilityLabel="Translation language"
              onChangeText={(motherTongue) =>
                setLibrary((current) => ({ ...current, motherTongue }))
              }
              placeholder="Your mother tongue"
              placeholderTextColor="#79838C"
              style={styles.input}
              value={library.motherTongue}
            />
          </View>
        </View>

        <View style={[styles.panel, managementPanel]}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.panelTitle}>{selectedLanguage?.name}</Text>
              <Text style={styles.panelText}>Choose a deck to study.</Text>
            </View>
          </View>
          <View style={styles.deckGrid}>
            {(selectedLanguage?.decks ?? []).map((deck) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  selected: deck.id === library.selectedDeckId,
                }}
                key={deck.id}
                onPress={() => selectDeck(deck.id)}
                style={[
                  styles.deckTile,
                  deckTileWidth,
                  deck.id === library.selectedDeckId && styles.deckTileActive,
                ]}
              >
                <View style={styles.deckTileRow}>
                  <View style={styles.deckTileCopy}>
                    <Text style={styles.deckName}>{deck.name}</Text>
                    <Text style={styles.deckCount}>
                      {deck.cards.length} cards
                    </Text>
                  </View>
                  {deck.cards.length ? (
                    <MasteryRing percent={deckMastery(deck.cards).percent} />
                  ) : null}
                </View>
              </Pressable>
            ))}
          </View>
          <View style={styles.inlineForm}>
            <TextInput
              accessibilityLabel="New deck name"
              onChangeText={setNewDeckName}
              placeholder="New deck name"
              placeholderTextColor="#79838C"
              style={[styles.input, styles.inlineInput]}
              value={newDeckName}
            />
            <Pressable
              accessibilityRole="button"
              onPress={addDeck}
              style={styles.compactButton}
            >
              <Text style={styles.compactButtonText}>Add deck</Text>
            </Pressable>
          </View>
          <Text style={styles.sectionLabel}>Selected deck settings</Text>
          <View style={styles.inlineForm}>
            <TextInput
              accessibilityLabel="Selected deck name"
              onChangeText={setDeckNameDraft}
              placeholder="Deck name"
              placeholderTextColor="#79838C"
              style={[styles.input, styles.inlineInput]}
              value={deckNameDraft}
            />
            <Pressable
              accessibilityRole="button"
              onPress={renameSelectedDeck}
              style={styles.compactButton}
            >
              <Text style={styles.compactButtonText}>Rename</Text>
            </Pressable>
          </View>
          <ActionButton
            kind="danger"
            label="Delete selected deck"
            onPress={deleteSelectedDeck}
          />
        </View>

        <View style={[styles.panel, managementPanel]}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.panelTitle}>AI Deck Builder</Text>
              <Text style={styles.panelText}>
                Describe a goal and create a new deck with at least 10 cards.
              </Text>
            </View>
            {deckGoalLoading ? <ActivityIndicator color="#1F5E59" /> : null}
          </View>
          <TextInput
            accessibilityLabel="AI deck goal"
            multiline
            onChangeText={setDeckGoal}
            placeholder="Example: clothing, hotel check-in, food market"
            placeholderTextColor="#79838C"
            style={[styles.input, styles.textArea]}
            value={deckGoal}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{
              disabled: deckGoalLoading || !deckGoal.trim() || !supabase,
            }}
            disabled={deckGoalLoading || !deckGoal.trim() || !supabase}
            onPress={createDeckFromGoal}
            style={[
              styles.primaryButton,
              (deckGoalLoading || !deckGoal.trim() || !supabase) &&
                styles.disabled,
            ]}
          >
            <Text style={styles.primaryButtonText}>
              {deckGoalLoading
                ? 'Creating deck...'
                : `Create deck in ${selectedLanguage?.name}`}
            </Text>
          </Pressable>
          {!supabase ? (
            <Text style={styles.panelText}>
              Supabase Edge Functions are required for AI deck creation.
            </Text>
          ) : null}
        </View>
          </View>
        ) : null}

        <DisclosureRow
          expanded={showProgress}
          icon={Flame}
          onPress={() => setShowProgress((current) => !current)}
          subtitle={`${practisedDays} day${practisedDays === 1 ? '' : 's'} practised · ${milestones.filter((m) => m.earned).length}/${milestones.length} milestones`}
          title="Your progress"
        />

        {showProgress ? (
          <View style={styles.panel}>
            <PracticeCalendar weeks={practiceCalendar} />

            <Text style={styles.sectionLabel}>Milestones</Text>
            <View style={styles.milestoneGrid}>
              {milestones.map((milestone) => (
                <View
                  key={milestone.id}
                  style={[
                    styles.milestone,
                    milestone.earned && styles.milestoneEarned,
                  ]}
                >
                  <Text
                    style={[
                      styles.milestoneLabel,
                      milestone.earned && styles.milestoneLabelEarned,
                    ]}
                  >
                    {milestone.label}
                  </Text>
                  <Text
                    style={[
                      styles.milestoneDetail,
                      milestone.earned && styles.milestoneDetailEarned,
                    ]}
                  >
                    {milestone.earned
                      ? 'Earned'
                      : `${Math.min(milestone.progress, milestone.target)}/${milestone.target} · ${milestone.requirement}`}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <DisclosureRow
          expanded={showAllCards}
          icon={Library}
          onPress={() => setShowAllCards((current) => !current)}
          subtitle={`${cards.length} card${cards.length === 1 ? '' : 's'} in ${selectedDeck?.name ?? 'this deck'}`}
          title="All cards"
        />

        {showAllCards ? (
          <View style={styles.panel}>
            {cards.length > 8 ? (
              <TextInput
                accessibilityLabel="Search cards"
                autoCapitalize="none"
                onChangeText={setCardSearch}
                placeholder="Search this deck"
                placeholderTextColor="#79838C"
                style={styles.input}
                value={cardSearch}
              />
            ) : null}

            {!cards.length ? (
              <Text style={styles.panelText}>
                This deck has no cards yet. Add them by hand or with AI.
              </Text>
            ) : !browsedCards.length ? (
              <Text style={styles.panelText}>
                Nothing matches &ldquo;{cardSearch.trim()}&rdquo;.
              </Text>
            ) : (
              <>
                {cardSearch.trim() ? (
                  <Text style={styles.contextText}>
                    {browsedCards.length} of {cards.length} cards
                  </Text>
                ) : null}

                {browsedCards.map((card) => {
                  const expanded = expandedCardId === card.id;
                  const editing = editingCardId === card.id;

                  return (
                    <View key={card.id} style={styles.browseCard}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ expanded }}
                        onPress={() => {
                          setExpandedCardId(expanded ? '' : card.id);
                          // Collapsing while editing would strand the form.
                          if (expanded && editing) setEditingCardId('');
                        }}
                        style={({ pressed }) => [
                          styles.browseCardHeader,
                          pressed && styles.pressed,
                        ]}
                      >
                        <View style={styles.browseCardCopy}>
                          <Text style={styles.browseCardTerm}>{card.term}</Text>
                          <Text numberOfLines={1} style={styles.browseCardTranslation}>
                            {card.translation}
                          </Text>
                        </View>
                        <StrengthBadge strength={cardStrength(card)} />
                      </Pressable>

                      {expanded && !editing ? (
                        <View style={styles.browseCardBody}>
                          {card.example ? (
                            <Text style={styles.browseCardExample}>
                              {card.example}
                            </Text>
                          ) : null}
                          {card.exampleTranslation ? (
                            <Text style={styles.browseCardExampleTranslation}>
                              {card.exampleTranslation}
                            </Text>
                          ) : null}
                          <Text style={styles.contextText}>
                            Seen {card.known + card.missed} time
                            {card.known + card.missed === 1 ? '' : 's'} ·{' '}
                            next review in {card.intervalDays || 0} day
                            {(card.intervalDays || 0) === 1 ? '' : 's'}
                          </Text>
                          <View style={styles.actionRow}>
                            <ActionButton
                              label="Edit"
                              onPress={() => beginEditingCard(card)}
                            />
                            <ActionButton
                              kind="danger"
                              label="Delete"
                              onPress={() => deleteCard(card)}
                            />
                          </View>
                        </View>
                      ) : null}

                      {expanded && editing ? (
                        <View style={styles.browseCardBody}>
                          <Field
                            label="Word or phrase"
                            onChangeText={setEditTerm}
                            placeholder="Term"
                            value={editTerm}
                          />
                          <Field
                            label="Translation"
                            onChangeText={setEditTranslation}
                            placeholder="Translation"
                            value={editTranslation}
                          />
                          <Field
                            label="Practice sentence"
                            multiline
                            onChangeText={setEditExample}
                            placeholder="Practice sentence"
                            value={editExample}
                          />
                          <Field
                            label="Sentence translation"
                            multiline
                            onChangeText={setEditExampleTranslation}
                            placeholder={`Full sentence in ${library.motherTongue}`}
                            value={editExampleTranslation}
                          />
                          <View style={styles.actionRow}>
                            <ActionButton
                              kind="primary"
                              label="Save changes"
                              onPress={saveCardEdits}
                            />
                            <ActionButton
                              label="Cancel"
                              onPress={() => setEditingCardId('')}
                            />
                          </View>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </>
            )}
          </View>
        ) : null}

        <View style={styles.statsRow}>
          <Stat value={String(cards.length)} label="Cards" />
          <Stat value={String(activity.lessonsCompleted)} label="Lessons" />
          <Stat value={String(activity.perfectLessons)} label="Perfect" />
        </View>

        <View style={styles.reviewHeading}>
          <View>
            <Text style={styles.sectionLabel}>Quick review</Text>
            <Text style={styles.contextText}>
              {selectedLanguage?.name} / {selectedDeck?.name}
            </Text>
          </View>
          <Text style={styles.reviewCount}>
            {dueCards.length} due
            {weakCardCount ? ` · ${weakCardCount} need work` : ''}
          </Text>
        </View>
        {!dueCards.length && cards.length ? (
          <View style={styles.caughtUpBox}>
            <Text style={styles.caughtUpTitle}>You are caught up</Text>
            <Text style={styles.panelText}>
              Keep practising as long as you like — the words you find hardest
              come up most. Answering one correctly early will not change its
              review date.
            </Text>
          </View>
        ) : null}
        {activeCard ? (
          <>
            <Pressable
              accessibilityHint={
                showTranslation
                  ? 'Hides the translation and example'
                  : 'Shows the translation and example'
              }
              accessibilityLabel={`${activeCard.term}. ${showTranslation ? 'Translation shown' : 'Translation hidden'}`}
              accessibilityRole="button"
              accessibilityState={{ expanded: showTranslation }}
              onPress={toggleCardTranslation}
              style={styles.card}
            >
              <View style={styles.cardLabelRow}>
                <Text style={styles.cardLabel}>
                  {isDue(activeCard) ? 'Due card' : 'Extra practice'}{' '}
                  {cardIndex + 1} of {reviewCards.length}
                </Text>
                <StrengthBadge strength={cardStrength(activeCard)} />
              </View>
              <Text style={styles.cardTerm}>{activeCard.term}</Text>
              <Text style={styles.cardHint}>
                {showTranslation ? 'Hide translation' : 'Show translation'}
              </Text>
              {showTranslation ? (
                <View style={styles.translationBlock}>
                  <Text style={styles.translationText}>
                    {activeCard.translation}
                  </Text>
                  <Text style={styles.exampleText}>{activeCard.example}</Text>
                  {activeCard.exampleTranslation ? (
                    <Text style={styles.exampleTranslationText}>
                      {activeCard.exampleTranslation}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </Pressable>
            <View style={styles.actionRow}>
              <ActionButton
                disabled={Boolean(speechLoadingText)}
                icon={Volume2}
                label="Hear word"
                onPress={() => playSentence(activeCard.term)}
              />
              <ActionButton
                disabled={
                  !activeCard.example.trim() || Boolean(speechLoadingText)
                }
                label={
                  speechLoadingText === activeCard.example
                    ? 'Generating voice...'
                    : 'Hear sentence'
                }
                icon={Volume2}
                onPress={() => playSentence(activeCard.example)}
              />
            </View>
          </>
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>
              This deck is empty. Add cards manually or with AI.
            </Text>
          </View>
        )}

        <View style={styles.gradeGrid}>
          {GRADE_BUTTONS.map((button) => (
            <View key={button.grade} style={gradeButtonStyle}>
              <ActionButton
                disabled={!activeCard}
                icon={button.icon}
                kind={button.kind}
                label={button.label}
                onPress={() => markCard(button.grade)}
              />
            </View>
          ))}
        </View>

        {activeCard ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showCardSettings }}
            onPress={() => setShowCardSettings((current) => !current)}
            style={({ pressed }) => [
              styles.cardSettingsToggle,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.managementToggleLabel}>
              <Settings2 color="#52606D" size={17} />
              <Text style={styles.cardSettingsToggleText}>Card options</Text>
            </View>
            {showCardSettings ? (
              <ChevronUp color="#52606D" size={18} />
            ) : (
              <ChevronDown color="#52606D" size={18} />
            )}
          </Pressable>
        ) : null}

        {activeCard && showCardSettings ? (
          <View style={styles.panel}>
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>Card Settings</Text>
              <Text style={styles.panelText}>
                Interval: {activeCard.intervalDays || 0} days
              </Text>
            </View>
            {editingCardId === activeCard.id ? (
              <>
                <Field
                  label="Word or phrase"
                  onChangeText={setEditTerm}
                  placeholder="Term"
                  value={editTerm}
                />
                <Field
                  label="Translation"
                  onChangeText={setEditTranslation}
                  placeholder="Translation"
                  value={editTranslation}
                />
                <Field
                  label="Practice sentence"
                  multiline
                  onChangeText={setEditExample}
                  placeholder="Practice sentence"
                  value={editExample}
                />
                <Field
                  label="Sentence translation"
                  multiline
                  onChangeText={setEditExampleTranslation}
                  placeholder={`Full sentence in ${library.motherTongue}`}
                  value={editExampleTranslation}
                />
                <View style={styles.actionRow}>
                  <ActionButton
                    kind="primary"
                    label="Save changes"
                    onPress={saveCardEdits}
                  />
                  <ActionButton
                    label="Cancel"
                    onPress={() => setEditingCardId('')}
                  />
                </View>
              </>
            ) : (
              <View style={styles.actionRow}>
                <ActionButton
                  label="Edit card"
                  onPress={beginEditingActiveCard}
                />
                <ActionButton
                  kind="danger"
                  label="Delete card"
                  onPress={deleteActiveCard}
                />
              </View>
            )}
          </View>
        ) : null}

        {showLibraryManagement ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Backup & Restore</Text>
          <Text style={styles.panelText}>{backupExportHint}</Text>
          <ActionButton label={backupExportLabel} onPress={shareBackup} />
          {supportsBackupFilePicker ? (
            <ActionButton
              label="Load backup file"
              onPress={() => void loadBackupFromFile()}
            />
          ) : null}
          <TextInput
            accessibilityLabel="Backup JSON"
            multiline
            onChangeText={setBackupText}
            placeholder="Paste backup JSON here"
            placeholderTextColor="#79838C"
            style={[styles.input, styles.textArea, styles.backupInput]}
            value={backupText}
          />
          <ActionButton
            disabled={!backupText.trim()}
            kind="danger"
            label="Restore pasted backup"
            onPress={restoreBackup}
          />
        </View>
        ) : null}
      </ScrollView>
    );
  }

  function renderLesson() {
    const question = lessonQuestions[lessonQuestionIndex];
    const checkedAnswer = lessonChecked
      ? lessonAnswers[lessonAnswers.length - 1]
      : null;
    const incorrectAnswers = lessonAnswers.filter((answer) => !answer.correct);
    const answerActionDisabled =
      lessonChecking || (!lessonChecked && !lessonInput.trim());
    const scorePercent = lessonQuestions.length
      ? Math.round((lessonScore / lessonQuestions.length) * 100)
      : 0;

    return (
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          // One question at a time reads better in a narrow measure; setup and
          // results keep the standard column.
          lessonStage === 'exam' || lessonStage === 'speaking'
            ? focusColumn
            : contentColumn,
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Header
          kicker="GUIDED LESSON"
          title="Lesson"
          badge={
            lessonStage === 'exam'
              ? `${lessonQuestionIndex + 1}/${lessonQuestions.length}`
              : selectedDeck?.name
          }
        />

        {lessonStage === 'setup' ? (
          <>
            <View style={styles.lessonFocusPanel}>
              <View style={styles.lessonFocusHeader}>
                <View style={styles.lessonFocusIcon}>
                  <BookOpen color="#1F5E59" size={24} strokeWidth={2.3} />
                </View>
                <View style={styles.lessonFocusCopy}>
                  <Text style={styles.lessonFocusEyebrow}>SELECTED DECK</Text>
                  <Text style={styles.lessonFocusTitle}>{selectedDeck?.name}</Text>
                  <Text style={styles.lessonFocusSubtitle}>
                    {selectedLanguage?.name} to {library.motherTongue}
                  </Text>
                </View>
              </View>

              <View style={styles.lessonSummary}>
                <View style={styles.lessonMetric}>
                  <Text style={styles.lessonMetricValue}>
                    {Math.min(cards.length * 2, 10)}
                  </Text>
                  <Text style={styles.lessonMetricLabel}>Questions</Text>
                </View>
                <View style={styles.lessonMetric}>
                  <Text style={styles.lessonMetricValue}>
                    {Math.min(5, practicePhrases.length)}
                  </Text>
                  <Text style={styles.lessonMetricLabel}>Speaking</Text>
                </View>
                <View style={styles.lessonMetric}>
                  <Text style={styles.lessonMetricValue}>{cards.length}</Text>
                  <Text style={styles.lessonMetricLabel}>Deck cards</Text>
                </View>
              </View>

              <ActionButton
                disabled={!cards.length}
                icon={Play}
                kind="primary"
                label="Start lesson"
                onPress={startLesson}
              />
            </View>

            <DisclosureRow
              expanded={showLessonDeckPicker}
              icon={Settings2}
              onPress={() => setShowLessonDeckPicker((current) => !current)}
              subtitle={`${selectedLanguage?.name} / ${selectedDeck?.name}`}
              title="Change lesson deck"
            />
            {showLessonDeckPicker ? (
              <View style={styles.panel}>
                {renderTargetSelector('Lesson deck')}
              </View>
            ) : null}
          </>
        ) : null}

        {lessonStage === 'exam' && question ? (
          <>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${
                      ((lessonQuestionIndex + (lessonChecked ? 1 : 0)) /
                        lessonQuestions.length) *
                      100
                    }%`,
                  },
                ]}
              />
            </View>
            <View style={styles.examCard}>
              <Text style={styles.examDirection}>
                {question.direction === 'to-native'
                  ? `Translate into ${library.motherTongue}`
                  : `Translate into ${selectedLanguage?.name}`}
              </Text>
              <Text style={styles.examPrompt}>{question.prompt}</Text>
              <TextInput
                accessibilityLabel={`Translation into ${
                  question.direction === 'to-native'
                    ? library.motherTongue
                    : selectedLanguage?.name
                }`}
                autoCorrect={false}
                editable={!lessonChecked && !lessonChecking}
                onChangeText={setLessonInput}
                onSubmitEditing={checkLessonAnswer}
                placeholder="Type the translation"
                placeholderTextColor="#82909C"
                returnKeyType="done"
                style={styles.examInput}
                value={lessonInput}
              />
              {checkedAnswer ? (
                <View
                  accessibilityLiveRegion="polite"
                  style={[
                    styles.answerFeedback,
                    checkedAnswer.correct
                      ? styles.answerCorrect
                      : styles.answerIncorrect,
                  ]}
                >
                  <View style={styles.answerFeedbackHeader}>
                    {checkedAnswer.correct ? (
                      <Check color="#1F5E59" size={18} strokeWidth={3} />
                    ) : (
                      <X color="#A33A2A" size={18} strokeWidth={3} />
                    )}
                    <Text style={styles.answerFeedbackTitle}>
                      {checkedAnswer.correct ? 'Correct' : 'Correct answer'}
                    </Text>
                  </View>
                  <Text style={styles.answerFeedbackText}>
                    {checkedAnswer.correct
                      ? checkedAnswer.response
                      : question.answer}
                  </Text>
                  {checkedAnswer.feedback ? (
                    <Text style={styles.answerResponseText}>
                      {checkedAnswer.feedback}
                    </Text>
                  ) : null}
                  {!checkedAnswer.correct ? (
                    <Text style={styles.answerResponseText}>
                      {checkedAnswer.response
                        ? `Your answer: ${checkedAnswer.response}`
                        : 'You skipped this question.'}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              {checkedAnswer &&
              !checkedAnswer.correct &&
              Boolean(checkedAnswer.response) ? (
                <ActionButton
                  icon={Check}
                  label="Count my answer as correct"
                  onPress={acceptCurrentLessonAnswer}
                />
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: answerActionDisabled }}
              disabled={answerActionDisabled}
              onPress={lessonChecked ? continueLesson : checkLessonAnswer}
              style={({ pressed }) => [
                styles.lessonStartButton,
                answerActionDisabled && styles.disabled,
                pressed && !answerActionDisabled && styles.pressed,
              ]}
            >
              {lessonChecking ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Check color="#FFFFFF" size={19} strokeWidth={2.6} />
              )}
              <Text style={styles.lessonStartButtonText}>
                {lessonChecking
                  ? 'Checking meaning...'
                  : lessonChecked
                  ? lessonQuestionIndex === lessonQuestions.length - 1
                    ? 'Finish exam'
                    : 'Next question'
                  : 'Check answer'}
                </Text>
            </Pressable>
            {!lessonChecked ? (
              <ActionButton
                disabled={lessonChecking}
                label="I don't know"
                onPress={skipLessonAnswer}
              />
            ) : null}
          </>
        ) : null}

        {lessonStage === 'results' ? (
          <>
            <View style={styles.resultHero}>
              <Trophy color="#1F5E59" size={30} strokeWidth={2.2} />
              <Text style={styles.resultScore}>{scorePercent}%</Text>
              <Text style={styles.resultTitle}>
                {lessonScore} of {lessonQuestions.length} correct
              </Text>
              <Text style={styles.resultText}>
                {lessonRound === 'full'
                  ? 'Your card review schedule has been updated from this lesson.'
                  : 'You completed a focused retry of the questions you missed.'}
              </Text>
            </View>
            {incorrectAnswers.length ? (
              <View style={styles.resultList}>
                <Text style={styles.sectionLabel}>Review mistakes</Text>
                {incorrectAnswers.slice(0, 8).map((answer) => (
                  <View key={answer.question.id} style={styles.resultRow}>
                    <Text style={styles.resultPrompt}>
                      {answer.question.prompt}
                    </Text>
                    <Text style={styles.resultResponse}>
                      {answer.response
                        ? `You answered: ${answer.response}`
                        : 'You answered: I don\'t know'}
                    </Text>
                    <Text style={styles.resultAnswer}>
                      Correct: {answer.question.answer}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.caughtUpBox}>
                <Text style={styles.caughtUpTitle}>Perfect round</Text>
                <Text style={styles.panelText}>
                  You answered every question correctly.
                </Text>
              </View>
            )}
            {incorrectAnswers.length ? (
              <ActionButton
                icon={RotateCcw}
                kind="primary"
                label={`Retry ${incorrectAnswers.length} mistake${
                  incorrectAnswers.length === 1 ? '' : 's'
                }`}
                onPress={retryLessonMistakes}
              />
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={openLessonSpeaking}
              style={({ pressed }) => [
                styles.lessonStartButton,
                pressed && styles.pressed,
              ]}
            >
              <Volume2 color="#FFFFFF" size={19} strokeWidth={2.4} />
              <Text style={styles.lessonStartButtonText}>
                Continue to speaking
              </Text>
            </Pressable>
            <ActionButton
              icon={RotateCcw}
              label="Restart exam"
              onPress={startLesson}
            />
          </>
        ) : null}

        {lessonStage === 'speaking' ? (
          <>
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Listen and Repeat</Text>
              <Text style={styles.panelText}>
                Complete up to 5 recording exercises. Hear the OpenAI-generated
                native-language voice first, then record yourself.
              </Text>
              <Text style={styles.recordingProgress}>
                {completedLessonRecordings.length}/{lessonPhrases.length}{' '}
                recordings completed
              </Text>
              <View style={styles.phraseList}>
                {lessonPhrases.map((sentence, index) => (
                  <View key={sentence} style={styles.listeningRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{
                        selected: sentence === practiceSentence,
                      }}
                      onPress={() => choosePracticeSentence(sentence)}
                      style={[
                        styles.listeningSentence,
                        sentence === practiceSentence &&
                          styles.listeningSentenceActive,
                      ]}
                    >
                      <Text style={styles.exerciseNumber}>
                        Exercise {index + 1}
                        {completedLessonRecordings.includes(sentence)
                          ? ' - Completed'
                          : ''}
                      </Text>
                      <Text style={styles.phraseText}>{sentence}</Text>
                      {getSentenceTranslation(sentence, lessonCards) ? (
                        <Text style={styles.sentenceTranslation}>
                          {getSentenceTranslation(sentence, lessonCards)}
                        </Text>
                      ) : null}
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`Hear ${sentence}`}
                      accessibilityRole="button"
                      accessibilityState={{
                        disabled: Boolean(speechLoadingText),
                      }}
                      disabled={Boolean(speechLoadingText)}
                      onPress={() => playSentence(sentence)}
                      style={styles.listenButton}
                    >
                      <Volume2 color="#FFFFFF" size={17} strokeWidth={2.4} />
                      <Text style={styles.listenButtonText}>
                        {speechLoadingText === sentence ? 'Loading' : 'Hear'}
                      </Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Your Recording</Text>
              <Text style={styles.selectedSentence}>{practiceSentence}</Text>
              {getSentenceTranslation(practiceSentence, lessonCards) ? (
                <Text style={styles.selectedSentenceTranslation}>
                  {getSentenceTranslation(practiceSentence, lessonCards)}
                </Text>
              ) : null}
              <ActionButton
                disabled={!practiceSentence || Boolean(speechLoadingText)}
                icon={Volume2}
                label={
                  speechLoadingText === practiceSentence
                    ? 'Generating OpenAI voice...'
                    : 'Hear AI-generated voice'
                }
                onPress={() => playSentence(practiceSentence)}
              />
              <View style={styles.actionRow}>
                <ActionButton
                  disabled={
                    aiLoading ||
                    !canUseAi ||
                    recorderState.isRecording ||
                    !practiceSentence
                  }
                  kind="primary"
                  icon={Mic}
                  label="Start recording"
                  onPress={startRecording}
                />
                <ActionButton
                  disabled={aiLoading || !recorderState.isRecording}
                  kind="danger"
                  icon={Square}
                  label="Stop & check"
                  onPress={stopRecording}
                />
              </View>
              <Text style={styles.recordingStatus}>
                {recorderState.isRecording
                  ? `Recording ${Math.round(
                      recorderState.durationMillis / 1000,
                    )} seconds`
                  : canUseAi
                    ? 'Ready to record'
                    : 'Supabase is required for recording feedback'}
              </Text>
              {pronunciationFeedback ? (
                <View style={styles.feedbackBox}>
                  <Text style={styles.feedbackScore}>
                    {pronunciationFeedback.score}/100
                  </Text>
                  <Text style={styles.feedbackText}>
                    {pronunciationFeedback.encouragement}
                  </Text>
                  <Text style={styles.feedbackText}>
                    {[
                      ...pronunciationFeedback.corrections,
                      ...pronunciationFeedback.pronunciation_tips,
                    ].join('\n')}
                  </Text>
                </View>
              ) : null}
            </View>
            <View style={styles.actionRow}>
              <ActionButton
                icon={Plus}
                label="New lesson"
                onPress={resetLesson}
              />
              <ActionButton
                icon={RotateCcw}
                kind="primary"
                label="Repeat exam"
                onPress={startLesson}
              />
            </View>
          </>
        ) : null}
      </ScrollView>
    );
  }

  function renderAdd() {
    return (
      <ScrollView
        contentContainerStyle={[styles.scrollContent, focusColumn]}
        keyboardShouldPersistTaps="handled"
      >
        <Header
          kicker="ADD TO LIBRARY"
          title="New card"
          badge={selectedDeck?.name}
        />

        <DisclosureRow
          expanded={showAddDestination}
          icon={Settings2}
          onPress={() => setShowAddDestination((current) => !current)}
          subtitle={`${selectedLanguage?.name} / ${selectedDeck?.name}`}
          title="Save destination"
        />
        {showAddDestination ? (
          <View style={styles.panel}>{renderTargetSelector()}</View>
        ) : null}

        <View style={styles.panel}>
          <Field
            label="Word or phrase"
            onChangeText={setNewTerm}
            placeholder="Word in the learning language"
            value={newTerm}
          />
          <Field
            label="Translation"
            onChangeText={setNewTranslation}
            placeholder={`Translation in ${library.motherTongue}`}
            value={newTranslation}
          />
        </View>

        <DisclosureRow
          expanded={showAddDetails}
          icon={BookOpen}
          onPress={() => setShowAddDetails((current) => !current)}
          subtitle={
            newExample.trim() ? 'Example added' : 'Optional practice context'
          }
          title="Example sentence"
        />
        {showAddDetails ? (
          <View style={styles.panel}>
          <Field
            label="Practice sentence"
            multiline
            onChangeText={setNewExample}
            placeholder="A sentence containing the deck word"
            value={newExample}
          />
          <Field
            label="Sentence translation"
            multiline
            onChangeText={setNewExampleTranslation}
            placeholder={`Full sentence in ${library.motherTongue}`}
            value={newExampleTranslation}
          />
          </View>
        ) : null}

        <ActionButton
          disabled={!newTerm.trim() || !newTranslation.trim()}
          icon={Check}
          kind="primary"
          label={`Save to ${selectedDeck?.name}`}
          onPress={saveNewCard}
        />
      </ScrollView>
    );
  }

  function renderAi() {
    return (
      <ScrollView
        contentContainerStyle={[styles.scrollContent, contentColumn]}
        keyboardShouldPersistTaps="handled"
      >
        <Header
          kicker="OPENAI"
          title="AI studio"
          badge={
            !canUseAi
              ? 'Needs Supabase'
              : aiBudget && aiBudget.budgetMicroUsd > 0
                ? `${formatBudgetRemaining(aiBudget)} left`
                : 'Connected'
          }
        />

        <View style={styles.modeSwitch}>
          <ModeButton
            active={aiWorkspace === 'cards'}
            icon={Sparkles}
            label="Create cards"
            onPress={() => setAiWorkspace('cards')}
          />
          <ModeButton
            active={aiWorkspace === 'speaking'}
            icon={Mic}
            label="Speaking"
            onPress={() => setAiWorkspace('speaking')}
          />
        </View>

        <DisclosureRow
          expanded={showAiDestination}
          icon={Settings2}
          onPress={() => setShowAiDestination((current) => !current)}
          subtitle={`${selectedLanguage?.name} / ${selectedDeck?.name}`}
          title={aiWorkspace === 'cards' ? 'Card destination' : 'Practice deck'}
        />
        {showAiDestination ? (
          <View style={styles.panel}>
            {renderTargetSelector(
              aiWorkspace === 'cards' ? 'Card destination' : 'Practice deck',
            )}
          </View>
        ) : null}

        {aiWorkspace === 'cards' ? (
          <>
        <View style={styles.panel}>
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>Create Cards</Text>
            {aiLoading ? <ActivityIndicator color="#1F5E59" /> : null}
          </View>
          <View style={styles.segmentedControl}>
            <ChoiceChip
              active={aiMode === 'full_text'}
              label="Full text"
              onPress={() => setAiMode('full_text')}
            />
            <ChoiceChip
              active={aiMode === 'pairs'}
              label="Word - translation"
              onPress={() => setAiMode('pairs')}
            />
          </View>
          <TextInput
            accessibilityLabel="Text or context for AI card creation"
            multiline
            onChangeText={setSourceText}
            placeholder="Paste text, a word list, or context for a photo"
            placeholderTextColor="#79838C"
            style={[styles.input, styles.textArea, styles.tallTextArea]}
            value={sourceText}
          />
          {selectedImageLabel ? (
            <Text style={styles.panelText}>{selectedImageLabel}</Text>
          ) : null}
          <View style={styles.actionRow}>
            <ActionButton
              disabled={aiLoading || !canUseAi}
              icon={ImageIcon}
              label="Choose photo"
              onPress={choosePhoto}
            />
            {supportsCameraCapture ? (
              <ActionButton
                disabled={aiLoading || !canUseAi}
                icon={Camera}
                label={cameraActionLabel}
                onPress={takePhoto}
              />
            ) : null}
          </View>
          <ActionButton
            disabled={aiLoading || !canUseAi}
            icon={FileText}
            label={pdfPickerLabel}
            onPress={() => void choosePdf()}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: aiLoading || !canUseAi }}
            disabled={aiLoading || !canUseAi}
            onPress={analyzeText}
            style={[
              styles.primaryButton,
              (aiLoading || !canUseAi) && styles.disabled,
            ]}
          >
            <Text style={styles.primaryButtonText}>
              Generate preview for {selectedDeck?.name}
            </Text>
          </Pressable>
        </View>

        {aiPreviewCards.length ? (
          <View style={styles.panel}>
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>Review AI Cards</Text>
              <Text style={styles.panelText}>
                {selectedPreviewIndexes.length} selected
              </Text>
            </View>
            <Text style={styles.panelText}>
              Tap a card to include or exclude it before saving.
            </Text>
            <View style={styles.previewList}>
              {aiPreviewCards.map((card, index) => {
                const selected = selectedPreviewIndexes.includes(index);
                return (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                    key={`${card.term}-${index}`}
                    onPress={() => togglePreviewCard(index)}
                    style={[
                      styles.previewCard,
                      selected && styles.previewCardSelected,
                    ]}
                  >
                    <Text style={styles.previewStatus}>
                      {selected ? 'Selected' : 'Excluded'}
                    </Text>
                    <Text style={styles.previewTerm}>{card.term}</Text>
                    <Text style={styles.previewTranslation}>
                      {card.translation}
                    </Text>
                    <Text style={styles.previewExample}>{card.example}</Text>
                    <Text style={styles.previewExampleTranslation}>
                      {card.exampleTranslation}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.actionRow}>
              <ActionButton
                kind="primary"
                label={`Save ${selectedPreviewIndexes.length} cards`}
                onPress={saveSelectedPreviewCards}
              />
              <ActionButton
                label="Discard"
                onPress={() => {
                  setAiPreviewCards([]);
                  setSelectedPreviewIndexes([]);
                }}
              />
            </View>
          </View>
        ) : null}
          </>
        ) : null}

        {aiWorkspace === 'speaking' ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Deck Speaking Practice</Text>
          <Text style={styles.panelText}>
            Choose a sentence built from cards in {selectedDeck?.name}. Only
            phrases from this deck appear here.
          </Text>
          {practicePhrases.length ? (
            <View style={styles.phraseList}>
              {practicePhrases.map((sentence) => (
                <View key={sentence} style={styles.listeningRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{
                      selected: sentence === practiceSentence,
                    }}
                    onPress={() => choosePracticeSentence(sentence)}
                    style={[
                      styles.listeningSentence,
                      sentence === practiceSentence &&
                        styles.listeningSentenceActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.phraseText,
                        sentence === practiceSentence &&
                          styles.phraseTextActive,
                      ]}
                    >
                      {sentence}
                    </Text>
                    {getSentenceTranslation(sentence) ? (
                      <Text style={styles.sentenceTranslation}>
                        {getSentenceTranslation(sentence)}
                      </Text>
                    ) : null}
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`Hear ${sentence}`}
                    accessibilityRole="button"
                    accessibilityState={{
                      disabled: Boolean(speechLoadingText),
                    }}
                    disabled={Boolean(speechLoadingText)}
                    onPress={() => playSentence(sentence)}
                  style={styles.listenButton}
                >
                    <Volume2 color="#FFFFFF" size={17} strokeWidth={2.4} />
                    <Text style={styles.listenButtonText}>
                      {speechLoadingText === sentence ? 'Loading' : 'Hear'}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyText}>
              Add cards with practice sentences to this deck first.
            </Text>
          )}

          <Field
            label="Selected practice sentence"
            multiline
            onChangeText={setPracticeSentence}
            placeholder="Choose a phrase above"
            value={practiceSentence}
          />
          <ActionButton
            disabled={!practiceSentence.trim() || Boolean(speechLoadingText)}
            label={
              speechLoadingText === practiceSentence
                ? 'Generating OpenAI voice...'
                : 'Hear AI-generated voice'
            }
            onPress={() => playSentence(practiceSentence)}
          />
          {getSentenceTranslation(practiceSentence) ? (
            <Text style={styles.selectedSentenceTranslation}>
              {getSentenceTranslation(practiceSentence)}
            </Text>
          ) : null}
          <Field
            label="What you said (optional manual transcript)"
            multiline
            onChangeText={setSpokenTranscript}
            placeholder="Type it here or record below"
            value={spokenTranscript}
          />
          <View style={styles.recordingPanel}>
            <Text style={styles.panelText}>
              {recorderState.isRecording
                ? `Recording ${Math.round(recorderState.durationMillis / 1000)}s`
                : 'Ready to record'}
            </Text>
            <View style={styles.actionRow}>
              <ActionButton
                disabled={
                  aiLoading ||
                  !canUseAi ||
                  recorderState.isRecording ||
                  !practiceSentence
                }
                kind="primary"
                label="Start recording"
                onPress={startRecording}
              />
              <ActionButton
                disabled={aiLoading || !recorderState.isRecording}
                kind="danger"
                label="Stop & send"
                onPress={stopRecording}
              />
            </View>
          </View>
          <ActionButton
            disabled={aiLoading || !canUseAi || !spokenTranscript}
            label="Check typed transcript"
            onPress={requestTextFeedback}
          />
          {pronunciationFeedback ? (
            <View style={styles.feedbackBox}>
              <Text style={styles.feedbackScore}>
                {pronunciationFeedback.score}/100
              </Text>
              <Text style={styles.feedbackText}>
                {pronunciationFeedback.encouragement}
              </Text>
              <Text style={styles.feedbackText}>
                {[
                  ...pronunciationFeedback.corrections,
                  ...pronunciationFeedback.pronunciation_tips,
                ].join('\n')}
              </Text>
            </View>
          ) : null}
        </View>
        ) : null}
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.app}
    >
      <StatusBar style="dark" />
      <AppShell
        activeScreen={screen}
        items={NAV_ITEMS}
        layout={layout}
        notice={notice}
        onSelect={changeScreen}
        subtitle={`${selectedLanguage?.name ?? 'Library'} · ${activity.streakDays}-day streak`}
        title="Language Learning"
      >
        {screen === 'library'
          ? renderLibrary()
          : screen === 'lesson'
            ? renderLesson()
          : screen === 'add'
            ? renderAdd()
            : renderAi()}
      </AppShell>
      <ConfirmDialog
        onCancel={() => setConfirmRequest(null)}
        request={confirmRequest}
      />
      <SyncChoiceDialog request={syncChoice} />
      <GoalCelebration
        onDismiss={() => setGoalSummary(null)}
        summary={goalSummary}
      />
    </KeyboardAvoidingView>
  );
}

function Header({
  kicker,
  title,
  badge,
}: {
  kicker: string;
  title: string;
  badge?: string;
}) {
  return (
    <View style={styles.topBar}>
      <View style={styles.headerText}>
        <Text style={styles.kicker}>{kicker}</Text>
        <Text style={styles.screenTitle}>{title}</Text>
      </View>
      {badge ? <Text style={styles.badge}>{badge}</Text> : null}
    </View>
  );
}

function ChoiceChip({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function DisclosureRow({
  expanded,
  icon: Icon,
  onPress,
  subtitle,
  title,
}: {
  expanded: boolean;
  icon: LucideIcon;
  onPress: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [
        styles.disclosureRow,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.disclosureLeading}>
        <View style={styles.disclosureIcon}>
          <Icon color="#52606D" size={19} strokeWidth={2.2} />
        </View>
        <View style={styles.disclosureCopy}>
          <Text style={styles.disclosureTitle}>{title}</Text>
          <Text numberOfLines={1} style={styles.disclosureSubtitle}>
            {subtitle}
          </Text>
        </View>
      </View>
      {expanded ? (
        <ChevronUp color="#52606D" size={20} />
      ) : (
        <ChevronDown color="#52606D" size={20} />
      )}
    </Pressable>
  );
}

function ModeButton({
  active,
  icon: Icon,
  label,
  onPress,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [
        styles.modeButton,
        active && styles.modeButtonActive,
        pressed && styles.pressed,
      ]}
    >
      <Icon color={active ? '#FFFFFF' : '#52606D'} size={19} strokeWidth={2.3} />
      <Text style={[styles.modeButtonText, active && styles.modeButtonTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function Field({
  label,
  multiline,
  onChangeText,
  placeholder,
  value,
}: {
  label: string;
  multiline?: boolean;
  onChangeText: (text: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#79838C"
        style={[styles.input, multiline && styles.textArea]}
        value={value}
      />
    </View>
  );
}

const STRENGTH_LABELS: Record<CardStrength, string> = {
  new: 'New',
  'needs-work': 'Needs work',
  learning: 'Learning',
  strong: 'Strong',
};

/** Makes the app's memory of a card visible, rather than only acting on it. */
function StrengthBadge({ strength }: { strength: CardStrength }) {
  return (
    <Text
      style={[
        styles.strengthBadge,
        strength === 'needs-work' && styles.strengthNeedsWork,
        strength === 'learning' && styles.strengthLearning,
        strength === 'strong' && styles.strengthStrong,
      ]}
    >
      {STRENGTH_LABELS[strength]}
    </Text>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ActionButton({
  disabled,
  icon: Icon,
  kind = 'secondary',
  label,
  onPress,
}: {
  disabled?: boolean;
  icon?: LucideIcon;
  kind?: 'primary' | 'secondary' | 'success' | 'danger' | 'warning';
  label: string;
  onPress: () => void;
}) {
  const color =
    kind === 'primary'
      ? '#FFFFFF'
      : kind === 'danger'
        ? '#A33A2A'
        : kind === 'warning'
          ? '#8A5A1B'
          : '#1F5E59';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
          styles.actionButton,
          kind === 'primary' && styles.primaryButton,
          kind === 'success' && styles.successButton,
          kind === 'danger' && styles.dangerButton,
          kind === 'warning' && styles.warningButton,
          disabled && styles.disabled,
          pressed && !disabled && styles.pressed,
        ]}
    >
      {Icon ? <Icon color={color} size={18} strokeWidth={2.4} /> : null}
      <Text
        style={[
          styles.actionButtonText,
          kind === 'primary' && styles.primaryButtonText,
          kind === 'success' && styles.successButtonText,
          kind === 'danger' && styles.dangerButtonText,
          kind === 'warning' && styles.warningButtonText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: '#F6F5F1' },
  scrollContent: { padding: 16, paddingBottom: 30, gap: 16 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerText: { flex: 1 },
  kicker: { color: '#B65F32', fontSize: 12, fontWeight: '900' },
  screenTitle: { color: '#17212B', fontSize: 27, fontWeight: '900' },
  badge: {
    maxWidth: 130,
    borderRadius: 8,
    backgroundColor: '#E8EDF0',
    color: '#38424C',
    fontSize: 13,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 7,
    textAlign: 'center',
  },
  dailyPanel: {
    borderColor: '#EACCB0',
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#FFF3E7',
    padding: 16,
    gap: 16,
  },
  dailyPanelHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  dailyTitleRow: {
    flex: 1,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  dailyIconBox: {
    width: 42,
    height: 42,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
  },
  dailyEyebrow: { color: '#9B5130', fontSize: 11, fontWeight: '900' },
  dailyTitle: { color: '#17212B', fontSize: 20, fontWeight: '900' },
  xpBadge: {
    minHeight: 32,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#F5D9B8',
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 9,
  },
  xpBadgeText: { color: '#704126', fontSize: 12, fontWeight: '900' },
  momentumRow: {
    minHeight: 58,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    paddingVertical: 8,
  },
  momentumItem: { flex: 1, alignItems: 'center', gap: 1 },
  momentumValue: { color: '#17212B', fontSize: 21, fontWeight: '900' },
  momentumLabel: { color: '#69747D', fontSize: 11, fontWeight: '700' },
  momentumDivider: { width: 1, height: 29, backgroundColor: '#E9DFD5' },
  goalBlock: { gap: 7 },
  goalLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  goalLabel: { color: '#38424C', fontSize: 13, fontWeight: '800' },
  goalValue: { color: '#8A4B2C', fontSize: 13, fontWeight: '900' },
  dailyProgressTrack: {
    height: 9,
    borderRadius: 5,
    backgroundColor: '#E5D8CC',
    overflow: 'hidden',
  },
  dailyProgressFill: {
    height: 9,
    borderRadius: 5,
    backgroundColor: '#B65F32',
  },
  dailyStartButton: {
    minHeight: 58,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#1F5E59',
    flexDirection: 'row',
    gap: 11,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  dailyStartTextBlock: { flexShrink: 1, gap: 1 },
  dailyStartButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  dailyStartButtonSubtext: { color: '#D5E9E4', fontSize: 12, fontWeight: '700' },
  quickActionRow: { flexDirection: 'row', gap: 9 },
  managementToggle: {
    minHeight: 50,
    alignItems: 'center',
    borderColor: '#D8D5CE',
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  managementToggleLabel: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  managementToggleText: { color: '#38424C', fontSize: 15, fontWeight: '900' },
  disclosureRow: {
    minHeight: 58,
    alignItems: 'center',
    borderColor: '#D8D5CE',
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  disclosureLeading: {
    flex: 1,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  disclosureIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#EEF1F2',
    justifyContent: 'center',
  },
  disclosureCopy: { flex: 1, gap: 1 },
  disclosureTitle: { color: '#17212B', fontSize: 15, fontWeight: '900' },
  disclosureSubtitle: { color: '#69747D', fontSize: 12, fontWeight: '700' },
  modeSwitch: {
    minHeight: 54,
    borderRadius: 8,
    backgroundColor: '#E7EAEB',
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  modeButton: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    paddingHorizontal: 9,
  },
  modeButtonActive: { backgroundColor: '#17212B' },
  modeButtonText: { color: '#52606D', fontSize: 14, fontWeight: '900' },
  modeButtonTextActive: { color: '#FFFFFF' },
  panel: {
    borderColor: '#DEDBD3',
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#FFFFFF',
    padding: 15,
    gap: 13,
  },
  panelHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  panelTitle: { color: '#17212B', fontSize: 19, fontWeight: '900' },
  panelText: { color: '#52606D', fontSize: 14, lineHeight: 21 },
  sectionLabel: { color: '#17212B', fontSize: 17, fontWeight: '900' },
  targetBlock: { gap: 10 },
  fieldGroup: { gap: 7 },
  label: { color: '#38424C', fontSize: 14, fontWeight: '800' },
  input: {
    minHeight: 48,
    borderColor: '#D3D0C8',
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#FBFAF7',
    color: '#17212B',
    fontSize: 16,
    paddingHorizontal: 12,
  },
  textArea: { minHeight: 92, paddingTop: 12, textAlignVertical: 'top' },
  tallTextArea: { minHeight: 138 },
  backupInput: { minHeight: 120, fontSize: 12 },
  inlineForm: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inlineInput: { flex: 1 },
  compactButton: {
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: '#17212B',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  compactButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  chipRow: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  segmentedControl: { flexDirection: 'row', gap: 8 },
  chip: {
    borderColor: '#D3D0C8',
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#FBFAF7',
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 13,
  },
  chipActive: { borderColor: '#24706A', backgroundColor: '#DFF1EC' },
  chipText: { color: '#52606D', fontSize: 14, fontWeight: '800' },
  chipTextActive: { color: '#1F5E59' },
  deckGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  deckTile: {
    minHeight: 82,
    borderColor: '#D3D0C8',
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#FBFAF7',
    justifyContent: 'center',
    padding: 12,
    gap: 4,
  },
  deckTileActive: { borderColor: '#24706A', backgroundColor: '#DFF1EC' },
  deckName: { color: '#17212B', fontSize: 16, fontWeight: '900' },
  deckCount: { color: '#52606D', fontSize: 13, fontWeight: '700' },
  statsRow: { flexDirection: 'row', gap: 9 },
  statBox: {
    flex: 1,
    borderColor: '#DEDBD3',
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#FFFFFF',
    padding: 11,
    gap: 2,
  },
  statValue: { color: '#17212B', fontSize: 21, fontWeight: '900' },
  statLabel: { color: '#52606D', fontSize: 12, fontWeight: '700' },
  contextText: { color: '#52606D', fontSize: 13, fontWeight: '700' },
  deckTileRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  deckTileCopy: { flex: 1, gap: 4 },
  milestoneGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  milestone: {
    width: '48%',
    borderColor: '#E4DED4',
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#FBFAF7',
    padding: 11,
    gap: 3,
  },
  milestoneEarned: { borderColor: '#24706A', backgroundColor: '#DFF1EC' },
  milestoneLabel: { color: '#79838C', fontSize: 14, fontWeight: '800' },
  milestoneLabelEarned: { color: '#17212B' },
  milestoneDetail: { color: '#99A1A8', fontSize: 11, lineHeight: 15 },
  milestoneDetailEarned: { color: '#1F5E59', fontWeight: '800' },
  browseCard: {
    borderColor: '#E4DED4',
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#FBFAF7',
    overflow: 'hidden',
  },
  browseCardHeader: {
    minHeight: 54,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  browseCardCopy: { flex: 1, gap: 2 },
  browseCardTerm: { color: '#17212B', fontSize: 16, fontWeight: '800' },
  browseCardTranslation: { color: '#52606D', fontSize: 13 },
  browseCardBody: {
    borderTopColor: '#E4DED4',
    borderTopWidth: 1,
    padding: 12,
    gap: 10,
  },
  browseCardExample: { color: '#17212B', fontSize: 14, lineHeight: 20 },
  browseCardExampleTranslation: {
    color: '#52606D',
    fontSize: 13,
    lineHeight: 19,
  },
  reviewHeading: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  reviewCount: {
    borderRadius: 8,
    backgroundColor: '#E7F3EF',
    color: '#1F5E59',
    fontSize: 12,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  caughtUpBox: {
    borderColor: '#B9D8CE',
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#E7F3EF',
    padding: 13,
    gap: 3,
  },
  caughtUpTitle: { color: '#1F5E59', fontSize: 16, fontWeight: '900' },
  card: {
    minHeight: 250,
    borderRadius: 8,
    backgroundColor: '#17212B',
    justifyContent: 'center',
    padding: 21,
    gap: 12,
  },
  cardLabel: { color: '#B4C8C4', fontSize: 13, fontWeight: '800' },
  cardLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  strengthBadge: {
    borderRadius: 6,
    // Solid, not translucent: the badge sits on the dark review card AND on the
    // light deck-browser rows, and a translucent fill vanished on the latter.
    // Every variant below pairs a dark fill with light text so both work.
    backgroundColor: '#4A5560',
    color: '#EDF1F3',
    fontSize: 11,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  strengthNeedsWork: { backgroundColor: '#7A2E22', color: '#FFD9D0' },
  strengthLearning: { backgroundColor: '#7A5A22', color: '#FFE9C7' },
  strengthStrong: { backgroundColor: '#1F5E59', color: '#D6F0EA' },
  cardTerm: {
    color: '#FFFFFF',
    fontSize: 38,
    fontWeight: '900',
    lineHeight: 47,
  },
  cardHint: { color: '#F0C49A', fontSize: 14, fontWeight: '800' },
  translationBlock: {
    borderTopColor: '#3A4651',
    borderTopWidth: 1,
    gap: 8,
    marginTop: 8,
    paddingTop: 13,
  },
  translationText: { color: '#FFFFFF', fontSize: 27, fontWeight: '900' },
  exampleText: { color: '#CAD4D1', fontSize: 16, lineHeight: 24 },
  exampleTranslationText: {
    color: '#F0C49A',
    fontSize: 15,
    lineHeight: 22,
  },
  emptyState: {
    borderColor: '#DEDBD3',
    borderRadius: 8,
    borderStyle: 'dashed',
    borderWidth: 1,
    backgroundColor: '#FFFFFF',
    padding: 24,
  },
  emptyText: {
    color: '#52606D',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  actionRow: { flexDirection: 'row', gap: 9 },
  actionButton: {
    flex: 1,
    minHeight: 49,
    alignItems: 'center',
    borderColor: '#24706A',
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  actionButtonText: {
    color: '#1F5E59',
    fontSize: 15,
    fontWeight: '900',
    flexShrink: 1,
    textAlign: 'center',
  },
  cardSettingsToggle: {
    minHeight: 42,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  cardSettingsToggleText: { color: '#52606D', fontSize: 14, fontWeight: '800' },
  primaryButton: {
    minHeight: 50,
    alignItems: 'center',
    borderColor: '#1F5E59',
    borderRadius: 8,
    borderWidth: 0,
    backgroundColor: '#1F5E59',
    justifyContent: 'center',
    paddingHorizontal: 15,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'center',
  },
  successButton: { borderColor: '#DFF1EC', backgroundColor: '#DFF1EC' },
  successButtonText: { color: '#1F5E59' },
  dangerButton: { borderColor: '#F9E3DF', backgroundColor: '#F9E3DF' },
  dangerButtonText: { color: '#A33A2A' },
  warningButton: { borderColor: '#F7E7CD', backgroundColor: '#F7E7CD' },
  warningButtonText: { color: '#8A5A1B' },
  // Wraps to 2x2 on a phone and sits in one row once there is width for it.
  gradeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  disabled: { opacity: 0.42 },
  phraseList: { gap: 8 },
  previewList: { gap: 9 },
  previewCard: {
    borderColor: '#D3D0C8',
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#FBFAF7',
    padding: 12,
    gap: 5,
  },
  previewCardSelected: {
    borderColor: '#24706A',
    backgroundColor: '#E7F3EF',
  },
  previewStatus: {
    color: '#B65F32',
    fontSize: 12,
    fontWeight: '900',
  },
  previewTerm: { color: '#17212B', fontSize: 19, fontWeight: '900' },
  previewTranslation: { color: '#1F5E59', fontSize: 17, fontWeight: '800' },
  previewExample: { color: '#52606D', fontSize: 14, lineHeight: 20 },
  previewExampleTranslation: {
    color: '#1F5E59',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  phraseButton: {
    borderColor: '#D3D0C8',
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#FBFAF7',
    padding: 12,
  },
  phraseButtonActive: { borderColor: '#24706A', backgroundColor: '#DFF1EC' },
  phraseText: { color: '#38424C', fontSize: 15, lineHeight: 22 },
  phraseTextActive: { color: '#1F5E59', fontWeight: '800' },
  recordingPanel: {
    borderColor: '#D3D0C8',
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#FBFAF7',
    gap: 10,
    padding: 12,
  },
  feedbackBox: {
    borderColor: '#D3D0C8',
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#FBFAF7',
    gap: 8,
    padding: 12,
  },
  feedbackScore: { color: '#1F5E59', fontSize: 23, fontWeight: '900' },
  feedbackText: { color: '#38424C', fontSize: 14, lineHeight: 21 },
  lessonFocusPanel: {
    borderColor: '#C9DDD7',
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#F3F8F6',
    padding: 16,
    gap: 16,
  },
  lessonFocusHeader: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  lessonFocusIcon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#DFF1EC',
    justifyContent: 'center',
  },
  lessonFocusCopy: { flex: 1, gap: 2 },
  lessonFocusEyebrow: { color: '#24706A', fontSize: 11, fontWeight: '900' },
  lessonFocusTitle: { color: '#17212B', fontSize: 22, fontWeight: '900' },
  lessonFocusSubtitle: { color: '#52606D', fontSize: 13, fontWeight: '700' },
  lessonSummary: { flexDirection: 'row', gap: 9 },
  lessonMetric: {
    flex: 1,
    borderColor: '#DEDBD3',
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#FFFFFF',
    padding: 13,
    gap: 3,
  },
  lessonMetricValue: { color: '#17212B', fontSize: 24, fontWeight: '900' },
  lessonMetricLabel: { color: '#52606D', fontSize: 12, fontWeight: '800' },
  lessonStartButton: {
    minHeight: 56,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#B65F32',
    flexDirection: 'row',
    gap: 9,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  lessonStartButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'center',
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#DFE4E6',
    overflow: 'hidden',
  },
  progressFill: { height: 8, backgroundColor: '#24706A' },
  examCard: {
    minHeight: 340,
    borderRadius: 8,
    backgroundColor: '#17212B',
    justifyContent: 'center',
    padding: 22,
    gap: 16,
  },
  examDirection: { color: '#F0C49A', fontSize: 14, fontWeight: '900' },
  examPrompt: {
    color: '#FFFFFF',
    fontSize: 38,
    fontWeight: '900',
    lineHeight: 48,
  },
  examInput: {
    minHeight: 54,
    borderColor: '#61707A',
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#FFFFFF',
    color: '#17212B',
    fontSize: 18,
    paddingHorizontal: 14,
  },
  answerFeedback: { borderRadius: 8, padding: 13, gap: 4 },
  answerFeedbackHeader: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  answerCorrect: { backgroundColor: '#DFF1EC' },
  answerIncorrect: { backgroundColor: '#F9E3DF' },
  answerFeedbackTitle: { color: '#17212B', fontSize: 13, fontWeight: '900' },
  answerFeedbackText: { color: '#17212B', fontSize: 19, fontWeight: '900' },
  answerResponseText: { color: '#52606D', fontSize: 14, lineHeight: 20 },
  resultHero: {
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#E7F3EF',
    padding: 24,
    gap: 6,
  },
  resultScore: { color: '#1F5E59', fontSize: 58, fontWeight: '900' },
  resultTitle: { color: '#17212B', fontSize: 20, fontWeight: '900' },
  resultText: {
    color: '#52606D',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  resultList: { gap: 8 },
  resultRow: {
    borderBottomColor: '#DEDBD3',
    borderBottomWidth: 1,
    paddingVertical: 10,
    gap: 4,
  },
  resultPrompt: { color: '#17212B', fontSize: 17, fontWeight: '900' },
  resultResponse: { color: '#A33A2A', fontSize: 14, lineHeight: 20 },
  resultAnswer: {
    color: '#1F5E59',
    fontSize: 15,
    fontWeight: '900',
  },
  listeningRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  listeningSentence: {
    flex: 1,
    borderColor: '#D3D0C8',
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#FBFAF7',
    justifyContent: 'center',
    padding: 11,
  },
  listeningSentenceActive: {
    borderColor: '#24706A',
    backgroundColor: '#E7F3EF',
  },
  listenButton: {
    minWidth: 78,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#17212B',
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  listenButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  selectedSentence: {
    color: '#17212B',
    fontSize: 19,
    fontWeight: '800',
    lineHeight: 28,
  },
  selectedSentenceTranslation: {
    color: '#1F5E59',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 24,
  },
  sentenceTranslation: {
    color: '#1F5E59',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
  },
  recordingStatus: {
    color: '#52606D',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  recordingProgress: {
    color: '#1F5E59',
    fontSize: 14,
    fontWeight: '900',
  },
  exerciseNumber: {
    color: '#B65F32',
    fontSize: 11,
    fontWeight: '900',
    marginBottom: 4,
  },
});
